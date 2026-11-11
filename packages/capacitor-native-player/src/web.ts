import { WebPlugin } from '@capacitor/core';
import type {
  NativeVideoPlayerPlugin,
  PlayOptions,
  TrackInfo,
  OfflineDownloadOptions,
  OfflineDownloadProgress,
} from './definitions';

export class NativeVideoPlayerWeb extends WebPlugin implements NativeVideoPlayerPlugin {
  private videoEl: HTMLVideoElement | null = null;
  private activeDownloads = new Map<string, { abortController: AbortController; downloaded: number; total: number }>();

  // Remux Streaming State
  private currentOptions: PlayOptions | null = null;
  private isRemuxStream = false;
  private selectedAudioTrackId = '0';
  private selectedSubtitleTrackId: string | null = null;
  private videoMode: 'copy' | 'transcode' = 'copy';
  private probedDurationMs = 0;
  private currentTimeOffsetMs = 0;
  private audioTracksCache: TrackInfo[] = [];
  private subtitleTracksCache: TrackInfo[] = [];

  private getOrCreateVideo(): HTMLVideoElement {
    if (this.videoEl) {
      return this.videoEl;
    }

    const existing = document.getElementById('cinestream-native-video') as HTMLVideoElement | null;
    if (existing) {
      this.videoEl = existing;
      return existing;
    }

    const video = document.createElement('video');
    video.id = 'cinestream-native-video';
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.setAttribute('crossorigin', 'anonymous');
    video.style.position = 'fixed';
    video.style.inset = '0';
    video.style.width = '100vw';
    video.style.height = '100vh';
    video.style.zIndex = '45'; // Strictly above page root (z-0 to z-30), below OSD (z-50)
    video.style.pointerEvents = 'none';
    video.style.backgroundColor = '#000000';
    video.style.objectFit = 'contain';

    video.addEventListener('timeupdate', () => {
      const currentPosMs = this.isRemuxStream
        ? this.currentTimeOffsetMs + Math.floor(video.currentTime * 1000)
        : Math.floor(video.currentTime * 1000);

      const effectiveDurationMs = this.probedDurationMs > 0
        ? this.probedDurationMs
        : Math.floor((video.duration || 0) * 1000);

      this.notifyListeners('timeUpdate', {
        currentTimeMs: currentPosMs,
        durationMs: effectiveDurationMs,
      });
    });

    video.addEventListener('play', () => {
      this.notifyListeners('stateChange', { state: 'playing' });
    });

    video.addEventListener('pause', () => {
      this.notifyListeners('stateChange', { state: 'paused' });
    });

    video.addEventListener('ended', () => {
      this.notifyListeners('playbackEnded', {});
    });

    video.addEventListener('error', () => {
      const err = video.error;
      console.warn('[NativeVideoPlayerWeb] Video element reported error:', err);

      // If direct remux (HEVC copy) errored or failed to render, auto-try transcode mode!
      if (this.isRemuxStream && this.videoMode === 'copy' && this.currentOptions?.url) {
        console.warn('[NativeVideoPlayerWeb] Direct HEVC remux failed. Auto-switching to Compatibility Transcode Mode...');
        this.videoMode = 'transcode';
        const currentSec = (this.currentTimeOffsetMs + Math.floor((this.videoEl?.currentTime || 0) * 1000)) / 1000;
        this.startRemuxStream(this.currentOptions.url, currentSec);
        return;
      }

      this.notifyListeners('error', {
        message: err?.message || 'Video playback error',
        code: err?.code || 0,
      });
    });

    // Append to document.body AFTER #root to prevent #root background styles from obscuring the video
    document.body.appendChild(video);
    this.videoEl = video;
    return video;
  }

  private shouldAutoRemux(url: string): boolean {
    if (!url) return false;
    const lower = url.toLowerCase();
    return (
      lower.includes('.mkv') ||
      lower.includes('/api/nas/stream') ||
      lower.includes('nas_') ||
      lower.includes('remux') ||
      lower.includes('dts') ||
      lower.includes('truehd') ||
      lower.includes('atmos')
    );
  }

  private buildRemuxUrl(sourceUrl: string, startSec: number, audioTrack: string, videoMode: 'copy' | 'transcode'): string {
    const params = new URLSearchParams({
      url: sourceUrl,
      start: startSec.toFixed(3),
      audioTrack,
      videoMode,
    });
    return `/api/remux/stream?${params.toString()}`;
  }

