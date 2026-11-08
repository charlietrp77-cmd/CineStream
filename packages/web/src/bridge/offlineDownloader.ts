import { NativeVideoPlayer } from '@cinestream/capacitor-native-player';
import { OfflineMediaItem } from '../types/api';
import { imageToBase64 } from '../store/useOfflineStore';

type OfflineProgressListener = (item: OfflineMediaItem) => void;

class OfflineDownloaderBridge {
  private listeners = new Set<OfflineProgressListener>();
  private items = new Map<string, OfflineMediaItem>();

  constructor() {
    this.init();
  }

  private init() {
    NativeVideoPlayer.addListener('offlineDownloadProgress', (data) => {
      const existing = this.items.get(data.downloadId);
      if (existing) {
        existing.downloadedBytes = data.bytesDownloaded;
        existing.fileSizeBytes = data.totalBytes || existing.fileSizeBytes;
        existing.speedBytesPerSec = data.speedBytesPerSec || 0;
        existing.status = data.status;
        if (data.localFileUri) {
          existing.localFileUri = data.localFileUri;
        }
        if (data.error) {
          existing.error = data.error;
        }
        this.notify(existing);
      }
    });
  }

  private notify(item: OfflineMediaItem) {
    this.listeners.forEach((l) => l(item));
  }

  public onProgress(listener: OfflineProgressListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async startDownload(params: {
    downloadId: string;
    imdbId: string;
    tmdbId: number;
    mediaType: 'movie' | 'tv';
    season: number;
    episode: number;
    title: string;
    episodeTitle?: string;
    posterUrl?: string;
    backdropUrl?: string;
    streamUrl: string;
    headers?: Record<string, string>;
  }): Promise<OfflineMediaItem> {
    const filename = `${params.imdbId}_S${params.season}E${params.episode}.mkv`;

    // Cache artwork offline in base64
    let posterBase64 = '';
    let backdropBase64 = '';
    if (params.posterUrl) {
      posterBase64 = await imageToBase64(params.posterUrl);
    }
    if (params.backdropUrl) {
      backdropBase64 = await imageToBase64(params.backdropUrl);
    }

    const item: OfflineMediaItem = {
      id: params.downloadId,
      imdbId: params.imdbId,
      tmdbId: params.tmdbId,
      mediaType: params.mediaType,
      season: params.season,
      episode: params.episode,
      title: params.title,
      episodeTitle: params.episodeTitle,
      posterUrl: params.posterUrl,
      backdropUrl: params.backdropUrl,
      posterBase64,
      backdropBase64,
      localFileUri: `file://${filename}`,
      fileSizeBytes: 0,
      downloadedBytes: 0,
      speedBytesPerSec: 0,
      status: 'downloading',
      downloadedAt: Date.now(),
    };

    this.items.set(params.downloadId, item);

    const res = await NativeVideoPlayer.startOfflineDownload({
      downloadId: params.downloadId,
      url: params.streamUrl,
      filename,
      headers: params.headers,
      title: params.title,
    });

    if (res.localFileUri) {
      item.localFileUri = res.localFileUri;
    }

    return item;
  }

  public async pauseDownload(downloadId: string): Promise<void> {
    await NativeVideoPlayer.pauseOfflineDownload({ downloadId });
    const item = this.items.get(downloadId);
    if (item) {
      item.status = 'paused';
      item.speedBytesPerSec = 0;
      this.notify(item);
    }
  }

  public async resumeDownload(downloadId: string): Promise<void> {
    await NativeVideoPlayer.resumeOfflineDownload({ downloadId });
    const item = this.items.get(downloadId);
    if (item) {
      item.status = 'downloading';
      this.notify(item);
    }
  }

  public async removeDownload(downloadId: string, localFileUri?: string): Promise<void> {
    await NativeVideoPlayer.removeOfflineDownload({ downloadId, localFileUri });
    this.items.delete(downloadId);
  }
}

export const offlineDownloader = new OfflineDownloaderBridge();

