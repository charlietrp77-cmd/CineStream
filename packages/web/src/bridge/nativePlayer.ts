import { NativeVideoPlayer, PlayOptions, TrackInfo } from '@cinestream/capacitor-native-player';

export type PlayerStateListener = (state: 'playing' | 'paused' | 'stopped') => void;
export type TimeUpdateListener = (currentMs: number, durationMs: number) => void;
export type PlaybackEndedListener = () => void;
export type TracksLoadedListener = (audio: TrackInfo[], subtitles: TrackInfo[]) => void;
export type PlayerErrorListener = (message: string) => void;

class NativePlayerBridge {
  private isInitialized = false;
  private stateListeners = new Set<PlayerStateListener>();
  private timeListeners = new Set<TimeUpdateListener>();
  private endedListeners = new Set<PlaybackEndedListener>();
  private tracksListeners = new Set<TracksLoadedListener>();
  private errorListeners = new Set<PlayerErrorListener>();

  public init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    NativeVideoPlayer.addListener('stateChange', (data) => {
      this.stateListeners.forEach((l) => l(data.state));
    });

    NativeVideoPlayer.addListener('timeUpdate', (data) => {
      this.timeListeners.forEach((l) => l(data.currentTimeMs, data.durationMs));
    });

    NativeVideoPlayer.addListener('playbackEnded', () => {
      this.endedListeners.forEach((l) => l());
    });

    NativeVideoPlayer.addListener('tracksLoaded', (data) => {
      this.tracksListeners.forEach((l) => l(data.audioTracks || [], data.subtitleTracks || []));
    });

    NativeVideoPlayer.addListener('error', (data) => {
      this.errorListeners.forEach((l) => l(data.message || 'Playback error'));
    });
  }

  public async play(options: PlayOptions): Promise<void> {
    this.init();
    await NativeVideoPlayer.loadAndPlay(options);
  }

  public async pause(): Promise<void> {
    await NativeVideoPlayer.pause();
  }

  public async resume(): Promise<void> {
    await NativeVideoPlayer.resume();
  }

  public async seekTo(positionMs: number): Promise<void> {
    await NativeVideoPlayer.seekTo({ positionMs });
  }

  public async stop(): Promise<void> {
    await NativeVideoPlayer.stop();
  }

  public async getTracks(): Promise<{ audioTracks: TrackInfo[]; subtitleTracks: TrackInfo[] }> {
    return NativeVideoPlayer.getTracks();
  }

  public async setAudioTrack(trackId: string): Promise<void> {
    await NativeVideoPlayer.setAudioTrack({ trackId });
  }

  public async setSubtitleTrack(trackId: string | null): Promise<void> {
    await NativeVideoPlayer.setSubtitleTrack({ trackId });
  }

  public onStateChange(listener: PlayerStateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  public onTimeUpdate(listener: TimeUpdateListener): () => void {
    this.timeListeners.add(listener);
    return () => this.timeListeners.delete(listener);
  }

  public onPlaybackEnded(listener: PlaybackEndedListener): () => void {
    this.endedListeners.add(listener);
    return () => this.endedListeners.delete(listener);
  }

  public onTracksLoaded(listener: TracksLoadedListener): () => void {
    this.tracksListeners.add(listener);
    return () => this.tracksListeners.delete(listener);
  }

  public onError(listener: PlayerErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }
}

export const nativePlayer = new NativePlayerBridge();

