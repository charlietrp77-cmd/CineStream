import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  Subtitles,
  SkipForward,
  Zap,
  Tablet,
  Sparkles,
} from 'lucide-react';
import { TrackInfo } from '@cinestream/capacitor-native-player';
import { nativePlayer } from '../bridge/nativePlayer';
import { useProfileStore } from '../store/useProfileStore';

interface PlayerOverlayProps {
  streamUrl: string;
  title: string;
  episodeTitle?: string;
  imdbId?: string;
  tmdbId?: number;
  season?: number;
  episode?: number;
  isNasCached?: boolean;
  isOfflineFile?: boolean;
  onClose: () => void;
  onNextEpisode?: () => void;
}

export const PlayerOverlay: React.FC<PlayerOverlayProps> = ({
  streamUrl,
  title,
  episodeTitle,
  imdbId,
  tmdbId,
  season,
  episode,
  isNasCached,
  isOfflineFile,
  onClose,
  onNextEpisode,
}) => {
  const { activeProfile } = useProfileStore();

  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [showOsd, setShowOsd] = useState(true);

  // Audio & Subtitle Tracks
  const [audioTracks, setAudioTracks] = useState<TrackInfo[]>([]);
  const [subtitleTracks, setSubtitleTracks] = useState<TrackInfo[]>([]);
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);

  const osdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const progressSyncRef = useRef<NodeJS.Timeout | null>(null);

  // Format time mm:ss or hh:mm:ss
  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;

    const pad = (n: number) => n.toString().padStart(2, '0');
    if (hrs > 0) {
      return `${hrs}:${pad(mins)}:${pad(secs)}`;
    }
    return `${mins}:${pad(secs)}`;
  };

  const wakeOsd = () => {
    setShowOsd(true);
    if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
    osdTimerRef.current = setTimeout(() => {
      setShowOsd(false);
      setShowAudioMenu(false);
      setShowSubtitleMenu(false);
    }, 4000);
  };

  useEffect(() => {
    wakeOsd();

    // Start video playback
    nativePlayer.play({
      url: streamUrl,
      title,
      subtitle: episodeTitle,
    });

    const unsubState = nativePlayer.onStateChange((state) => {
      setIsPlaying(state === 'playing');
    });

    const unsubTime = nativePlayer.onTimeUpdate((current, duration) => {
      setCurrentTimeMs(current);
      setDurationMs(duration);
    });

    const unsubEnded = nativePlayer.onPlaybackEnded(() => {
      if (onNextEpisode) onNextEpisode();
      else handleClose();
    });

    const unsubTracks = nativePlayer.onTracksLoaded((audio, subtitles) => {
      setAudioTracks(audio);
      setSubtitleTracks(subtitles);
    });

    // Sync watch progress to server every 5 seconds
    progressSyncRef.current = setInterval(() => {
      if (!imdbId || currentTimeMs <= 0) return;

      fetch('/api/progress', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Profile-Id': activeProfile?.id || '',
        },
        body: JSON.stringify({
          imdb_id: imdbId,
          tmdb_id: tmdbId || 0,
          media_type: season !== undefined && season > 0 ? 'tv' : 'movie',
          season: season || 0,
          episode: episode || 0,
          title,
          episode_title: episodeTitle,
          position_ms: currentTimeMs,
          duration_ms: durationMs,
          last_stream_url: streamUrl,
        }),
      }).catch(() => {});
    }, 5000);

    return () => {
      if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
      if (progressSyncRef.current) clearInterval(progressSyncRef.current);
      unsubState();
      unsubTime();
      unsubEnded();
      unsubTracks();
      nativePlayer.stop();
    };
  }, [streamUrl]);

  const handleClose = () => {
    nativePlayer.stop();
    onClose();
  };

  const togglePlayPause = () => {
    wakeOsd();
    if (isPlaying) {
      nativePlayer.pause();
    } else {
      nativePlayer.resume();
    }
  };

  const seekRelative = (deltaSeconds: number) => {
    wakeOsd();
    const newPos = Math.max(0, Math.min(currentTimeMs + deltaSeconds * 1000, durationMs));
    nativePlayer.seekTo(newPos);
  };

  const handleTimelineScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    wakeOsd();
    const pct = parseFloat(e.target.value);
    const newPos = (pct / 100) * durationMs;
    nativePlayer.seekTo(newPos);
  };

  const progressPercent = durationMs > 0 ? (currentTimeMs / durationMs) * 100 : 0;
  const showNextEpisodePrompt =
    onNextEpisode && durationMs > 0 && currentTimeMs >= durationMs - 35000;

  return (
    <div
      onMouseMove={wakeOsd}
      onClick={wakeOsd}
      className="fixed inset-0 z-50 overflow-hidden bg-transparent select-none cursor-default"
    >
      {/* OSD Container (Fades in/out) */}
      <div
        className={`absolute inset-0 flex flex-col justify-between transition-opacity duration-300 ${
          showOsd ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Top Gradient Bar */}
        <div className="bg-gradient-to-b from-black/90 via-black/40 to-transparent p-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={handleClose}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>

            <div>
              <h2 className="text-xl sm:text-2xl font-black text-white drop-shadow-md">{title}</h2>
              {episodeTitle && (
                <p className="text-xs sm:text-sm text-gray-300 font-medium">
                  {season ? `S${season} E${episode}: ` : ''}
                  {episodeTitle}
                </p>
              )}
            </div>
          </div>

          {/* Quality & Storage Badges */}
          <div className="flex items-center gap-2">
            {isNasCached && (
              <span className="flex items-center gap-1 bg-amber-500 text-black px-2 py-0.5 rounded text-xs font-black shadow">
                <Zap className="w-3.5 h-3.5 fill-black" />
                ⚡ NAS Direct
              </span>
            )}

            {isOfflineFile && (
              <span className="flex items-center gap-1 bg-blue-600 text-white px-2 py-0.5 rounded text-xs font-bold shadow">
                <Tablet className="w-3.5 h-3.5" />
                📱 Offline File
              </span>
            )}

            <span className="flex items-center gap-1 bg-white/15 text-white px-2 py-0.5 rounded text-xs font-semibold backdrop-blur-md">
              <Sparkles className="w-3.5 h-3.5 text-red-500" />
              4K Dolby Vision • Atmos
            </span>
          </div>
        </div>

        {/* Center Controls (-10s, Play/Pause, +10s) */}
        <div className="flex items-center justify-center gap-10">
          <button
            onClick={() => seekRelative(-10)}
            className="p-3 sm:p-4 rounded-full bg-black/50 hover:bg-black/70 active:scale-95 text-white backdrop-blur-md transition-all"
            title="Seek Back 10 Seconds"
          >
            <RotateCcw className="w-8 h-8 sm:w-10 sm:h-10" />
          </button>

          <button
            onClick={togglePlayPause}
            className="p-5 sm:p-6 rounded-full bg-white text-black hover:bg-white/90 active:scale-95 shadow-2xl transition-all"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="w-10 h-10 sm:w-12 sm:h-12 fill-black" />
            ) : (
              <Play className="w-10 h-10 sm:w-12 sm:h-12 fill-black ml-1" />
            )}
          </button>

          <button
            onClick={() => seekRelative(10)}
            className="p-3 sm:p-4 rounded-full bg-black/50 hover:bg-black/70 active:scale-95 text-white backdrop-blur-md transition-all"
            title="Seek Forward 10 Seconds"
          >
            <RotateCw className="w-8 h-8 sm:w-10 sm:h-10" />
          </button>
        </div>

        {/* Bottom Gradient Bar: Timeline Scrubber & Track Switchers */}
        <div className="bg-gradient-to-t from-black/95 via-black/60 to-transparent p-6 space-y-3">
          {/* Timeline Scrubber */}
          <div className="flex items-center gap-4">
            <span className="text-xs sm:text-sm font-semibold text-gray-300 w-14 text-right">
              {formatTime(currentTimeMs)}
            </span>

            <input
              type="range"
              min="0"
              max="100"
              step="0.1"
              value={progressPercent || 0}
              onChange={handleTimelineScrub}
              className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-red-600"
            />

            <span className="text-xs sm:text-sm font-semibold text-gray-300 w-14">
              {formatTime(durationMs)}
            </span>
          </div>

          {/* Bottom Controls Bar */}
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-4">
              {/* Audio Tracks Switcher */}
              <div className="relative">
                <button
                  onClick={() => setShowAudioMenu(!showAudioMenu)}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                >
                  <Volume2 className="w-4 h-4" />
                  <span>Audio</span>
                </button>

                {showAudioMenu && (
                  <div className="absolute bottom-12 left-0 w-48 bg-[#181818] border border-white/10 rounded-lg shadow-2xl p-2 space-y-1 z-30">
                    <div className="text-[10px] text-gray-400 font-bold px-2 py-1">AUDIO TRACKS</div>
                    {audioTracks.length === 0 && (
                      <div className="text-xs text-gray-500 px-2">Default Audio (Auto)</div>
                    )}
                    {audioTracks.map((track) => (
                      <button
                        key={track.id}
                        onClick={() => {
                          nativePlayer.setAudioTrack(track.id);
                          setShowAudioMenu(false);
                        }}
                        className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-white/10 flex items-center justify-between"
                      >
                        <span>{track.label}</span>
                        {track.selected && <span className="text-red-500 font-bold">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Subtitles Switcher */}
              <div className="relative">
                <button
                  onClick={() => setShowSubtitleMenu(!showSubtitleMenu)}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                >
                  <Subtitles className="w-4 h-4" />
                  <span>Subtitles</span>
                </button>

                {showSubtitleMenu && (
                  <div className="absolute bottom-12 left-0 w-48 bg-[#181818] border border-white/10 rounded-lg shadow-2xl p-2 space-y-1 z-30">
                    <div className="text-[10px] text-gray-400 font-bold px-2 py-1">SUBTITLES</div>
                    <button
                      onClick={() => {
                        nativePlayer.setSubtitleTrack(null);
                        setShowSubtitleMenu(false);
                      }}
                      className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-white/10"
                    >
                      Off
                    </button>
                    {subtitleTracks.map((track) => (
                      <button
                        key={track.id}
                        onClick={() => {
                          nativePlayer.setSubtitleTrack(track.id);
                          setShowSubtitleMenu(false);
                        }}
                        className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-white/10 flex items-center justify-between"
                      >
                        <span>{track.label}</span>
                        {track.selected && <span className="text-red-500 font-bold">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Next Episode Button */}
            {showNextEpisodePrompt && (
              <button
                onClick={onNextEpisode}
                className="flex items-center gap-2 bg-white text-black hover:bg-white/90 active:scale-95 px-5 py-2 rounded-lg font-bold text-sm shadow-xl transition-all animate-bounce"
              >
                <span>Next Episode</span>
                <SkipForward className="w-4 h-4 fill-black" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

