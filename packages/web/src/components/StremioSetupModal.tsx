import React, { useEffect, useState } from 'react';
import {
  X,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Zap,
  Heart,
  Tv,
  Film,
  Save,
} from 'lucide-react';
import { useProfileStore } from '../store/useProfileStore';

interface SmartCacheSettingsState {
  smartSeriesCacheEnabled: boolean;
  smartSeriesTriggerEpisodes: number;
  autoCacheEpisodesAhead: number;
  smartMovieCacheEnabled: boolean;
  movieRewatchThreshold: number;
  likeAutoCacheEnabled: boolean;
}

interface PlayStatItem {
  imdb_id: string;
  media_type: 'movie' | 'tv';
  season: number;
  episode: number;
  title: string;
  play_count: number;
  last_played_at: number;
}

interface StremioSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const StremioSetupModal: React.FC<StremioSetupModalProps> = ({ isOpen, onClose }) => {
  const { activeProfile } = useProfileStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copiedAddon, setCopiedAddon] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  const [stremioAddonUrl, setStremioAddonUrl] = useState('');
  const [stremioInstallUrl, setStremioInstallUrl] = useState('');
  const [aiostreamsUiUrl, setAiostreamsUiUrl] = useState('');
  const [sslEnabled, setSslEnabled] = useState(false);
  const [duckdnsDomain, setDuckdnsDomain] = useState<string | null>(null);
  const [stats, setStats] = useState<{ likedCount: number; cachedCount: number }>({
    likedCount: 0,
    cachedCount: 0,
  });
  const [playStats, setPlayStats] = useState<PlayStatItem[]>([]);

  const [settings, setSettings] = useState<SmartCacheSettingsState>({
    smartSeriesCacheEnabled: true,
    smartSeriesTriggerEpisodes: 3,
    autoCacheEpisodesAhead: 2,
    smartMovieCacheEnabled: true,
    movieRewatchThreshold: 2,
    likeAutoCacheEnabled: true,
  });

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/smart-cache/settings', {
          headers: activeProfile?.id ? { 'X-Profile-Id': activeProfile.id } : {},
        });
        if (res.ok && active) {
          const data = await res.json();
          setStremioAddonUrl(data.stremioAddonUrl || '');
          setStremioInstallUrl(data.stremioInstallUrl || '');
          setAiostreamsUiUrl(data.aiostreamsUiUrl || '');
          setSslEnabled(Boolean(data.sslEnabled));
          setDuckdnsDomain(data.duckdnsDomain || null);
          if (data.settings) setSettings(data.settings);
          if (data.stats) setStats(data.stats);
          if (Array.isArray(data.playStats)) setPlayStats(data.playStats);
        }
      } catch (_) {}
      if (active) setLoading(false);
    };
    load();
    return () => {
      active = false;
    };
  }, [isOpen, activeProfile?.id]);

  if (!isOpen) return null;

  const copyAddonUrl = async () => {
    if (!stremioAddonUrl) return;
    try {
      await navigator.clipboard.writeText(stremioAddonUrl);
      setCopiedAddon(true);
      setTimeout(() => setCopiedAddon(false), 2500);
    } catch (_) {}
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    setSaveFeedback(null);
    try {
      const res = await fetch('/api/smart-cache/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(activeProfile?.id ? { 'X-Profile-Id': activeProfile.id } : {}),
        },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.settings) setSettings(data.settings);
        setSaveFeedback('Smart Cache settings saved');
        setTimeout(() => setSaveFeedback(null), 3000);
      }
    } catch (_) {
      setSaveFeedback('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      data-focus-scope="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-6 overflow-y-auto"
    >
      <div className="relative w-full max-w-3xl bg-[#161616] border border-white/10 rounded-xl shadow-2xl text-white overflow-hidden my-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#1c1c1c]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-600/20 border border-purple-500/40 rounded-lg">
              <Zap className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-black tracking-tight">Stremio, SSL &amp; Smart Cache</h2>
              <p className="text-xs text-gray-400">
                Multi-thread proxy, Caddy + DuckDNS SSL, local NAS cache, and intelligent series/movie caching
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[82vh] overflow-y-auto">
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-400">Loading stack integration status...</div>
          ) : (
            <>
              {/* SSL & AIOStreams Status Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div
                  className={`p-3.5 rounded-lg border flex items-start gap-3 ${
                    sslEnabled
                      ? 'bg-emerald-500/10 border-emerald-500/30'
                      : 'bg-amber-500/10 border-amber-500/30'
                  }`}
                >
                  {sslEnabled ? (
                    <ShieldCheck className="w-5 h-5 text-emerald-400 flex-none mt-0.5" />
                  ) : (
                    <ShieldAlert className="w-5 h-5 text-amber-400 flex-none mt-0.5" />
                  )}
                  <div className="text-xs space-y-1">
                    <div className="font-bold text-sm">
                      {sslEnabled ? 'Caddy + DuckDNS SSL Active' : 'Local LAN Mode (HTTP)'}
                    </div>
                    <p className="text-gray-300 leading-relaxed">
                      {sslEnabled && duckdnsDomain
                        ? `Automatic HTTPS certificates active for https://${duckdnsDomain}`
                        : 'Set ENABLE_CADDY_DUCKDNS=true, DUCKDNS_SUBDOMAIN, and DUCKDNS_TOKEN in stack.env for HTTPS Stremio remote access.'}
                    </p>
                  </div>
                </div>

                <div className="p-3.5 rounded-lg border border-white/10 bg-white/5 flex flex-col justify-between gap-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm">AIOStreams Engine</span>
                    <span className="text-[11px] text-gray-400">
                      {stats.likedCount} Liked • {stats.cachedCount} Cached
                    </span>
                  </div>
                  <p className="text-gray-400">
                    Raw NZBs are filtered out of Stremio streaming (unless TorBox/Premiumize cached) and used automatically for best-quality NAS downloads.
                  </p>
                  {aiostreamsUiUrl && (
                    <a
                      href={aiostreamsUiUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-purple-400 hover:text-purple-300 font-semibold"
                    >
                      <span>Open AIOStreams Config UI</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>

              {/* Stremio Addon Install Card */}
              <div className="p-4 rounded-xl bg-gradient-to-br from-purple-900/20 via-[#1d1d1d] to-red-900/15 border border-purple-500/30 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-sm text-white">Install CineStream Addon in Stremio</h3>
                    <p className="text-xs text-gray-400">
                      Routes Stremio through your Local NAS Cache first, then 8-connection Multi-Thread Proxy with automatic rewatch/series cache triggers.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={stremioAddonUrl}
                    className="flex-1 bg-black/50 border border-white/15 rounded-lg px-3 py-2 text-xs font-mono text-gray-200 focus:outline-none"
                  />
                  <button
                    onClick={copyAddonUrl}
                    className="flex items-center justify-center gap-1.5 bg-white/10 hover:bg-white/20 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors"
                  >
                    {copiedAddon ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedAddon ? 'Copied' : 'Copy URL'}</span>
                  </button>
                  <a
                    href={stremioInstallUrl}
                    className="flex items-center justify-center gap-1.5 bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>Install in Stremio</span>
                  </a>
                </div>
              </div>

              {/* Intelligent Caching Rules */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm">Intelligent NAS Caching Rules</h3>
                  {saveFeedback && (
                    <span className="text-xs font-semibold text-emerald-400">{saveFeedback}</span>
                  )}
                </div>

                <div className="space-y-3 bg-white/5 border border-white/10 rounded-xl p-4 text-xs">
                  {/* Series Auto-Cache */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
                    <div className="flex items-start gap-2.5">
                      <Tv className="w-4 h-4 text-blue-400 mt-0.5 flex-none" />
                      <div>
                        <div className="font-bold text-sm text-white">Intelligent Series Cache</div>
                        <p className="text-gray-400">
                          Automatically caches upcoming episodes in best quality once you watch multiple episodes of a series.
                        </p>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer self-start sm:self-center">
                      <input
                        type="checkbox"
                        checked={settings.smartSeriesCacheEnabled}
                        onChange={(e) =>
                          setSettings((s) => ({ ...s, smartSeriesCacheEnabled: e.target.checked }))
                        }
                        className="w-4 h-4 accent-red-600"
                      />
                      <span className="font-semibold">Enabled</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-3 border-b border-white/10">
                    <label className="flex items-center justify-between gap-2 bg-black/30 px-3 py-2 rounded-lg border border-white/5">
                      <span className="text-gray-300">Trigger after watched episodes</span>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={settings.smartSeriesTriggerEpisodes}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            smartSeriesTriggerEpisodes: Math.max(1, parseInt(e.target.value, 10) || 3),
                          }))
                        }
                        className="w-16 bg-black/60 border border-white/15 rounded px-2 py-1 text-right font-bold"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 bg-black/30 px-3 py-2 rounded-lg border border-white/5">
                      <span className="text-gray-300">Rolling episodes ahead</span>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={settings.autoCacheEpisodesAhead}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            autoCacheEpisodesAhead: Math.max(1, parseInt(e.target.value, 10) || 2),
                          }))
                        }
                        className="w-16 bg-black/60 border border-white/15 rounded px-2 py-1 text-right font-bold"
                      />
                    </label>
                  </div>

                  {/* Movie Rewatch Auto-Cache */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
                    <div className="flex items-start gap-2.5">
                      <Film className="w-4 h-4 text-amber-400 mt-0.5 flex-none" />
                      <div>
                        <div className="font-bold text-sm text-white">Intelligent Movie Rewatch Cache</div>
                        <p className="text-gray-400">
                          Automatically caches movies played multiple separate times (e.g., kids favorites &amp; rewatches).
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 self-start sm:self-center">
                      <input
                        type="number"
                        min={2}
                        max={10}
                        value={settings.movieRewatchThreshold}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            movieRewatchThreshold: Math.max(2, parseInt(e.target.value, 10) || 2),
                          }))
                        }
                        className="w-14 bg-black/60 border border-white/15 rounded px-2 py-1 text-right font-bold"
                        title="Minimum watch sessions before auto-caching"
                      />
                      <span className="text-gray-400">watches</span>
                      <input
                        type="checkbox"
                        checked={settings.smartMovieCacheEnabled}
                        onChange={(e) =>
                          setSettings((s) => ({ ...s, smartMovieCacheEnabled: e.target.checked }))
                        }
                        className="w-4 h-4 accent-red-600"
                      />
                    </div>
                  </div>

                  {/* Like Movie Auto-Cache */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <Heart className="w-4 h-4 text-rose-400 fill-rose-400 mt-0.5 flex-none" />
                      <div>
                        <div className="font-bold text-sm text-white">Auto-Cache Liked Movies</div>
                        <p className="text-gray-400">
                          Clicking ❤️ Like on a movie allows &amp; queues its highest available quality (Debrid/NZB) to your NAS.
                        </p>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer self-start sm:self-center">
                      <input
                        type="checkbox"
                        checked={settings.likeAutoCacheEnabled}
                        onChange={(e) =>
                          setSettings((s) => ({ ...s, likeAutoCacheEnabled: e.target.checked }))
                        }
                        className="w-4 h-4 accent-red-600"
                      />
                      <span className="font-semibold">Enabled</span>
                    </label>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={handleSaveSettings}
                    disabled={saving}
                    className="flex items-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors"
                  >
                    <Save className="w-4 h-4" />
                    <span>{saving ? 'Saving...' : 'Save Smart Cache Settings'}</span>
                  </button>
                </div>
              </div>

              {/* Recent Stremio / Proxy Watch Activity */}
              {playStats.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-bold text-sm">Recent Tracked Streams</h3>
                  <div className="bg-black/40 border border-white/10 rounded-lg divide-y divide-white/5 max-h-40 overflow-y-auto text-xs">
                    {playStats.slice(0, 10).map((ps) => (
                      <div
                        key={`${ps.imdb_id}:${ps.season}:${ps.episode}`}
                        className="flex items-center justify-between px-3 py-2"
                      >
                        <div className="truncate font-medium text-gray-200">
                          {ps.title || ps.imdb_id}
                          {ps.media_type === 'tv' && ` • S${String(ps.season).padStart(2, '0')}E${String(ps.episode).padStart(2, '0')}`}
                        </div>
                        <div className="flex items-center gap-2 flex-none text-[11px] text-gray-400">
                          <span className="bg-white/10 text-white px-2 py-0.5 rounded font-bold">
                            {ps.play_count}x played
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
