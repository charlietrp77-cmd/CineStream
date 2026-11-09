import fs from 'fs';
import path from 'path';
import { WebSocket } from 'ws';
import { Agent, request as undiciRequest } from 'undici';
import { config } from '../config';
import { db } from '../db';
import { NasCacheItemRow } from '../db/schema';
import { getUpstreamMetadata } from './proxy';

const undiciAgent = new Agent({
  connections: 64,
  keepAliveTimeout: 30000,
});

interface ActiveDownload {
  id: string;
  abortController: AbortController;
  fileHandle?: fs.promises.FileHandle;
  bytesDownloaded: number;
  totalBytes: number;
  speedBytesPerSec: number;
  lastBytesSample: number;
  lastSampleTime: number;
}

class NasDownloaderService {
  private activeDownloads = new Map<string, ActiveDownload>();
  private wsClients = new Set<WebSocket>();
  private queueInterval: NodeJS.Timeout | null = null;
  private broadcastInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor() {
    this.ensureNasRoot();
    this.startTimers();
  }

  private ensureNasRoot() {
    if (!fs.existsSync(config.nasCachePath)) {
      try {
        fs.mkdirSync(config.nasCachePath, { recursive: true });
      } catch (err) {
        console.error('Error creating NAS cache directory:', err);
      }
    }
  }

  private startTimers() {
    this.queueInterval = setInterval(() => {
      this.processQueue().catch((err) => {
        console.error('Error in NAS processQueue loop:', err);
      });
    }, 3000);

    this.broadcastInterval = setInterval(() => {
      this.broadcastProgress();
    }, 1000);
  }

  public addWsClient(ws: WebSocket) {
    this.wsClients.add(ws);
    ws.on('close', () => this.wsClients.delete(ws));
    ws.on('error', () => this.wsClients.delete(ws));

    // Send immediate snapshot
    const active = this.getAllJobs();
    ws.send(JSON.stringify({ type: 'snapshot', jobs: active }));
  }

  public getAllJobs(): NasCacheItemRow[] {
    const stmt = db.prepare('SELECT * FROM nas_cache_items ORDER BY created_at DESC');
    return stmt.all() as NasCacheItemRow[];
  }

  public getJob(id: string): NasCacheItemRow | undefined {
    const stmt = db.prepare('SELECT * FROM nas_cache_items WHERE id = ?');
    return stmt.get(id) as NasCacheItemRow | undefined;
  }

  public async getDiskSpace(): Promise<{ totalBytes: number; freeBytes: number; usedBytes: number }> {
    this.ensureNasRoot();
    try {
      if (typeof fs.promises.statfs === 'function') {
        const stats = await fs.promises.statfs(config.nasCachePath);
        const total = stats.bsize * stats.blocks;
        const free = stats.bsize * stats.bfree;
        const used = total - free;
        return { totalBytes: total, freeBytes: free, usedBytes: used };
      }
    } catch (e) {
      // Fallback for mock/virtual filesystems
    }
    // Standard 2TB fallback if statfs not available
    const fallbackTotal = 2 * 1024 * 1024 * 1024 * 1024;
    return {
      totalBytes: fallbackTotal,
      freeBytes: Math.floor(fallbackTotal * 0.75),
      usedBytes: Math.floor(fallbackTotal * 0.25),
    };
  }

  public async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const runningCount = this.activeDownloads.size;
      const availableSlots = config.nasMaxConcurrentDownloads - runningCount;

      if (availableSlots <= 0) {
        return;
      }

      const stmt = db.prepare(`
        SELECT * FROM nas_cache_items
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT ?
      `);

