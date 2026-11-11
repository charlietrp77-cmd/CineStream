import React, { useState, useEffect } from 'react';
import {
  X,
  HardDrive,
  Tablet,
  Play,
  Pause,
  Trash2,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  WifiOff,
  Download,
  Zap,
  Cloud,
  Settings,
  ExternalLink,
} from 'lucide-react';
import { DiskSpaceInfo, NasCacheItem, OfflineMediaItem, ProviderQuota, ResolvedStream, ArrStatus } from '../types/api';
import { useOfflineStore } from '../store/useOfflineStore';
import { useProfileStore } from '../store/useProfileStore';
import { offlineDownloader } from '../bridge/offlineDownloader';
import {
  PremiumizeIcon,
  TorboxIcon,
  EasynewsIcon,
  RealDebridIcon,
  AllDebridIcon,
  AlthubIcon,
  NzbgeekIcon,
  DrunkenslugIcon,
  SabnzbdIcon,
  SonarrIcon,
  RadarrIcon,
} from './ProviderBadge';

interface DownloadsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onPlayOffline: (item: OfflineMediaItem) => void;
  onPlayNasItem: (item: NasCacheItem) => void;
}

export const DownloadsDrawer: React.FC<DownloadsDrawerProps> = ({
  isOpen,
  onClose,
  onPlayOffline,
  onPlayNasItem,
}) => {
  const [activeTab, setActiveTab] = useState<'nas' | 'device'>('nas');
  const [diskSpace, setDiskSpace] = useState<DiskSpaceInfo | null>(null);
  const [nasJobs, setNasJobs] = useState<NasCacheItem[]>([]);
  const [providerQuotas, setProviderQuotas] = useState<ProviderQuota[]>([]);
  const [arrStatus, setArrStatus] = useState<ArrStatus | null>(null);
  const [showArrSettings, setShowArrSettings] = useState(false);
  const [arrSettingsForm, setArrSettingsForm] = useState({
    radarr_url: '',
    radarr_api_key: '',
    sonarr_url: '',
    sonarr_api_key: '',
    sabnzbd_api_key: '',
    althub_api_key: '',
    nzbgeek_api_key: '',
    drunkenslug_api_key: '',
  });
  const [arrSaving, setArrSaving] = useState(false);
  const [arrSaveMessage, setArrSaveMessage] = useState<string | null>(null);
  const [syncingIndexers, setSyncingIndexers] = useState(false);
  const [syncIndexersMessage, setSyncIndexersMessage] = useState<string | null>(null);

  const { activeProfile } = useProfileStore();
  const { offlineItems, removeItem: removeOfflineItem, saveItem } = useOfflineStore();

  // Load disk space, provider quotas, arr status & setup WebSocket
  useEffect(() => {
    if (!isOpen) return;

    fetchDiskSpace();
    fetchNasJobs();
    fetchProviderQuotas();
    fetchArrStatus();

    // Setup live WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/downloads`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.jobs) {
          setNasJobs(data.jobs);
        }
      } catch (_) {}
    };

    const unsubscribeDownloader = offlineDownloader.onProgress((updated) => {
      saveItem(updated);
    });

    return () => {
      ws.close();
      unsubscribeDownloader();
    };
  }, [isOpen, activeProfile?.id]);

  const fetchProviderQuotas = async () => {
    try {
      const res = await fetch('/api/providers/quotas', {
        headers: activeProfile?.id ? { 'X-Profile-Id': activeProfile.id } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setProviderQuotas(data);
      }
    } catch (_) {}
  };

  const fetchArrStatus = async () => {
    try {
      const res = await fetch('/api/arr/status');
      if (res.ok) {
        setArrStatus(await res.json());
      }
      const sRes = await fetch('/api/arr/settings');
      if (sRes.ok) {
        setArrSettingsForm(await sRes.json());
      }
    } catch (_) {}
  };

  const handleSaveArrSettings = async () => {
    setArrSaving(true);
    setArrSaveMessage(null);
    try {
      const res = await fetch('/api/arr/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(arrSettingsForm),
      });
      if (res.ok) {
        const data = await res.json();
        setArrStatus(data.status);
        if (data.sabSync?.verified) {
          setArrSaveMessage('Settings saved! SABnzbd verified & linked to Radarr & Sonarr.');
        } else if (data.sabSync?.radarr || data.sabSync?.sonarr) {
          setArrSaveMessage('Settings saved! SABnzbd synced to Arr clients.');
        } else {
          setArrSaveMessage('Settings saved. (Verify SABnzbd API key if downloader warning persists)');
        }
        setTimeout(() => {
          setArrSaveMessage(null);
          setShowArrSettings(false);
        }, 2500);
      } else {
        setArrSaveMessage('Failed to save settings.');
      }
    } catch (err: any) {
      setArrSaveMessage(`Error: ${err.message}`);
    } finally {
      setArrSaving(false);
    }
  };

  const handleSyncIndexers = async () => {
    setSyncingIndexers(true);
    setSyncIndexersMessage(null);
    try {
      const res = await fetch('/api/arr/sync-indexers', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        const sab = data.results?.sabnzbd;
        const sabNote = sab?.verified
          ? 'SABnzbd verified & synced!'
          : sab?.radarr || sab?.sonarr
          ? 'SABnzbd synced to Arr!'
          : 'Check SABnzbd API key in settings.';
        setSyncIndexersMessage(`Synced: ${sabNote}`);
        await fetchArrStatus();
      } else {
        setSyncIndexersMessage('Indexer sync failed.');
      }
    } catch (_) {
      setSyncIndexersMessage('Sync connection error.');
    } finally {
      setSyncingIndexers(false);
      setTimeout(() => setSyncIndexersMessage(null), 3000);
    }
  };

  const fetchDiskSpace = async () => {
    try {
      const res = await fetch('/api/nas/disk');
      if (res.ok) {
        const data = await res.json();
        setDiskSpace(data);
      }
    } catch (_) {}
  };

  const fetchNasJobs = async () => {
    try {
      const res = await fetch('/api/nas/jobs');
      if (res.ok) {
        const data = await res.json();
        setNasJobs(data);
      }
    } catch (_) {}
  };

  const handlePauseNasJob = async (id: string) => {
    await fetch(`/api/nas/jobs/${encodeURIComponent(id)}/pause`, { method: 'POST' });
    fetchNasJobs();
  };

  const handleResumeNasJob = async (id: string) => {
    await fetch(`/api/nas/jobs/${encodeURIComponent(id)}/resume`, { method: 'POST' });
    fetchNasJobs();
  };

  const handleDeleteNasJob = async (id: string) => {
    if (confirm('Delete this download and its file from NAS?')) {
      await fetch(`/api/nas/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
      fetchNasJobs();
      fetchDiskSpace();
    }
  };

  const handleDownloadNasToDevice = async (job: NasCacheItem) => {
    // 1. Trigger direct browser download
    const downloadUrl = `/api/nas/stream/${encodeURIComponent(job.id)}?download=1`;
    const link = document.createElement('a');
    link.href = downloadUrl;
    const pad = (n: number) => n.toString().padStart(2, '0');
    link.download = `${job.title}${job.episode_title ? ` - S${pad(job.season)}E${pad(job.episode)} - ${job.episode_title}` : ''}.mkv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // 2. Also register with offlineDownloader on native/offline store
    try {
      const downloadedItem = await offlineDownloader.startDownload({
        downloadId: `nas_local_${job.id}`,
        imdbId: job.imdb_id,
        tmdbId: job.tmdb_id,
        mediaType: job.media_type,
        season: job.season,
        episode: job.episode,
        title: job.title,
        episodeTitle: job.episode_title || undefined,
        posterUrl: job.poster_url || undefined,
        backdropUrl: job.backdrop_url || undefined,
        streamUrl: `${window.location.origin}/api/nas/stream/${encodeURIComponent(job.id)}`,
      });
      await saveItem(downloadedItem);
    } catch (_) {}
  };

  if (!isOpen) return null;

  const diskUsedPercent = diskSpace && diskSpace.totalBytes > 0
    ? Math.round((diskSpace.usedBytes / diskSpace.totalBytes) * 100)
    : 0;

  const formatGb = (bytes: number) => {
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  };

  const formatSpeed = (bytesPerSec: number) => {
    if (!bytesPerSec) return '0 MB/s';
    return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' MB/s';
  };

  const getExternalArrUrl = (rawUrl?: string, externalUrl?: string, defaultPort = 7878): string => {
    if (externalUrl && !/^(radarr|sonarr|cinestream|sabnzbd|localhost|127\.0\.0\.1)/i.test(new URL(externalUrl).hostname)) {
      return externalUrl;
    }
    if (!rawUrl) return '';
    try {
      const parsed = new URL(rawUrl);
      const clientHost = window.location.hostname || 'localhost';
      const isContainer = /^(radarr|sonarr|cinestream|cinestream-server|sabnzbd|localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(parsed.hostname);
      const hostname = isContainer ? clientHost : parsed.hostname;
      const port = parsed.port || String(defaultPort);
      return `${parsed.protocol || 'http:'}//${hostname}:${port}${parsed.pathname === '/' ? '' : parsed.pathname}`;
    } catch (_) {
      const clientHost = window.location.hostname || 'localhost';
      return `http://${clientHost}:${defaultPort}`;
    }
  };

  const radarrLink = getExternalArrUrl(arrStatus?.radarr.url, arrStatus?.radarr.externalUrl, 7878);
  const sonarrLink = getExternalArrUrl(arrStatus?.sonarr.url, arrStatus?.sonarr.externalUrl, 8989);

  return (
    <div data-focus-scope="true" className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm select-none">
      <div className="w-full max-w-xl h-full bg-[#181818] border-l border-white/10 flex flex-col shadow-2xl text-white">
        {/* Drawer Header */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive className="w-6 h-6 text-red-600" />
            <h2 className="text-xl font-bold">Storage & Downloads</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-white/10 text-gray-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-white"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Cloud Provider Quotas (TorBox, Premiumize, Easynews, RealDebrid, AllDebrid) - Above Storage Tabs */}
        {providerQuotas.length > 0 && (
          <div className="px-6 py-3.5 border-b border-white/10 bg-white/[0.02] space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-gray-300 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-cyan-400" />
                Debrid & Usenet Provider Quotas
              </span>
              <span className="text-[11px] text-gray-400">Cloud Stream Balance</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {providerQuotas.map((q) => (
                <div
                  key={q.provider}
                  className="p-2.5 bg-black/40 rounded-lg border border-white/5 space-y-1.5 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {q.provider === 'torbox' && <TorboxIcon className="w-4 h-4 shrink-0" />}
                      {q.provider === 'premiumize' && <PremiumizeIcon className="w-4 h-4 shrink-0" />}
                      {q.provider === 'easynews' && <EasynewsIcon className="w-4 h-4 shrink-0" />}
                      {q.provider === 'realdebrid' && <RealDebridIcon className="w-4 h-4 shrink-0" />}
                      {q.provider === 'alldebrid' && <AllDebridIcon className="w-4 h-4 shrink-0" />}
                      <div>
                        <p className="font-bold text-gray-200">{q.name}</p>
                        {q.plan && <p className="text-[10px] text-gray-400">{q.plan}</p>}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-white">{q.remainingGbText}</p>
                      <p className="text-[10px] text-gray-400">
                        {q.daysRemaining !== undefined ? `${q.daysRemaining}d left` : 'remaining'}
                      </p>
                    </div>
                  </div>

                  {q.percentUsed !== undefined && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-gray-400">
                        <span>Used: {q.percentUsed}%</span>
                        {q.totalBytes && (
                          <span>{Math.round(q.totalBytes / (1024 * 1024 * 1024))} GB cap</span>
                        )}
                      </div>
                      <div className="h-1.5 w-full bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            q.percentUsed > 90
                              ? 'bg-red-500'
                              : q.percentUsed > 75
                              ? 'bg-amber-500'
                              : 'bg-cyan-500'
                          }`}
                          style={{ width: `${q.percentUsed}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab Selector */}
        <div className="flex border-b border-white/10">
          <button
            data-autofocus={activeTab === 'nas' ? 'true' : undefined}
            onClick={() => setActiveTab('nas')}
            className={`flex-1 py-3 text-sm font-bold flex items-center justify-center gap-2 border-b-2 transition-all focus:outline-none focus:ring-2 focus:ring-red-600 ${
              activeTab === 'nas'
                ? 'border-red-600 text-white bg-white/5'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <HardDrive className="w-4 h-4" />
            <span>NAS Cache ({nasJobs.length})</span>
          </button>
          <button
            data-autofocus={activeTab === 'device' ? 'true' : undefined}
            onClick={() => setActiveTab('device')}
            className={`flex-1 py-3 text-sm font-bold flex items-center justify-center gap-2 border-b-2 transition-all focus:outline-none focus:ring-2 focus:ring-red-600 ${
              activeTab === 'device'
                ? 'border-red-600 text-white bg-white/5'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Tablet className="w-4 h-4" />
            <span>This Device ({offlineItems.length})</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'nas' ? (
            <>
              {/* NAS Disk Space Bar */}
              {diskSpace && (
                <div className="p-4 bg-white/5 rounded-xl border border-white/10 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-gray-300">NAS Storage Pool (/mnt/nas)</span>
                    <span className="text-gray-400">
                      {formatGb(diskSpace.freeBytes)} free of {formatGb(diskSpace.totalBytes)}
                    </span>
                  </div>
                  <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        diskUsedPercent > 90 ? 'bg-red-600' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${diskUsedPercent}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Radarr & Sonarr Integration Status & Settings */}
              <div className="p-4 bg-white/5 rounded-xl border border-white/10 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-gray-300 flex items-center gap-2">
                    <span className="flex items-center -space-x-1 shrink-0">
                      <RadarrIcon className="w-4 h-4 shrink-0" />
                      <SonarrIcon className="w-4 h-4 shrink-0" />
                    </span>
                    Radarr & Sonarr Indexer Search (±10% Size Match)
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSyncIndexers}
                      disabled={syncingIndexers}
                      title="Sync AltHub, NZBGeek, and DrunkenSlug indexers into Sonarr & Radarr"
                      className="flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 px-2 py-0.5 rounded bg-cyan-500/10 hover:bg-cyan-500/20 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${syncingIndexers ? 'animate-spin' : ''}`} />
                      <span>{syncingIndexers ? 'Syncing...' : 'Sync Indexers'}</span>
                    </button>
                    <button
                      onClick={() => setShowArrSettings(!showArrSettings)}
                      className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-white px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 transition-colors"
                    >
                      <Settings className="w-3 h-3" />
                      <span>{showArrSettings ? 'Close' : 'Configure'}</span>
                    </button>
                  </div>
                </div>

                {syncIndexersMessage && (
                  <p className="text-[11px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-md">
                    {syncIndexersMessage}
                  </p>
                )}

                {/* Status Badges with Clickable IP URLs & Brand Icons */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 bg-black/40 rounded-lg border border-white/5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <RadarrIcon className="w-5 h-5 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <span className="font-bold text-gray-200">Radarr (Movies)</span>
                        {radarrLink ? (
                          <a
                            href={radarrLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 hover:underline truncate mt-0.5 group"
                            title={`Open Radarr at ${radarrLink}`}
                          >
                            <span className="truncate">{radarrLink}</span>
                            <ExternalLink className="w-3 h-3 flex-shrink-0 text-cyan-400/80 group-hover:text-cyan-300" />
                          </a>
                        ) : (
                          <p className="text-[10px] text-gray-400 truncate">Not set</p>
                        )}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold flex-shrink-0 ${
                        arrStatus?.radarr.online
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : arrStatus?.radarr.configured
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-white/10 text-gray-400'
                      }`}
                    >
                      {arrStatus?.radarr.online ? 'Online' : arrStatus?.radarr.configured ? 'Offline' : 'Not Set'}
                    </span>
                  </div>

                  <div className="p-2.5 bg-black/40 rounded-lg border border-white/5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <SonarrIcon className="w-5 h-5 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <span className="font-bold text-gray-200">Sonarr (Series)</span>
                        {sonarrLink ? (
                          <a
                            href={sonarrLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 hover:underline truncate mt-0.5 group"
                            title={`Open Sonarr at ${sonarrLink}`}
                          >
                            <span className="truncate">{sonarrLink}</span>
                            <ExternalLink className="w-3 h-3 flex-shrink-0 text-cyan-400/80 group-hover:text-cyan-300" />
                          </a>
                        ) : (
                          <p className="text-[10px] text-gray-400 truncate">Not set</p>
                        )}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold flex-shrink-0 ${
                        arrStatus?.sonarr.online
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : arrStatus?.sonarr.configured
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-white/10 text-gray-400'
                      }`}
                    >
                      {arrStatus?.sonarr.online ? 'Online' : arrStatus?.sonarr.configured ? 'Offline' : 'Not Set'}
                    </span>
                  </div>
                </div>

                {/* Indexers & Downloaders Brand Indicators (Only Render Enabled) */}
                {(() => {
                  const hasAlthub = Boolean(arrStatus?.indexers?.althub);
                  const hasNzbgeek = Boolean(arrStatus?.indexers?.nzbgeek);
                  const hasDrunkenslug = Boolean(arrStatus?.indexers?.drunkenslug);
                  const hasSabnzbd = Boolean(arrStatus?.sabnzbd?.online || arrStatus?.sabnzbd?.configured);
                  const hasAnyIndexer = hasAlthub || hasNzbgeek || hasDrunkenslug;

                  if (!hasAnyIndexer && !hasSabnzbd) return null;

                  return (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {hasAnyIndexer && <span className="text-[10px] text-gray-400 font-medium">Indexers:</span>}
                      {hasAlthub && (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-[10px] text-cyan-300 font-bold" title="AltHub Usenet Indexer (Active)">
                          <AlthubIcon className="w-3 h-3 flex-shrink-0" />
                          AltHub
                        </span>
                      )}
                      {hasNzbgeek && (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-300 font-bold" title="NZBGeek Usenet Indexer (Active)">
                          <NzbgeekIcon className="w-3 h-3 flex-shrink-0" />
                          NZBGeek
                        </span>
                      )}
                      {hasDrunkenslug && (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-lime-500/10 border border-lime-500/30 text-[10px] text-lime-300 font-bold" title="DrunkenSlug Usenet Indexer (Active)">
                          <DrunkenslugIcon className="w-3 h-3 flex-shrink-0" />
                          DrunkenSlug
                        </span>
                      )}
                      {hasSabnzbd && (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/30 text-[10px] text-yellow-300 font-bold ml-auto" title="SABnzbd Usenet Downloader">
                          <SabnzbdIcon className="w-3 h-3 flex-shrink-0" />
                          SABnzbd
                        </span>
                      )}
                    </div>
                  );
                })()}

                {/* Inline Settings Form */}
                {showArrSettings && (
                  <div className="p-3 bg-black/60 rounded-lg border border-white/10 space-y-3 text-xs mt-2">
                    <p className="text-[11px] text-gray-300">
                      Configure your Radarr and Sonarr URLs and API keys so CineStream can search indexers and push matching releases directly to your download queue.
                    </p>

                    <div className="space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-semibold text-gray-400 uppercase flex items-center gap-1.5">
                            <RadarrIcon className="w-3.5 h-3.5 shrink-0" />
                            Radarr URL
                          </label>
                          <input
                            type="text"
                            placeholder="http://192.168.1.50:7878"
                            value={arrSettingsForm.radarr_url}
                            onChange={(e) => setArrSettingsForm({ ...arrSettingsForm, radarr_url: e.target.value })}
                            className="w-full mt-1 bg-[#141414] border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-gray-400 uppercase flex items-center gap-1.5">
                            <RadarrIcon className="w-3.5 h-3.5 shrink-0" />
                            Radarr API Key
                          </label>
                          <input
                            type="password"
                            placeholder="API Key"
                            value={arrSettingsForm.radarr_api_key}
                            onChange={(e) => setArrSettingsForm({ ...arrSettingsForm, radarr_api_key: e.target.value })}
                            className="w-full mt-1 bg-[#141414] border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-semibold text-gray-400 uppercase flex items-center gap-1.5">
                            <SonarrIcon className="w-3.5 h-3.5 shrink-0" />
                            Sonarr URL
                          </label>
                          <input
                            type="text"
                            placeholder="http://192.168.1.50:8989"
                            value={arrSettingsForm.sonarr_url}
                            onChange={(e) => setArrSettingsForm({ ...arrSettingsForm, sonarr_url: e.target.value })}
                            className="w-full mt-1 bg-[#141414] border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-gray-400 uppercase flex items-center gap-1.5">
                            <SonarrIcon className="w-3.5 h-3.5 shrink-0" />
                            Sonarr API Key
                          </label>
                          <input
                            type="password"
                            placeholder="API Key"
                            value={arrSettingsForm.sonarr_api_key}
                            onChange={(e) => setArrSettingsForm({ ...arrSettingsForm, sonarr_api_key: e.target.value })}
                            className="w-full mt-1 bg-[#141414] border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                          />
                        </div>
                      </div>

                      {/* SABnzbd Usenet Downloader API Key */}
                      <div>
                        <label className="text-[10px] font-semibold text-yellow-300 uppercase flex items-center gap-1.5">
                          <SabnzbdIcon className="w-3.5 h-3.5 shrink-0" />
                          SABnzbd API Key (Usenet Downloader)
                        </label>
                        <input
                          type="password"
                          placeholder="Auto-discovered from sabnzbd.ini, or paste from SABnzbd Config -> General"
                          value={arrSettingsForm.sabnzbd_api_key || ''}
                          onChange={(e) => setArrSettingsForm({ ...arrSettingsForm, sabnzbd_api_key: e.target.value })}
                          className="w-full mt-1 bg-[#141414] border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-yellow-500 font-mono"
                        />
                        <p className="text-[10px] text-gray-400 mt-1">
                          Auto-configured into Radarr & Sonarr as the primary Usenet download client.
                        </p>
                      </div>

                      {/* Usenet Indexer API Keys */}
                      <div className="pt-2 border-t border-white/10 space-y-2">
                        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block">
                          Usenet Indexer API Keys (Auto-Synced into Sonarr & Radarr)
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div>
                            <label className="text-[10px] font-medium text-cyan-300 flex items-center gap-1">
                              <AlthubIcon className="w-3 h-3" /> AltHub API Key
                            </label>
                            <input
                              type="password"
                              placeholder="AltHub Key"
                              value={arrSettingsForm.althub_api_key || ''}
                              onChange={(e) => setArrSettingsForm({ ...arrSettingsForm, althub_api_key: e.target.value })}
                              className="w-full mt-1 bg-[#141414] border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-medium text-amber-300 flex items-center gap-1">
                              <NzbgeekIcon className="w-3 h-3" /> NZBGeek API Key
                            </label>
                            <input
                              type="password"
                              placeholder="NZBGeek Key"
                              value={arrSettingsForm.nzbgeek_api_key || ''}
                              onChange={(e) => setArrSettingsForm({ ...arrSettingsForm, nzbgeek_api_key: e.target.value })}
                              className="w-full mt-1 bg-[#141414] border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-medium text-lime-300 flex items-center gap-1">
                              <DrunkenslugIcon className="w-3 h-3" /> DrunkenSlug Key
                            </label>
                            <input
                              type="password"
                              placeholder="DrunkenSlug Key"
                              value={arrSettingsForm.drunkenslug_api_key || ''}
                              onChange={(e) => setArrSettingsForm({ ...arrSettingsForm, drunkenslug_api_key: e.target.value })}
                              className="w-full mt-1 bg-[#141414] border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      {arrSaveMessage && (
                        <span className={`text-[11px] ${arrSaveMessage.includes('saved') ? 'text-emerald-400' : 'text-red-400'}`}>
                          {arrSaveMessage}
                        </span>
                      )}
                      <div className="flex items-center gap-2 ml-auto">
                        <button
                          onClick={() => setShowArrSettings(false)}
                          className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSaveArrSettings}
                          disabled={arrSaving}
                          className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-50"
                        >
                          {arrSaving ? 'Testing...' : 'Save & Verify'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Jobs List */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider">
                  NAS Download Queue
                </h3>

                {nasJobs.length === 0 && (
                  <div className="text-center py-12 text-gray-500 text-sm">
                    No active or queued season downloads on NAS.
                  </div>
                )}

                {nasJobs.map((job) => {
                  const percent = job.file_size_bytes > 0
                    ? Math.min(100, Math.round((job.downloaded_bytes / job.file_size_bytes) * 100))
                    : 0;

                  return (
                    <div
                      key={job.id}
                      className="p-4 bg-white/5 hover:bg-white/10 rounded-xl border border-white/5 space-y-3 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="font-bold text-sm truncate">{job.title}</h4>
                          {job.episode_title && (
                            <p className="text-xs text-gray-400 truncate">
                              S{job.season} E{job.episode}: {job.episode_title}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-400">
                            <span className="bg-white/10 px-1.5 py-0.5 rounded text-white font-semibold">
                              {job.quality_badge || 'Direct Stream'}
                            </span>
                            <span>{formatGb(job.downloaded_bytes)} / {formatGb(job.file_size_bytes)}</span>
                            {job.status === 'downloading' && (
                              <span className="text-emerald-400 font-bold">{formatSpeed(job.speed_bytes_per_sec)}</span>
                            )}
                          </div>
                        </div>

                        {/* Status badge / Controls */}
                        <div className="flex items-center gap-2 flex-none">
                          {job.status === 'completed' && (
                            <>
                              <button
                                onClick={() => onPlayNasItem(job)}
                                className="p-2 bg-emerald-600/30 text-emerald-400 hover:bg-emerald-600 hover:text-white rounded-lg transition-colors"
                                title="Play from NAS"
                              >
                                <Play className="w-4 h-4 fill-current" />
                              </button>

                              <button
                                onClick={() => handleDownloadNasToDevice(job)}
                                className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors flex items-center gap-1.5"
                                title="Download file to device from NAS"
                              >
                                <Download className="w-4 h-4" />
                                <span className="text-xs font-semibold hidden sm:inline">Save</span>
                              </button>
                            </>
                          )}

                          {job.status === 'downloading' && (
                            <button
                              onClick={() => handlePauseNasJob(job.id)}
                              className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-gray-300"
                              title="Pause"
                            >
                              <Pause className="w-4 h-4" />
                            </button>
                          )}

                          {job.status === 'paused' && (
                            <button
                              onClick={() => handleResumeNasJob(job.id)}
                              className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-gray-300"
                              title="Resume"
                            >
                              <RefreshCw className="w-4 h-4" />
                            </button>
                          )}

                          <button
                            onClick={() => handleDeleteNasJob(job.id)}
                            className="p-2 bg-red-600/10 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      {job.status !== 'completed' && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] text-gray-400">
                            <span className="capitalize">{job.status}</span>
                            <span>{percent}%</span>
                          </div>
                          <div className="h-1.5 w-full bg-gray-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-red-600 transition-all duration-300"
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            /* Tab 2: On This Device (Tablet Offline) */
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider">
                Offline Files on Tablet
              </h3>

              {offlineItems.length === 0 && (
                <div className="text-center py-12 text-gray-500 text-sm">
                  No movies or episodes downloaded to this device yet. Click "Download for Trip" on any title to save for offline flights or travel.
                </div>
              )}

              {offlineItems.map((item) => {
                const percent = item.fileSizeBytes > 0
                  ? Math.min(100, Math.round((item.downloadedBytes / item.fileSizeBytes) * 100))
                  : 0;

                return (
                  <div
                    key={item.id}
                    className="p-4 bg-white/5 hover:bg-white/10 rounded-xl border border-white/5 space-y-3 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex gap-3 min-w-0">
                        {item.posterBase64 || item.posterUrl ? (
                          <img
                            src={item.posterBase64 || item.posterUrl}
                            alt={item.title}
                            className="w-12 h-16 object-cover rounded bg-[#242424] flex-none"
                          />
                        ) : (
                          <div className="w-12 h-16 bg-[#242424] rounded flex-none" />
                        )}

                        <div className="min-w-0">
                          <h4 className="font-bold text-sm truncate">{item.title}</h4>
                          {item.episodeTitle && (
                            <p className="text-xs text-gray-400 truncate">
                              S{item.season} E{item.episode}: {item.episodeTitle}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-400">
                            <span>{formatGb(item.downloadedBytes)}</span>
                            {item.status === 'downloading' && (
                              <span className="text-emerald-400 font-bold">{formatSpeed(item.speedBytesPerSec)}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Play & Delete Controls */}
                      <div className="flex items-center gap-2 flex-none">
                        {item.status === 'completed' && (
                          <button
                            onClick={() => onPlayOffline(item)}
                            className="p-2 bg-emerald-600/30 text-emerald-400 hover:bg-emerald-600 hover:text-white rounded-lg transition-colors"
                            title="Play Offline"
                          >
                            <Play className="w-4 h-4 fill-current" />
                          </button>
                        )}

                        <button
                          onClick={async () => {
                            if (confirm(`Delete offline file for "${item.title}"?`)) {
                              await offlineDownloader.removeDownload(item.id, item.localFileUri);
                              await removeOfflineItem(item.id);
                            }
                          }}
                          className="p-2 bg-red-600/10 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    {item.status !== 'completed' && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-[10px] text-gray-400">
                          <span className="capitalize">{item.status}</span>
                          <span>{percent}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-red-600 transition-all duration-300"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

