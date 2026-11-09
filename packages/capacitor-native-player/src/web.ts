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
    video.crossOrigin = 'anonymous';
    video.style.position = 'fixed';
    video.style.inset = '0';
    video.style.width = '100vw';
    video.style.height = '100vh';
    video.style.zIndex = '40';
    video.style.pointerEvents = 'none';
    video.style.backgroundColor = '#000000';
    video.style.objectFit = 'contain';

    video.addEventListener('timeupdate', () => {
      this.notifyListeners('timeUpdate', {
        currentTimeMs: Math.floor(video.currentTime * 1000),
        durationMs: Math.floor((video.duration || 0) * 1000),
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
      this.notifyListeners('error', {
        message: err?.message || 'Video playback error',
        code: err?.code || 0,
      });
    });

    document.body.prepend(video);
    this.videoEl = video;
    return video;
  }

  async loadAndPlay(options: PlayOptions): Promise<void> {
    const video = this.getOrCreateVideo();
    video.src = options.url;

    if (options.startPositionMs && options.startPositionMs > 0) {
      video.currentTime = options.startPositionMs / 1000;
    }

    document.documentElement.classList.add('video-playing');

    try {
      await video.play();
    } catch (e) {
      // Auto-play might require user gesture in some browsers
      console.warn('Playback play() was prevented:', e);
    }

    // Emit initial tracks
    setTimeout(() => {
      this.notifyListeners('tracksLoaded', {
        audioTracks: [],
        subtitleTracks: [],
      });
    }, 500);
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
    if (this.videoEl) {
      this.videoEl.currentTime = options.positionMs / 1000;
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
  }

  async getTracks(): Promise<{ audioTracks: TrackInfo[]; subtitleTracks: TrackInfo[] }> {
    const video = this.videoEl;
    if (!video) {
      return { audioTracks: [], subtitleTracks: [] };
    }

    const subtitles: TrackInfo[] = [];
    const textTracks = video.textTracks;
    for (let i = 0; i < textTracks.length; i++) {
      const t = textTracks[i];
      subtitles.push({
        id: `sub_${i}`,
        language: t.language || 'und',
        label: t.label || `Track ${i + 1}`,
        codec: 'webvtt',
        selected: t.mode === 'showing',
      });
    }

    return {
      audioTracks: [
        { id: 'audio_default', language: 'eng', label: 'Default Audio', codec: 'aac', selected: true },
      ],
      subtitleTracks: subtitles,
    };
  }

  async setAudioTrack(_options: { trackId: string }): Promise<void> {
    // Browser HTML5 video manages audio track selection natively
  }

  async setSubtitleTrack(options: { trackId: string | null }): Promise<void> {
    if (!this.videoEl) return;
    const textTracks = this.videoEl.textTracks;
    for (let i = 0; i < textTracks.length; i++) {
      const id = `sub_${i}`;
      textTracks[i].mode = options.trackId === id ? 'showing' : 'disabled';
    }
  }

  async startOfflineDownload(options: OfflineDownloadOptions): Promise<{ localFileUri: string }> {
    const abortController = new AbortController();
    const download = { abortController, downloaded: 0, total: 0 };
    this.activeDownloads.set(options.downloadId, download);

    const localFileUri = `file://offline/${options.filename}`;

    // Background browser chunk fetch
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
    // Browser resume
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

