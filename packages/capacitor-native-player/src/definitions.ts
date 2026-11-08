import type { PluginListenerHandle } from '@capacitor/core';

export interface PlayOptions {
  url: string;
  title: string;
  subtitle?: string;
  startPositionMs?: number;
  headers?: Record<string, string>;
  bingeGroup?: string;
  preferredAudioLang?: string;
  preferredSubtitleLang?: string;
}

export interface TrackInfo {
  id: string;
  language: string;
  label: string;
  codec: string;
  selected: boolean;
}

export interface OfflineDownloadOptions {
  downloadId: string;
  url: string;
  filename: string;
  headers?: Record<string, string>;
  title: string;
}

export interface OfflineDownloadProgress {
  downloadId: string;
  bytesDownloaded: number;
  totalBytes: number;
  speedBytesPerSec: number;
  status: 'downloading' | 'paused' | 'completed' | 'failed';
  localFileUri?: string;
  error?: string;
}

export interface NativeVideoPlayerPlugin {
  loadAndPlay(options: PlayOptions): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seekTo(options: { positionMs: number }): Promise<void>;
  stop(): Promise<void>;
  getTracks(): Promise<{ audioTracks: TrackInfo[]; subtitleTracks: TrackInfo[] }>;
  setAudioTrack(options: { trackId: string }): Promise<void>;
  setSubtitleTrack(options: { trackId: string | null }): Promise<void>;

  // Offline Tablet Storage API
  startOfflineDownload(options: OfflineDownloadOptions): Promise<{ localFileUri: string }>;
  pauseOfflineDownload(options: { downloadId: string }): Promise<void>;
  resumeOfflineDownload(options: { downloadId: string }): Promise<void>;
  removeOfflineDownload(options: { downloadId: string; localFileUri?: string }): Promise<void>;
  getDeviceStorageInfo(): Promise<{ freeBytes: number; totalBytes: number }>;

  addListener(
    eventName: 'timeUpdate' | 'stateChange' | 'tracksLoaded' | 'playbackEnded' | 'error' | 'offlineDownloadProgress',
    listenerFunc: (data: any) => void
  ): Promise<PluginListenerHandle>;
}