  private async probeMediaInfo(sourceUrl: string) {
    try {
      const probeRes = await fetch(`/api/remux/probe?url=${encodeURIComponent(sourceUrl)}`);
      if (!probeRes.ok) return;

      const data = await probeRes.json();
      if (data.durationSeconds && data.durationSeconds > 0) {
        this.probedDurationMs = Math.round(data.durationSeconds * 1000);
      }

      if (Array.isArray(data.audioTracks) && data.audioTracks.length > 0) {
        this.audioTracksCache = data.audioTracks.map((t: any) => ({
          id: String(t.id),
          language: t.language || 'und',
          label: t.label || `Audio ${t.id}`,
          codec: t.codec || 'aac',
          selected: String(t.id) === this.selectedAudioTrackId,
        }));
      }

      if (Array.isArray(data.subtitleTracks)) {
        this.subtitleTracksCache = data.subtitleTracks.map((t: any) => ({
          id: String(t.id),
          language: t.language || 'und',
          label: t.label || `Subtitle ${t.id}`,
          codec: t.codec || 'srt',
          selected: false,
        }));
      }

      this.notifyListeners('tracksLoaded', {
        audioTracks: this.audioTracksCache,
        subtitleTracks: this.subtitleTracksCache,
      });
    } catch (e) {
      console.warn('[NativeVideoPlayerWeb] Probe media notice:', e);
    }
  }

  /**
   * Initializes playback via the Remux Engine.
   * Uses native progressive fMP4 with tagged hvc1/avc1 bitstream.
   */
  private async startRemuxStream(sourceUrl: string, startSec: number): Promise<void> {
    const video = this.getOrCreateVideo();
    this.isRemuxStream = true;
    this.currentTimeOffsetMs = Math.round(startSec * 1000);

    const remuxUrl = this.buildRemuxUrl(sourceUrl, startSec, this.selectedAudioTrackId, this.videoMode);

    // Progressive fMP4: Native browser C++ pipeline demuxes audio & video tracks concurrently
    video.src = remuxUrl;
    try {
      await video.play();
    } catch (e) {
      console.warn('[NativeVideoPlayerWeb] play() was prevented:', e);
    }
  }

  async loadAndPlay(options: PlayOptions): Promise<void> {
    this.currentOptions = options;
    this.probedDurationMs = 0;
    this.currentTimeOffsetMs = 0;
    this.selectedAudioTrackId = '0';
    this.selectedSubtitleTrackId = null;

    // Check stored user preference for video mode
    try {
      const savedMode = localStorage.getItem('cinestream_web_video_mode');
      if (savedMode === 'transcode' || savedMode === 'copy') {
        this.videoMode = savedMode;
      } else {
        this.videoMode = 'copy';
      }
    } catch (_) {
      this.videoMode = 'copy';
    }

    const video = this.getOrCreateVideo();
    document.documentElement.classList.add('video-playing');

    const startSec = (options.startPositionMs || 0) / 1000;

    if (this.shouldAutoRemux(options.url)) {
      await this.startRemuxStream(options.url, startSec);
    } else {
      this.isRemuxStream = false;
      video.src = options.url;
      if (startSec > 0) {
        video.currentTime = startSec;
      }
      try {
        await video.play();
      } catch (e) {
        console.warn('Direct play() was prevented:', e);
      }
    }

    // Deferred non-blocking ffprobe for audio/subtitles (prevents competing bandwidth at startup)
    setTimeout(() => {
      this.probeMediaInfo(options.url);
    }, 1200);

    setTimeout(() => {
      this.notifyListeners('tracksLoaded', {
        audioTracks: this.audioTracksCache,
        subtitleTracks: this.subtitleTracksCache,
      });
    }, 300);
  }

  async pause(): Promise<void> {
    if (this.videoEl) {
      this.videoEl.pause();
    }
  }

  async resume(): Promise<void> {
    if (this.videoEl) {
      await this.videoEl.play();
    }
  }

  async seekTo(options: { positionMs: number }): Promise<void> {
    const targetMs = Math.max(0, options.positionMs);
    const targetSec = targetMs / 1000;

    if (this.isRemuxStream && this.currentOptions?.url) {
      await this.startRemuxStream(this.currentOptions.url, targetSec);
    } else if (this.videoEl) {
      this.videoEl.currentTime = targetSec;
    }
  }

  async stop(): Promise<void> {
    document.documentElement.classList.remove('video-playing');

    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.src = '';
      this.videoEl.load();
      this.videoEl.remove();
      this.videoEl = null;
    }

