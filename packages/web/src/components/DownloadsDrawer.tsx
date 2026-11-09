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
  FileText,
  ShieldCheck,
  Server,
  Box,
  Radar,
  Settings,
} from 'lucide-react';
import { DiskSpaceInfo, NasCacheItem, OfflineMediaItem, ProviderQuota, ResolvedStream, ArrStatus } from '../types/api';
import { useOfflineStore } from '../store/useOfflineStore';
import { useProfileStore } from '../store/useProfileStore';
import { offlineDownloader } from '../bridge/offlineDownloader';

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
  });
  const [arrSaving, setArrSaving] = useState(false);
  const [arrSaveMessage, setArrSaveMessage] = useState<string | null>(null);

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
        setArrSaveMessage('Settings saved & verified!');
        setTimeout(() => {
          setArrSaveMessage(null);
          setShowArrSettings(false);
        }, 2000);
      } else {
        setArrSaveMessage('Failed to save settings.');
      }
    } catch (err: any) {
      setArrSaveMessage(`Error: ${err.message}`);
    } finally {
      setArrSaving(false);
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm select-none">
      <div className="w-full max-w-xl h-full bg-[#181818] border-l border-white/10 flex flex-col shadow-2xl text-white">
        {/* Drawer Header */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive className="w-6 h-6 text-red-600" />
            <h2 className="text-xl font-bold">Storage & Downloads</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-white/10 text-gray-400 hover:text-white">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setActiveTab('nas')}
            className={`flex-1 py-3 text-sm font-bold flex items-center justify-center gap-2 border-b-2 transition-all ${
              activeTab === 'nas'
                ? 'border-red-600 text-white bg-white/5'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <HardDrive className="w-4 h-4" />
            <span>NAS Cache ({nasJobs.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('device')}
            className={`flex-1 py-3 text-sm font-bold flex items-center justify-center gap-2 border-b-2 transition-all ${
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

              {/* Cloud Provider Quotas (TorBox, Premiumize, Easynews, RealDebrid, AllDebrid) */}
              {providerQuotas.length > 0 && (
                <div className="p-4 bg-white/5 rounded-xl border border-white/10 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-gray-300 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-cyan-400" />
                      Debrid & Usenet Provider Quotas
                    </span>
                    <span className="text-[11px] text-gray-400">Monthly / Fair-Use</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {providerQuotas.map((q) => (
                      <div
                        key={q.provider}
                        className="p-3 bg-black/40 rounded-lg border border-white/5 space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {q.provider === 'torbox' && <Box className="w-4 h-4 text-emerald-400 stroke-[2.2]" />}
                            {q.provider === 'premiumize' && <Cloud className="w-4 h-4 text-blue-400 fill-blue-400/40" />}
                            {q.provider === 'easynews' && <FileText className="w-4 h-4 text-amber-400" />}
                            {q.provider === 'realdebrid' && <ShieldCheck className="w-4 h-4 text-emerald-400" />}
                            {q.provider === 'alldebrid' && <Server className="w-4 h-4 text-orange-400" />}
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

              {/* Radarr & Sonarr Integration Status & Settings */}
              <div className="p-4 bg-white/5 rounded-xl border border-white/10 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-gray-300 flex items-center gap-1.5">
                    <Radar className="w-3.5 h-3.5 text-cyan-400" />
                    Radarr & Sonarr Indexer Search (±10% Size Match)
                  </span>
                  <button
                    onClick={() => setShowArrSettings(!showArrSettings)}
                    className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-white px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    <Settings className="w-3 h-3" />
                    <span>{showArrSettings ? 'Close' : 'Configure'}</span>
                  </button>
                </div>

                {/* Status Badges */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 bg-black/40 rounded-lg border border-white/5 flex items-center justify-between">
                    <div>
                      <span className="font-bold text-gray-200">Radarr (Movies)</span>
                      <p className="text-[10px] text-gray-400 truncate max-w-[140px]">
                        {arrStatus?.radarr.url || 'Not set'}
                      </p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
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

                  <div className="p-2.5 bg-black/40 rounded-lg border border-white/5 flex items-center justify-between">
                    <div>
                      <span className="font-bold text-gray-200">Sonarr (Series)</span>
                      <p className="text-[10px] text-gray-400 truncate max-w-[140px]">
                        {arrStatus?.sonarr.url || 'Not set'}
                      </p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
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

                {/* Inline Settings Form */}
                {showArrSettings && (
                  <div className="p-3 bg-black/60 rounded-lg border border-white/10 space-y-3 text-xs mt-2">
                    <p className="text-[11px] text-gray-300">
                      Configure your Radarr and Sonarr URLs and API keys so CineStream can search indexers and push matching releases directly to your download queue.
                    </p>

                    <div className="space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-semibold text-gray-400 uppercase">Radarr URL</label>
                          <input
                            type="text"
                            placeholder="http://192.168.1.50:7878"
                            value={arrSettingsForm.radarr_url}
                            onChange={(e) => setArrSettingsForm({ ...arrSettingsForm, radarr_url: e.target.value })}
                            className="w-full mt-1 bg-[#141414] border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-gray-400 uppercase">Radarr API Key</label>
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
                          <label className="text-[10px] font-semibold text-gray-400 uppercase">Sonarr URL</label>
                          <input
                            type="text"
                            placeholder="http://192.168.1.50:8989"
                            value={arrSettingsForm.sonarr_url}
                            onChange={(e) => setArrSettingsForm({ ...arrSettingsForm, sonarr_url: e.target.value })}
                            className="w-full mt-1 bg-[#141414] border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-gray-400 uppercase">Sonarr API Key</label>
                          <input
                            type="password"
                            placeholder="API Key"
                            value={arrSettingsForm.sonarr_api_key}
                            onChange={(e) => setArrSettingsForm({ ...arrSettingsForm, sonarr_api_key: e.target.value })}
                            className="w-full mt-1 bg-[#141414] border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                          />
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
                              {job.quality_badge || '4K'}
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