      const queuedItems = stmt.all(availableSlots) as NasCacheItemRow[];
      for (const item of queuedItems) {
        this.startDownload(item);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  public async pauseJob(id: string): Promise<boolean> {
    const active = this.activeDownloads.get(id);
    if (active) {
      active.abortController.abort();
      if (active.fileHandle) {
        try {
          await active.fileHandle.close();
        } catch (_) {}
      }
      this.activeDownloads.delete(id);
    }

    const stmt = db.prepare(`
      UPDATE nas_cache_items
      SET status = 'paused', speed_bytes_per_sec = 0, updated_at = ?
      WHERE id = ? AND status != 'completed'
    `);
    const res = stmt.run(Date.now(), id);
    this.broadcastProgress();
    return res.changes > 0;
  }

  public async resumeJob(id: string): Promise<boolean> {
    const stmt = db.prepare(`
      UPDATE nas_cache_items
      SET status = 'queued', error_message = NULL, updated_at = ?
      WHERE id = ? AND status != 'completed'
    `);
    const res = stmt.run(Date.now(), id);
    if (res.changes > 0) {
      this.processQueue().catch(() => {});
      this.broadcastProgress();
      return true;
    }
    return false;
  }

  public async deleteJob(id: string): Promise<boolean> {
    const active = this.activeDownloads.get(id);
    if (active) {
      active.abortController.abort();
      if (active.fileHandle) {
        try {
          await active.fileHandle.close();
        } catch (_) {}
      }
      this.activeDownloads.delete(id);
    }

    const item = this.getJob(id);
    if (item) {
      try {
        if (fs.existsSync(item.file_path)) {
          fs.unlinkSync(item.file_path);
        }
        const partPath = `${item.file_path}.part`;
        if (fs.existsSync(partPath)) {
          fs.unlinkSync(partPath);
        }
      } catch (err) {
        console.error('Error removing NAS file on delete:', err);
      }

      const stmt = db.prepare('DELETE FROM nas_cache_items WHERE id = ?');
      stmt.run(id);
      this.broadcastProgress();
      return true;
    }
    return false;
  }

  private async startDownload(item: NasCacheItemRow) {
    if (this.activeDownloads.has(item.id)) return;

    const abortController = new AbortController();
    const active: ActiveDownload = {
      id: item.id,
      abortController,
      bytesDownloaded: item.downloaded_bytes || 0,
      totalBytes: item.file_size_bytes || 0,
      speedBytesPerSec: 0,
      lastBytesSample: item.downloaded_bytes || 0,
      lastSampleTime: Date.now(),
    };

    this.activeDownloads.set(item.id, active);

    db.prepare(`
      UPDATE nas_cache_items
      SET status = 'downloading', updated_at = ?
      WHERE id = ?
    `).run(Date.now(), item.id);

    // Launch worker in background
    this.executeDownload(item, active).catch((err) => {
      console.error(`Download failed for ${item.id}:`, err);
    });
  }

  private async executeDownload(item: NasCacheItemRow, active: ActiveDownload): Promise<void> {
    const partPath = `${item.file_path}.part`;
    const targetDir = path.dirname(item.file_path);

    try {
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      let customHeaders: Record<string, string> = {};
      try {
        customHeaders = JSON.parse(item.source_headers_json || '{}');
      } catch (_) {}

      // Get metadata to know exact total size
      const meta = await getUpstreamMetadata(item.source_url, customHeaders);
      const totalSize = meta.totalSize;

      active.totalBytes = totalSize;
      db.prepare(`
        UPDATE nas_cache_items
        SET file_size_bytes = ?, updated_at = ?
        WHERE id = ?
      `).run(totalSize, Date.now(), item.id);

      // Open part file for random offset writes
      const fileHandle = await fs.promises.open(partPath, fs.constants.O_RDWR | fs.constants.O_CREAT);
      active.fileHandle = fileHandle;

      // Check current size on disk if resuming
      const stat = await fileHandle.stat();
      let startingByte = stat.size;
      if (startingByte > totalSize) {
        startingByte = 0;
        await fileHandle.truncate(0);
      }
      active.bytesDownloaded = startingByte;

      const SEGMENT_SIZE = 16 * 1024 * 1024; // 16 MB segments
      const THREADS = Math.max(1, config.nasThreadsPerDownload);

      interface Segment {
        index: number;
        start: number;
        end: number;
      }

      const segments: Segment[] = [];
      let cur = startingByte;
      let sIdx = 0;
      while (cur < totalSize) {
        const segEnd = Math.min(cur + SEGMENT_SIZE - 1, totalSize - 1);
        segments.push({ index: sIdx++, start: cur, end: segEnd });
        cur = segEnd + 1;
      }

      let nextSegmentIdx = 0;

      const targetUrl = meta.finalUrl || item.source_url;
      const worker = async () => {
        while (!active.abortController.signal.aborted && nextSegmentIdx < segments.length) {
          const seg = segments[nextSegmentIdx++];
          if (!seg) break;

          let fetchUrl = targetUrl;
          let rCount = 0;
          let res: any = null;

          while (rCount < 5) {
            res = await undiciRequest(fetchUrl, {
              method: 'GET',
              headers: {
                Range: `bytes=${seg.start}-${seg.end}`,
                'User-Agent': 'CineStream/1.0.0 (NAS Downloader)',
                ...customHeaders,
              },
              signal: active.abortController.signal,
              dispatcher: undiciAgent,
            });

            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              for await (const _ of res.body) {}
              fetchUrl = new URL(res.headers.location as string, fetchUrl).toString();
              rCount++;
              continue;
            }
            break;
          }

          if (!res) continue;

          const chunks: Buffer[] = [];
          for await (const chunk of res.body) {
            if (active.abortController.signal.aborted) break;
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            active.bytesDownloaded += chunk.length;
          }

          if (active.abortController.signal.aborted) break;

          const segBuffer = Buffer.concat(chunks);
          await fileHandle.write(segBuffer, 0, segBuffer.length, seg.start);
        }
      };

      const workerList: Promise<void>[] = [];
      for (let i = 0; i < THREADS; i++) {
        workerList.push(worker());
      }

      await Promise.all(workerList);

      if (active.abortController.signal.aborted) {
        return;
      }

      // Finalize completed file
      await fileHandle.sync();
      await fileHandle.close();
      active.fileHandle = undefined;

      // Rename .part -> final .mkv
      if (fs.existsSync(item.file_path)) {
        fs.unlinkSync(item.file_path);
      }
      await fs.promises.rename(partPath, item.file_path);

      db.prepare(`
        UPDATE nas_cache_items
        SET status = 'completed', downloaded_bytes = ?, speed_bytes_per_sec = 0, error_message = NULL, updated_at = ?
        WHERE id = ?
      `).run(totalSize, Date.now(), item.id);

      this.activeDownloads.delete(item.id);
      this.broadcastProgress();

      // Trigger next item in queue
      this.processQueue().catch(() => {});
    } catch (err: any) {
      if (active.fileHandle) {
        try {
          await active.fileHandle.close();
        } catch (_) {}
      }

      if (active.abortController.signal.aborted) {
        return;
      }

      console.error(`NAS download error for ${item.id}:`, err);
      db.prepare(`
        UPDATE nas_cache_items
        SET status = 'failed', error_message = ?, speed_bytes_per_sec = 0, updated_at = ?
        WHERE id = ?
      `).run(err.message || String(err), Date.now(), item.id);

      this.activeDownloads.delete(item.id);
      this.broadcastProgress();
      this.processQueue().catch(() => {});
    }
  }

  private broadcastProgress() {
    const now = Date.now();
    for (const [id, active] of this.activeDownloads.entries()) {
      const elapsedSec = (now - active.lastSampleTime) / 1000;
      if (elapsedSec >= 1) {
        const deltaBytes = active.bytesDownloaded - active.lastBytesSample;
        active.speedBytesPerSec = Math.max(0, Math.floor(deltaBytes / elapsedSec));
        active.lastBytesSample = active.bytesDownloaded;
        active.lastSampleTime = now;

        db.prepare(`
          UPDATE nas_cache_items
          SET downloaded_bytes = ?, speed_bytes_per_sec = ?, updated_at = ?
          WHERE id = ?
        `).run(active.bytesDownloaded, active.speedBytesPerSec, now, id);
      }
    }

    if (this.wsClients.size === 0) return;

    const allJobs = this.getAllJobs();
    const payload = JSON.stringify({ type: 'progress', jobs: allJobs });
    for (const ws of this.wsClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }
}

export const nasDownloader = new NasDownloaderService();