    this.isRemuxStream = false;
    this.currentOptions = null;
  }

  async getTracks(): Promise<{ audioTracks: TrackInfo[]; subtitleTracks: TrackInfo[] }> {
    return {
      audioTracks: this.audioTracksCache,
      subtitleTracks: this.subtitleTracksCache,
    };
  }

  async setAudioTrack(options: { trackId: string }): Promise<void> {
    this.selectedAudioTrackId = options.trackId;

    this.audioTracksCache = this.audioTracksCache.map((t) => ({
      ...t,
      selected: t.id === options.trackId,
    }));
    this.notifyListeners('tracksLoaded', {
      audioTracks: this.audioTracksCache,
      subtitleTracks: this.subtitleTracksCache,
    });

    if (this.isRemuxStream && this.currentOptions?.url && this.videoEl) {
      const currentPosSec = (this.currentTimeOffsetMs + Math.floor(this.videoEl.currentTime * 1000)) / 1000;
      await this.startRemuxStream(this.currentOptions.url, currentPosSec);
    }
  }

  async setSubtitleTrack(options: { trackId: string | null }): Promise<void> {
    this.selectedSubtitleTrackId = options.trackId;
    this.subtitleTracksCache = this.subtitleTracksCache.map((t) => ({
      ...t,
      selected: t.id === options.trackId,
    }));

    if (this.videoEl) {
      const textTracks = this.videoEl.textTracks;
      for (let i = 0; i < textTracks.length; i++) {
        const id = `sub_${i}`;
        textTracks[i].mode = options.trackId === id ? 'showing' : 'disabled';
      }
    }
  }

  async setVideoMode(options: { mode: 'copy' | 'transcode' }): Promise<void> {
    this.videoMode = options.mode;
    try {
      localStorage.setItem('cinestream_web_video_mode', options.mode);
    } catch (_) {}

    if (this.isRemuxStream && this.currentOptions?.url && this.videoEl) {
      const currentPosSec = (this.currentTimeOffsetMs + Math.floor(this.videoEl.currentTime * 1000)) / 1000;
      await this.startRemuxStream(this.currentOptions.url, currentPosSec);
    }
  }

  async startOfflineDownload(options: OfflineDownloadOptions): Promise<{ localFileUri: string }> {
    const abortController = new AbortController();
    const download = { abortController, downloaded: 0, total: 0 };
    this.activeDownloads.set(options.downloadId, download);

    const localFileUri = `file://offline/${options.filename}`;

    (async () => {
      try {
        const res = await fetch(options.url, {
          signal: abortController.signal,
          headers: options.headers,
        });

        const total = parseInt(res.headers.get('content-length') || '0', 10);
        download.total = total;

        const reader = res.body?.getReader();
        if (!reader) throw new Error('ReadableStream not supported');

        let downloaded = 0;
        let lastTime = Date.now();
        let lastDownloaded = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          downloaded += value.length;
          download.downloaded = downloaded;

          const now = Date.now();
          if (now - lastTime >= 1000) {
            const speed = Math.floor((downloaded - lastDownloaded) / ((now - lastTime) / 1000));
            lastTime = now;
            lastDownloaded = downloaded;

            const progress: OfflineDownloadProgress = {
              downloadId: options.downloadId,
              bytesDownloaded: downloaded,
              totalBytes: total,
              speedBytesPerSec: speed,
              status: 'downloading',
              localFileUri,
            };
            this.notifyListeners('offlineDownloadProgress', progress);
          }
        }

        const completeProgress: OfflineDownloadProgress = {
          downloadId: options.downloadId,
          bytesDownloaded: downloaded,
          totalBytes: total || downloaded,
          speedBytesPerSec: 0,
          status: 'completed',
          localFileUri,
        };
        this.notifyListeners('offlineDownloadProgress', completeProgress);
      } catch (err: any) {
        if (!abortController.signal.aborted) {
          this.notifyListeners('offlineDownloadProgress', {
            downloadId: options.downloadId,
            bytesDownloaded: download.downloaded,
            totalBytes: download.total,
            speedBytesPerSec: 0,
            status: 'failed',
            error: err.message,
          });
        }
      } finally {
        this.activeDownloads.delete(options.downloadId);
      }
    })();

    return { localFileUri };
  }

  async pauseOfflineDownload(options: { downloadId: string }): Promise<void> {
    const d = this.activeDownloads.get(options.downloadId);
    if (d) {
      d.abortController.abort();
      this.activeDownloads.delete(options.downloadId);
      this.notifyListeners('offlineDownloadProgress', {
        downloadId: options.downloadId,
        bytesDownloaded: d.downloaded,
        totalBytes: d.total,
        speedBytesPerSec: 0,
        status: 'paused',
      });
    }
  }

  async resumeOfflineDownload(options: { downloadId: string }): Promise<void> {
    this.notifyListeners('offlineDownloadProgress', {
      downloadId: options.downloadId,
      bytesDownloaded: 0,
      totalBytes: 0,
      speedBytesPerSec: 0,
      status: 'downloading',
    });
  }

  async removeOfflineDownload(options: { downloadId: string; localFileUri?: string }): Promise<void> {
    const d = this.activeDownloads.get(options.downloadId);
    if (d) {
      d.abortController.abort();
      this.activeDownloads.delete(options.downloadId);
    }
  }

  async getDeviceStorageInfo(): Promise<{ freeBytes: number; totalBytes: number }> {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        const quota = est.quota || 100 * 1024 * 1024 * 1024;
        const usage = est.usage || 0;
        return {
          totalBytes: quota,
          freeBytes: Math.max(0, quota - usage),
        };
      } catch (_) {}
    }

    const fallbackTotal = 128 * 1024 * 1024 * 1024;
    return {
      totalBytes: fallbackTotal,
      freeBytes: Math.floor(fallbackTotal * 0.7),
    };
  }
}
