import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  ExternalLink,
  Copy,
  Check,
  AlertTriangle,
  Download,
  Maximize,
  Minimize,
  RefreshCw,
  Monitor,
} from 'lucide-react';
import { TrackInfo } from '@cinestream/capacitor-native-player';
import { nativePlayer } from '../bridge/nativePlayer';
import { useProfileStore } from '../store/useProfileStore';
import { ProviderBadge } from './ProviderBadge';

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
  provider?: string;
  qualityBadge?: string;
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
  provider,
  qualityBadge,
  onClose,
  onNextEpisode,
}) => {
  const { activeProfile } = useProfileStore();

  const isDesktopPc = useMemo(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    return !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }, []);

  const [playerMode, setPlayerMode] = useState<'vlc_detecting' | 'vlc_active' | 'web_player'>(() => {
    try {
      const saved = localStorage.getItem('cinestream_preferred_player');
      if (saved === 'vlc') return 'vlc_detecting';
      if (saved === 'web') return 'web_player';
    } catch (_) {}
    // Default to seamless Web Player with 4K HDR Remux Engine
    return 'web_player';
  });

  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [showOsd, setShowOsd] = useState(true);

  // Audio & Subtitle Tracks
  const [audioTracks, setAudioTracks] = useState<TrackInfo[]>([]);
  const [subtitleTracks, setSubtitleTracks] = useState<TrackInfo[]>([]);
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [videoMode, setVideoModeState] = useState<'copy' | 'transcode'>(() => {
    try {
      return (localStorage.getItem('cinestream_web_video_mode') as any) || 'copy';
    } catch (_) {
      return 'copy';
    }
  });

  const toggleVideoMode = () => {
    const next = videoMode === 'copy' ? 'transcode' : 'copy';
    setVideoModeState(next);
    nativePlayer.setVideoMode(next);
  };

  const absoluteStreamUrl = streamUrl.startsWith('http')
    ? streamUrl
    : `${window.location.origin}${streamUrl}`;

  const copyToClipboard = async (text: string): Promise<boolean> => {
    // 1. Try modern clipboard API if available and in secure context
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {}
    }

    // 2. Reliable fallback for HTTP non-secure contexts
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.top = '0';
      textArea.style.left = '0';
      textArea.style.width = '2em';
      textArea.style.height = '2em';
      textArea.style.padding = '0';
      textArea.style.border = 'none';
      textArea.style.outline = 'none';
      textArea.style.boxShadow = 'none';
      textArea.style.background = 'transparent';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      if (successful) return true;
    } catch (err) {
      console.error('execCommand copy error:', err);
    }
    return false;
  };

  const copyStreamUrl = async () => {
    const ok = await copyToClipboard(absoluteStreamUrl);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  const launchVlcProtocol = () => {
    const vlcUrl = `vlc://${absoluteStreamUrl}`;
    try {
      window.location.href = vlcUrl;
    } catch (_) {
      const a = document.createElement('a');
      a.href = vlcUrl;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const downloadVlcM3u = () => {
    const safeTitle = `${title}${episodeTitle ? ` - ${episodeTitle}` : ''}`;
    const m3uUrl = `/api/streams/playlist.m3u?url=${encodeURIComponent(absoluteStreamUrl)}&title=${encodeURIComponent(safeTitle)}`;
    const a = document.createElement('a');
    a.href = m3uUrl;
    const safeFilename = `${title.replace(/[^a-zA-Z0-9_-]/g, '_')}.m3u`;
    a.download = safeFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setPlayerMode('vlc_active');
  };

  const openInVlc = () => {
    launchVlcProtocol();
    setPlayerMode('vlc_active');
  };

  const [detectCountdown, setDetectCountdown] = useState(8);

  // PC: Auto-attempt launching VLC media player via custom protocol
  useEffect(() => {
    if (playerMode !== 'vlc_detecting') return;

    // Dispatch vlc:// protocol attempt directly
    launchVlcProtocol();

    let detected = false;
    const onAppBlur = () => {
      detected = true;
      setPlayerMode('vlc_active');
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        detected = true;
        setPlayerMode('vlc_active');
      }
    };

    window.addEventListener('blur', onAppBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);

    const countdownTimer = setInterval(() => {
      setDetectCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownTimer);
          if (!detected) {
            setPlayerMode('web_player');
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(countdownTimer);
      window.removeEventListener('blur', onAppBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [playerMode, absoluteStreamUrl]);

  // Sync initial progress when launching external VLC
  useEffect(() => {
    if (playerMode === 'vlc_active' && imdbId) {
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
          position_ms: 5000,
          duration_ms: 0,
          last_stream_url: streamUrl,
        }),
      }).catch(() => {});
    }
  }, [playerMode, imdbId, tmdbId, season, episode, title, episodeTitle, streamUrl, activeProfile]);

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
    if (playerMode !== 'web_player') return;

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

    const unsubError = nativePlayer.onError((msg) => {
      console.warn('Native player reported error:', msg);
      setPlayerError(msg || 'Video format could not be decoded by browser');
      setShowOsd(true);
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
      unsubError();
      nativePlayer.stop();
    };
  }, [playerMode, streamUrl]);

  const toggleFullscreen = () => {
    wakeOsd();
    if (!document.fullscreenElement) {
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
  };

  // Auto-enter fullscreen on launch in desktop browsers (only when active in web player)
  useEffect(() => {
    if (playerMode !== 'web_player') return;

    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {
        // Handled silently if browser policy blocks auto-fullscreen without gesture
      });
    }

    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [playerMode]);

  const handleClose = () => {
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
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

  // Keyboard navigation (Living Room / Laptop D-pad / Hotkeys)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Universal Back / Exit across all player modes
      if (
        e.key === 'Escape' ||
        e.key === 'Backspace' ||
        e.key === 'GoBack' ||
        e.key === 'BrowserBack' ||
        e.keyCode === 4 ||
        e.keyCode === 8 ||
        e.keyCode === 27 ||
        e.keyCode === 461 ||
        e.keyCode === 10009
      ) {
        e.preventDefault();
        handleClose();
        return;
      }

      if (playerMode !== 'web_player') return;

      wakeOsd();
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === ' ' || e.key === 'Enter' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        togglePlayPause();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekRelative(-10);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekRelative(10);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [playerMode, isPlaying, currentTimeMs, durationMs]);

  const handleTimelineScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    wakeOsd();
    const pct = parseFloat(e.target.value);
    const newPos = (pct / 100) * durationMs;
    nativePlayer.seekTo(newPos);
  };

  const progressPercent = durationMs > 0 ? (currentTimeMs / durationMs) * 100 : 0;
  const showNextEpisodePrompt =
    onNextEpisode && durationMs > 0 && currentTimeMs >= durationMs - 35000;

  if (playerMode === 'vlc_detecting') {
    return (
      <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex items-center justify-center p-4 select-none">
        <div className="max-w-md w-full bg-[#18181b] border border-orange-500/30 rounded-2xl p-6 sm:p-8 text-center space-y-5 shadow-2xl">
          <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-orange-500/20 animate-ping" />
            <div className="relative w-14 h-14 rounded-full bg-orange-600/30 border border-orange-500/50 flex items-center justify-center text-orange-400">
              <Monitor className="w-7 h-7 animate-pulse" />
            </div>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-xl font-bold text-white tracking-wide">Launching VLC Media Player</h3>
            <p className="text-xs text-gray-300">
              Opening stream in VLC on your PC. If prompted by your browser, please click <strong className="text-white">Open VLC</strong>.
            </p>
          </div>

          <div className="flex items-center justify-center gap-2 py-1">
            <RefreshCw className="w-4 h-4 text-orange-400 animate-spin" />
            <span className="text-xs font-medium text-orange-300">
              {detectCountdown > 0
                ? `Waiting for VLC (${detectCountdown}s)...`
                : 'Switching to web player...'}
            </span>
          </div>

          <div className="flex flex-col gap-2 pt-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={openInVlc}
                tabIndex={0}
                className="py-2.5 px-3 bg-orange-600 hover:bg-orange-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow transition-all flex items-center justify-center gap-1.5 focus:ring-2 focus:ring-orange-400 focus:outline-none"
              >
                <Monitor className="w-4 h-4" />
                Launch VLC
              </button>
              <button
                onClick={downloadVlcM3u}
                tabIndex={0}
                className="py-2.5 px-3 bg-white/15 hover:bg-white/25 active:scale-95 text-white font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5 focus:ring-2 focus:ring-white/40 focus:outline-none"
                title="Download .m3u playlist file which opens directly in VLC"
              >
                <Download className="w-4 h-4" />
                Open .m3u
              </button>
            </div>

            <button
              onClick={() => setPlayerMode('web_player')}
              tabIndex={0}
              className="w-full py-2.5 px-4 bg-white/10 hover:bg-white/20 active:scale-95 text-white font-semibold text-xs rounded-xl transition-all focus:ring-2 focus:ring-white/40 focus:outline-none"
            >
              Play in Web Player Now
            </button>
            <button
              onClick={() => {
                try {
                  localStorage.setItem('cinestream_preferred_player', 'web');
                } catch (_) {}
                setPlayerMode('web_player');
              }}
              className="w-full py-1.5 px-3 text-[11px] text-gray-400 hover:text-white transition-colors"
            >
              Always use Web Player on this PC
            </button>
          </div>

          <button
            onClick={handleClose}
            tabIndex={0}
            className="text-xs text-gray-500 hover:text-gray-300 pt-1 block mx-auto underline focus:outline-none focus:text-white"
          >
            Cancel & Return to CineStream
          </button>
        </div>
      </div>
    );
  }

  if (playerMode === 'vlc_active') {
    return (
      <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex items-center justify-center p-4 select-none">
        <div className="max-w-lg w-full bg-[#18181b] border border-orange-500/40 rounded-2xl p-6 sm:p-8 text-center space-y-5 shadow-2xl">
          <div className="w-16 h-16 rounded-full bg-orange-600/20 border border-orange-500/40 flex items-center justify-center mx-auto text-orange-400 shadow-lg">
            <Monitor className="w-8 h-8" />
          </div>

          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400 text-[11px] font-bold uppercase tracking-wider mb-1">
              <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
              VLC Active
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white">{title}</h2>
            {episodeTitle && (
              <p className="text-xs sm:text-sm text-gray-300 font-medium">
                {season ? `S${season} E${episode}: ` : ''}{episodeTitle}
              </p>
            )}
          </div>

          <p className="text-xs text-gray-300 leading-relaxed max-w-sm mx-auto">
            Stream launched in VLC Media Player. Enjoy full surround sound, HDR/Dolby Vision, and hardware decoding.
          </p>

          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <button
              onClick={() => setPlayerMode('web_player')}
              className="flex-1 py-2.5 px-4 bg-white text-black hover:bg-white/90 active:scale-95 font-bold text-xs rounded-xl shadow-lg transition-all"
            >
              Switch to Web Player
            </button>
            <button
              onClick={downloadVlcM3u}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-4 bg-orange-600 hover:bg-orange-700 active:scale-95 text-white font-bold text-xs rounded-xl transition-all shadow"
              title="Download .m3u to re-open stream in VLC"
            >
              <Download className="w-4 h-4" />
              Re-open in VLC (.m3u)
            </button>
          </div>

          <div className="space-y-1.5 text-left pt-2">
            <label className="text-[11px] font-semibold text-gray-400">Stream Link:</label>
            <div className="flex items-center gap-1.5 bg-black/60 border border-white/20 rounded-xl p-1.5">
              <input
                type="text"
                readOnly
                value={absoluteStreamUrl}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                className="flex-1 bg-transparent border-none text-[11px] text-gray-300 font-mono focus:outline-none select-all px-2 overflow-ellipsis"
              />
              <button
                onClick={copyStreamUrl}
                className="px-2.5 py-1 bg-white/15 hover:bg-white/25 active:scale-95 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition-all"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={handleClose}
              className="text-xs text-gray-400 hover:text-white underline"
            >
              Return to CineStream
            </button>
          </div>
        </div>
      </div>
    );
  }

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
            {provider && <ProviderBadge source={provider} />}

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

            {qualityBadge && (
              <span className="flex items-center gap-1 bg-white/15 text-white px-2 py-0.5 rounded text-xs font-semibold backdrop-blur-md">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                {qualityBadge}
              </span>
            )}

            <button
              onClick={toggleVideoMode}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold backdrop-blur-md transition-all border active:scale-95"
              style={{
                backgroundColor: videoMode === 'copy' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(234, 88, 12, 0.2)',
                borderColor: videoMode === 'copy' ? 'rgba(16, 185, 129, 0.4)' : 'rgba(234, 88, 12, 0.4)',
                color: videoMode === 'copy' ? '#34d399' : '#fb923c',
              }}
              title="Click to toggle between Direct 4K Remux (0% CPU) and Compatibility Transcode (H.264)"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>{videoMode === 'copy' ? '⚡ 4K Remux Direct' : '🎬 Compatibility Transcode'}</span>
            </button>

            <button
              onClick={copyStreamUrl}
              title="Copy Stream URL (for VLC, MPV, or PotPlayer)"
              className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 active:scale-95 text-white px-2.5 py-1 rounded-lg text-xs font-semibold backdrop-blur-md transition-all"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy Stream'}</span>
            </button>

            {isDesktopPc && (
              <button
                onClick={() => setPlayerMode('vlc_detecting')}
                title="Launch stream in VLC Media Player"
                className="hidden sm:flex items-center gap-1.5 bg-orange-600/80 hover:bg-orange-600 active:scale-95 text-white px-2.5 py-1 rounded-lg text-xs font-semibold backdrop-blur-md transition-all shadow"
              >
                <Monitor className="w-3.5 h-3.5" />
                <span>Open in VLC</span>
              </button>
            )}

            <button
              onClick={downloadVlcM3u}
              title="Download playlist to open instantly in VLC"
              className="hidden sm:flex items-center gap-1.5 bg-white/10 hover:bg-white/20 active:scale-95 text-white px-2.5 py-1 rounded-lg text-xs font-semibold backdrop-blur-md transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              <span>.m3u</span>
            </button>
          </div>
        </div>

        {/* Browser Codec Error Modal */}
        {playerError && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 sm:p-6">
            <div className="max-w-lg w-full bg-[#1c1c1e] border border-red-500/40 rounded-2xl p-6 text-center space-y-4 shadow-2xl">
              <div className="w-12 h-12 rounded-full bg-red-500/20 text-red-500 flex items-center justify-center mx-auto">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Browser Playback Notice</h3>
                {provider && (
                  <div className="mt-1 flex justify-center">
                    <ProviderBadge source={provider} />
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-300 leading-relaxed">
                Your browser could not decode this stream format directly (MKV container, TrueHD/DTS audio, or HEVC video).
                Stream smoothly by launching directly in VLC or copying the link.
              </p>

              {/* Action Buttons: Compatibility Mode + VLC (.m3u) + Copy Button */}
              <div className="space-y-2 pt-1">
                <button
                  onClick={() => {
                    setVideoModeState('transcode');
                    nativePlayer.setVideoMode('transcode');
                    setPlayerError(null);
                  }}
                  className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow transition-all flex items-center justify-center gap-2"
                >
                  <Zap className="w-4 h-4" />
                  Try Compatibility Transcode Mode (H.264)
                </button>

                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={downloadVlcM3u}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-orange-600 hover:bg-orange-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow transition-all"
                    title="Downloads a .m3u file that opens immediately in VLC"
                  >
                    <Download className="w-4 h-4" />
                    Open in VLC (.m3u)
                  </button>
                  <button
                    onClick={copyStreamUrl}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-white/10 hover:bg-white/20 active:scale-95 text-white font-bold text-xs rounded-xl transition-all"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copied URL!' : 'Copy Stream URL'}
                  </button>
                </div>
              </div>

              {/* Visible Direct Stream Link Box */}
              <div className="space-y-1.5 text-left pt-2">
                <label className="text-[11px] font-semibold text-gray-400">Direct Stream Link (VLC / MPV / PotPlayer):</label>
                <div className="flex items-center gap-1.5 bg-black/60 border border-white/20 rounded-xl p-1.5">
                  <input
                    type="text"
                    readOnly
                    value={absoluteStreamUrl}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    className="flex-1 bg-transparent border-none text-[11px] text-gray-300 font-mono focus:outline-none select-all px-2 overflow-ellipsis"
                  />
                  <button
                    onClick={copyStreamUrl}
                    className="px-2.5 py-1 bg-white/15 hover:bg-white/25 active:scale-95 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition-all"
                    title="Copy Link"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              <div>
                <button
                  onClick={handleClose}
                  className="text-xs text-gray-400 hover:text-white underline pt-1"
                >
                  Return to CineStream
                </button>
              </div>
            </div>
          </div>
        )}

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

              {/* Fullscreen Toggle Button */}
              <button
                onClick={toggleFullscreen}
                title={isFullscreen ? 'Exit Fullscreen (F)' : 'Fullscreen (F)'}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 text-white transition-all"
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                <span className="hidden sm:inline">{isFullscreen ? 'Exit' : 'Fullscreen'}</span>
              </button>
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

