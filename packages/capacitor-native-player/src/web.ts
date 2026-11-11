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
  private probedDurationMs = 0;
  private currentTimeOffsetMs = 0;
  private audioTracksCache: TrackInfo[] = [];
  private subtitleTracksCache: TrackInfo[] = [];
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private streamAbortController: AbortController | null = null;

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
    video.style.position = 'fixed';
    video.style.inset = '0';
    video.style.width = '100vw';
    video.style.height = '100vh';
    video.style.zIndex = '40';
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
      // If direct playback failed on an MKV or unfamiliar format, auto-switch to remux!
      if (!this.isRemuxStream && this.currentOptions?.url) {
        console.warn('[NativeVideoPlayerWeb] Direct video playback failed. Switching to 4K Remux Engine...');
        this.startRemuxStream(this.currentOptions.url, 0);
        return;
      }

      this.notifyListeners('error', {
        message: err?.message || 'Video playback error',
        code: err?.code || 0,
      });
    });

    document.body.prepend(video);
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

  private buildRemuxUrl(sourceUrl: string, startSec: number, audioTrack: string): string {
    const params = new URLSearchParams({
      url: sourceUrl,
      start: startSec.toFixed(3),
      audioTrack,
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
   * Initializes playback via the 4K HDR Remux Engine.
   * Transmuxes container to fragmented MP4 (fMP4) with direct HEVC copy and multi-channel AAC.
   */
  private async startRemuxStream(sourceUrl: string, startSec: number): Promise<void> {
    const video = this.getOrCreateVideo();
    this.isRemuxStream = true;
    this.currentTimeOffsetMs = Math.round(startSec * 1000);

    // Abort any prior stream
    if (this.streamAbortController) {
      this.streamAbortController.abort();
      this.streamAbortController = null;
    }

    const remuxUrl = this.buildRemuxUrl(sourceUrl, startSec, this.selectedAudioTrackId);

    // Try MSE if supported by the browser, otherwise fall back to progressive fMP4
    const canUseMse =
      typeof window !== 'undefined' &&
      'MediaSource' in window &&
      (MediaSource.isTypeSupported('video/mp4; codecs="hvc1, mp4a.40.2"') ||
        MediaSource.isTypeSupported('video/mp4; codecs="avc1.640028, mp4a.40.2"') ||
        MediaSource.isTypeSupported('video/mp4'));

    if (canUseMse && !this.mediaSource) {
      try {
        const ms = new MediaSource();
        this.mediaSource = ms;
        video.src = URL.createObjectURL(ms);

        await new Promise<void>((resolve, reject) => {
          const onOpen = () => {
            ms.removeEventListener('sourceopen', onOpen);
            resolve();
          };
          ms.addEventListener('sourceopen', onOpen);
          setTimeout(() => reject(new Error('MediaSource open timeout')), 3000);
        });

        // Determine best supported MIME codec string
        let mime = 'video/mp4; codecs="hvc1, mp4a.40.2"';
        if (!MediaSource.isTypeSupported(mime)) {
          mime = 'video/mp4; codecs="avc1.640028, mp4a.40.2"';
        }
        if (!MediaSource.isTypeSupported(mime)) {
          mime = 'video/mp4';
        }

        const sb = ms.addSourceBuffer(mime);
        sb.mode = 'segments';
        this.sourceBuffer = sb;

        const abortCtrl = new AbortController();
        this.streamAbortController = abortCtrl;

        const response = await fetch(remuxUrl, { signal: abortCtrl.signal });
        if (!response.body) throw new Error('ReadableStream not supported');

        const reader = response.body.getReader();
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              if (ms.readyState === 'open') ms.endOfStream();
              break;
            }
            if (sb.updating) {
              await new Promise<void>((r) => sb.addEventListener('updateend', () => r(), { once: true }));
            }
            sb.appendBuffer(value);
          }
        };

        pump().catch((pumpErr) => {
          if (!abortCtrl.signal.aborted) {
            console.warn('[MSE Player] Chunk stream error:', pumpErr);
          }
        });

        await video.play();
        return;
      } catch (mseErr) {
        console.warn('[MSE Player] MediaSource init failed, using progressive fMP4:', mseErr);
        this.mediaSource = null;
        this.sourceBuffer = null;
      }
    }

    // Direct progressive fMP4 stream fallback (natively supported by Chromium/WebKit/Blink)
    video.src = remuxUrl;
    try {
      await video.play();
    } catch (e) {
      console.warn('Playback play() was prevented:', e);
    }
  }

  async loadAndPlay(options: PlayOptions): Promise<void> {
    this.currentOptions = options;
    this.probedDurationMs = 0;
    this.currentTimeOffsetMs = 0;
    this.selectedAudioTrackId = '0';
    this.selectedSubtitleTrackId = null;

    const video = this.getOrCreateVideo();
    document.documentElement.classList.add('video-playing');

    const startSec = (options.startPositionMs || 0) / 1000;

    // Trigger async background ffprobe for audio/subtitles and HDR detection
    this.probeMediaInfo(options.url);

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

    // Emit initial empty tracks while probing completes
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
      // For remux streaming: Seek instantly at keyframe boundary via FFmpeg
      await this.startRemuxStream(this.currentOptions.url, targetSec);
    } else if (this.videoEl) {
      this.videoEl.currentTime = targetSec;
    }
  }

  async stop(): Promise<void> {
    document.documentElement.classList.remove('video-playing');

    if (this.streamAbortController) {
      this.streamAbortController.abort();
      this.streamAbortController = null;
    }

    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.src = '';
      this.videoEl.load();
      this.videoEl.remove();
      this.videoEl = null;
    }

    this.mediaSource = null;
    this.sourceBuffer = null;
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

    // Update selection state in cached tracks
    this.audioTracksCache = this.audioTracksCache.map((t) => ({
      ...t,
      selected: t.id === options.trackId,
    }));
    this.notifyListeners('tracksLoaded', {
      audioTracks: this.audioTracksCache,
      subtitleTracks: this.subtitleTracksCache,
    });

    // If currently remuxing, seamlessly restart stream with new audio track at current timestamp
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
