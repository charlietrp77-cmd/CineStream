import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Play,
  Download,
  HardDrive,
  Plus,
  Check,
  Zap,
  Sparkles,
  ChevronDown,
  Layers,
  RefreshCw,
  Clock,
  CheckCheck,
  Eye,
  EyeOff,
  Magnet,
  FileDown,
} from 'lucide-react';
import { CatalogItem, ResolvedStream, TvSeasonEpisode, NasCacheItem, ArrPushResult } from '../types/api';
import { useProfileStore } from '../store/useProfileStore';
import { offlineDownloader } from '../bridge/offlineDownloader';
import { useOfflineStore } from '../store/useOfflineStore';
import { ProviderBadge, RadarrIcon, SonarrIcon } from './ProviderBadge';
import { Capacitor } from '@capacitor/core';

interface MediaDetailModalProps {
  item: CatalogItem;
  onClose: () => void;
  onPlayStream: (stream: ResolvedStream, mediaTitle: string, episodeTitle?: string) => void;
}

export const MediaDetailModal: React.FC<MediaDetailModalProps> = ({
  item,
  onClose,
  onPlayStream,
}) => {
  const { activeProfile } = useProfileStore();
  const { saveItem } = useOfflineStore();

  const [streams, setStreams] = useState<ResolvedStream[]>([]);
  const [loadingStreams, setLoadingStreams] = useState(true);

  // TV Series Season & Episode State
  const [currentImdbId, setCurrentImdbId] = useState<string>(item.imdbId);
  const [seasons, setSeasons] = useState<number[]>([1]);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [episodes, setEpisodes] = useState<TvSeasonEpisode[]>([]);
  const [selectedEpisode, setSelectedEpisode] = useState<TvSeasonEpisode | null>(null);

  // My List State
  const [isInMyList, setIsInMyList] = useState(false);

  // Provider Filter State
  const [providerFilter, setProviderFilter] = useState<string>('all');

  // NAS Cache Dropdown & State
  const [isNasMenuOpen, setIsNasMenuOpen] = useState(false);
  const [nasSuccessMessage, setNasSuccessMessage] = useState<string | null>(null);
  const [nasJobs, setNasJobs] = useState<NasCacheItem[]>([]);
  const [pushingArrStreamId, setPushingArrStreamId] = useState<string | null>(null);

  // Watch Progress State (Keyed by `${season}:${episode}`)
  const [watchedEpisodes, setWatchedEpisodes] = useState<
    Map<string, { isCompleted: boolean; positionMs: number; durationMs: number }>
  >(new Map());

  // Load streams & initial TV details
  useEffect(() => {
    setCurrentImdbId(item.imdbId);
    if (item.type === 'tv') {
      fetchSeriesInfo();
      fetchWatchProgress();
    } else {
      loadStreams(0, 0, item.imdbId);
      fetchWatchProgress();
    }
    checkMyList();
  }, [item]);

  useEffect(() => {
    if (item.type === 'tv') {
      fetchSeasonEpisodes(selectedSeason);
      fetchWatchProgress();
    }
  }, [selectedSeason, currentImdbId]);

  // Sync NAS jobs and WebSocket updates
  useEffect(() => {
    fetchNasJobs();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/downloads`;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.jobs) {
            const relevant = (data.jobs as NasCacheItem[]).filter(
              (j) => j.imdb_id === currentImdbId || j.imdb_id === item.imdbId
            );
            setNasJobs(relevant);
          }
        } catch (_) {}
      };
    } catch (_) {}

    return () => {
      if (ws) ws.close();
    };
  }, [currentImdbId, item.imdbId]);

  const fetchNasJobs = async () => {
    try {
      const res = await fetch('/api/nas/jobs');
      if (res.ok) {
        const all: NasCacheItem[] = await res.json();
        const relevant = all.filter(
          (j) => j.imdb_id === currentImdbId || j.imdb_id === item.imdbId
        );
        setNasJobs(relevant);
      }
    } catch (_) {}
  };

  const fetchWatchProgress = async () => {
    try {
      const targetImdb = currentImdbId && currentImdbId.startsWith('tt') ? currentImdbId : item.imdbId;
      const res = await fetch(`/api/progress/series/${encodeURIComponent(targetImdb)}?tmdb_id=${item.tmdbId}`, {
        headers: { 'X-Profile-Id': activeProfile?.id || '' },
      });
      if (res.ok) {
        const rows = await res.json();
        const map = new Map<string, { isCompleted: boolean; positionMs: number; durationMs: number }>();
        for (const r of rows) {
          map.set(`${r.season}:${r.episode}`, {
            isCompleted: Boolean(r.is_completed),
            positionMs: r.position_ms || 0,
            durationMs: r.duration_ms || 0,
          });
        }
        setWatchedEpisodes(map);
      }
    } catch (_) {}
  };

  const fetchSeriesInfo = async () => {
    try {
      const res = await fetch(`/api/catalog/series/${item.tmdbId}`);
      if (res.ok) {
        const data = await res.json();
        const resolvedImdb = data?.external_ids?.imdb_id;
        if (resolvedImdb && resolvedImdb.startsWith('tt')) {
          setCurrentImdbId(resolvedImdb);
        }
        const validSeasons = (data.seasons || [])
          .filter((s: any) => s.season_number > 0)
          .map((s: any) => s.season_number);
        if (validSeasons.length > 0) {
          setSeasons(validSeasons);
          if (!validSeasons.includes(selectedSeason)) {
            setSelectedSeason(validSeasons[0]);
          } else {
            fetchSeasonEpisodes(selectedSeason, resolvedImdb || currentImdbId);
          }
        }
      }
    } catch (_) {}
  };

  const fetchSeasonEpisodes = async (seasonNum: number, overrideImdbId?: string) => {
    try {
      const targetImdb = overrideImdbId || currentImdbId || item.imdbId;
      const res = await fetch(
        `/api/catalog/series/${item.tmdbId}/season/${seasonNum}?imdbId=${encodeURIComponent(targetImdb)}`
      );
      if (res.ok) {
        const data = await res.json();
        const resolvedImdb = data.imdbId && data.imdbId.startsWith('tt') ? data.imdbId : targetImdb;
        if (resolvedImdb && resolvedImdb.startsWith('tt')) {
          setCurrentImdbId(resolvedImdb);
        }
        setEpisodes(data.episodes || []);
        if (data.episodes && data.episodes.length > 0) {
          const first = data.episodes[0];
          setSelectedEpisode(first);
          loadStreams(seasonNum, first.episodeNumber, resolvedImdb);
        }
      }
    } catch (_) {}
  };

  const loadStreams = async (seasonNum: number, episodeNum: number, overrideImdbId?: string) => {
    setLoadingStreams(true);
    try {
      const targetImdb = overrideImdbId || currentImdbId || item.imdbId;
      let url = `/api/streams/${item.type}/${encodeURIComponent(targetImdb)}`;
      if (item.type === 'tv') {
        url += `?season=${seasonNum}&episode=${episodeNum}`;
      }

      const res = await fetch(url, {
        headers: { 'X-Profile-Id': activeProfile?.id || '' },
      });
      if (res.ok) {
        const data: ResolvedStream[] = await res.json();
        setStreams(data);
      }
    } catch (e) {
      console.error('Failed to load streams:', e);
    } finally {
      setLoadingStreams(false);
    }
  };

  const checkMyList = async () => {
    try {
      const res = await fetch('/api/mylist', {
        headers: { 'X-Profile-Id': activeProfile?.id || '' },
      });
      if (res.ok) {
        const list: any[] = await res.json();
        const found = list.some((l) => l.imdb_id === item.imdbId);
        setIsInMyList(found);
      }
    } catch (_) {}
  };

  const toggleMyList = async () => {
    try {
      const res = await fetch('/api/mylist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Profile-Id': activeProfile?.id || '',
        },
        body: JSON.stringify({
          imdb_id: item.imdbId,
          tmdb_id: item.tmdbId,
          media_type: item.type,
          title: item.title,
          poster_url: item.posterUrl,
          backdrop_url: item.backdropUrl,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setIsInMyList(data.inList);
        if (data.inList) {
          if (item.type === 'tv') {
            setNasSuccessMessage(`Added "${item.title}" to Watchlist & monitoring in Sonarr for all missing & new episodes!`);
          } else {
            setNasSuccessMessage(`Added "${item.title}" to Watchlist & monitoring in Radarr!`);
          }
          setTimeout(() => setNasSuccessMessage(null), 5000);
        }
      }
    } catch (_) {}
  };

  const lastWatched = useMemo(() => {
    let maxSeason = 0;
    let maxEpisode = 0;
    for (const [key, val] of watchedEpisodes.entries()) {
      if (val.isCompleted) {
        const [sStr, eStr] = key.split(':');
        const s = parseInt(sStr, 10);
        const e = parseInt(eStr, 10);
        if (s > maxSeason || (s === maxSeason && e > maxEpisode)) {
          maxSeason = s;
          maxEpisode = e;
        }
      }
    }
    return maxSeason > 0 ? { season: maxSeason, episode: maxEpisode } : null;
  }, [watchedEpisodes]);

  const isSeasonFullyWatched = useMemo(() => {
    if (episodes.length === 0) return false;
    return episodes.every((ep) => {
      const prog = watchedEpisodes.get(`${selectedSeason}:${ep.episodeNumber}`);
      return prog?.isCompleted;
    });
  }, [episodes, watchedEpisodes, selectedSeason]);

  const handleToggleEpisodeWatched = async (seasonNum: number, ep: TvSeasonEpisode) => {
    const key = `${seasonNum}:${ep.episodeNumber}`;
    const current = watchedEpisodes.get(key);
    const newCompleted = !current?.isCompleted;

    // Optimistic update
    setWatchedEpisodes((prev) => {
      const next = new Map(prev);
      next.set(key, {
        isCompleted: newCompleted,
        positionMs: newCompleted ? (current?.durationMs || 1000) : 0,
        durationMs: current?.durationMs || 1000,
      });
      return next;
    });

    try {
      const targetImdb = currentImdbId && currentImdbId.startsWith('tt') ? currentImdbId : item.imdbId;
      await fetch('/api/progress/mark-watched', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Profile-Id': activeProfile?.id || '',
        },
        body: JSON.stringify({
          imdb_id: targetImdb,
          tmdb_id: item.tmdbId,
          media_type: 'tv',
          season: seasonNum,
          episode: ep.episodeNumber,
          title: item.title,
          episode_title: ep.title,
          poster_url: item.posterUrl,
          backdrop_url: item.backdropUrl,
          is_completed: newCompleted,
        }),
      });
    } catch (_) {}
  };

  const handleMarkBatchWatched = async (
    scope: 'before_episode' | 'before_season' | 'season',
    seasonNum: number,
    episodeNum?: number,
    unmark?: boolean
  ) => {
    // Optimistic update
    setWatchedEpisodes((prev) => {
      const next = new Map(prev);
      if (scope === 'season') {
        episodes.forEach((e) => {
          next.set(`${seasonNum}:${e.episodeNumber}`, {
            isCompleted: !unmark,
            positionMs: !unmark ? 1000 : 0,
            durationMs: 1000,
          });
        });
      } else if (scope === 'before_episode' && episodeNum !== undefined) {
        episodes.forEach((e) => {
          if (e.episodeNumber <= episodeNum) {
            next.set(`${seasonNum}:${e.episodeNumber}`, {
              isCompleted: true,
              positionMs: 1000,
              durationMs: 1000,
            });
          }
        });
      }
      return next;
    });

    try {
      const targetImdb = currentImdbId && currentImdbId.startsWith('tt') ? currentImdbId : item.imdbId;
      const res = await fetch('/api/progress/mark-all-before', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Profile-Id': activeProfile?.id || '',
        },
        body: JSON.stringify({
          imdb_id: targetImdb,
          tmdb_id: item.tmdbId,
          season: seasonNum,
          episode: episodeNum,
          scope,
          unmark,
          title: item.title,
          poster_url: item.posterUrl,
          backdrop_url: item.backdropUrl,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.rows) {
          const map = new Map<string, { isCompleted: boolean; positionMs: number; durationMs: number }>();
          for (const r of data.rows) {
            map.set(`${r.season}:${r.episode}`, {
              isCompleted: Boolean(r.is_completed),
              positionMs: r.position_ms || 0,
              durationMs: r.duration_ms || 0,
            });
          }
          setWatchedEpisodes(map);
        }
        const msg =
          scope === 'before_episode'
            ? `Marked all episodes up to S${seasonNum}E${episodeNum} as watched!`
            : scope === 'before_season'
            ? `Marked all seasons prior to Season ${seasonNum} as watched!`
            : unmark
            ? `Marked Season ${seasonNum} as unwatched.`
            : `Marked Season ${seasonNum} as watched!`;
        setNasSuccessMessage(msg);
        setTimeout(() => setNasSuccessMessage(null), 4000);
      }
    } catch (_) {}
  };

  const handleNasCache = async (
    scope: 'movie' | 'episode' | 'remaining_season' | 'season' | 'all_seasons' | 'remaining_after_watched',
    overrideSeason?: number,
    overrideEpisode?: number
  ) => {
    setIsNasMenuOpen(false);
    const targetImdb = currentImdbId && currentImdbId.startsWith('tt') ? currentImdbId : item.imdbId;
    const seasonNumber = overrideSeason !== undefined ? overrideSeason : selectedSeason;
    const episodeNumber = overrideEpisode !== undefined ? overrideEpisode : selectedEpisode?.episodeNumber || 1;

    // Optimistic UI updates
    if (scope === 'episode') {
      setNasJobs((prev) => [
        ...prev.filter((j) => !(j.season === seasonNumber && j.episode === episodeNumber)),
        {
          id: `${targetImdb}:${seasonNumber}:${episodeNumber}`,
          imdb_id: targetImdb,
          tmdb_id: item.tmdbId,
          media_type: item.type,
          title: item.title,
          episode_title: selectedEpisode?.title || null,
          season: seasonNumber,
          episode: episodeNumber,
          poster_url: item.posterUrl,
          backdrop_url: item.backdropUrl,
          source_url: '',
          source_headers_json: '{}',
          binge_group: null,
          quality_badge: null,
          file_path: '',
          file_size_bytes: 0,
          downloaded_bytes: 0,
          speed_bytes_per_sec: 0,
          status: 'queued',
          error_message: null,
          requested_by_profile_id: activeProfile?.id || null,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ]);
    } else if (scope === 'movie') {
      setNasJobs((prev) => [
        ...prev.filter((j) => j.imdb_id !== targetImdb),
        {
          id: `${targetImdb}:0:0`,
          imdb_id: targetImdb,
          tmdb_id: item.tmdbId,
          media_type: 'movie',
          title: item.title,
          episode_title: null,
          season: 0,
          episode: 0,
          poster_url: item.posterUrl,
          backdrop_url: item.backdropUrl,
          source_url: '',
          source_headers_json: '{}',
          binge_group: null,
          quality_badge: null,
          file_path: '',
          file_size_bytes: 0,
          downloaded_bytes: 0,
          speed_bytes_per_sec: 0,
          status: 'queued',
          error_message: null,
          requested_by_profile_id: activeProfile?.id || null,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ]);
    } else if (scope === 'season' || scope === 'remaining_season') {
      const epsToQueue = episodes.filter((ep) => scope !== 'remaining_season' || ep.episodeNumber >= episodeNumber);
      const newJobs: NasCacheItem[] = epsToQueue.map((ep) => ({
        id: `${targetImdb}:${seasonNumber}:${ep.episodeNumber}`,
        imdb_id: targetImdb,
        tmdb_id: item.tmdbId,
        media_type: 'tv',
        title: item.title,
        episode_title: ep.title,
        season: seasonNumber,
        episode: ep.episodeNumber,
        poster_url: item.posterUrl,
        backdrop_url: item.backdropUrl,
        source_url: '',
        source_headers_json: '{}',
        binge_group: null,
        quality_badge: null,
        file_path: '',
        file_size_bytes: 0,
        downloaded_bytes: 0,
        speed_bytes_per_sec: 0,
        status: 'queued',
        error_message: null,
        requested_by_profile_id: activeProfile?.id || null,
        created_at: Date.now(),
        updated_at: Date.now(),
      }));
      setNasJobs((prev) => [
        ...prev.filter((j) => j.season !== seasonNumber || !epsToQueue.some((e) => e.episodeNumber === j.episode)),
        ...newJobs,
      ]);
    } else if (scope === 'remaining_after_watched') {
      const startSeason = lastWatched ? lastWatched.season : 1;
      const startEp = lastWatched ? lastWatched.episode : 0;
      const epsToQueue = episodes.filter(
        (ep) => selectedSeason > startSeason || (selectedSeason === startSeason && ep.episodeNumber > startEp)
      );
      const newJobs: NasCacheItem[] = epsToQueue.map((ep) => ({
        id: `${targetImdb}:${selectedSeason}:${ep.episodeNumber}`,
        imdb_id: targetImdb,
        tmdb_id: item.tmdbId,
        media_type: 'tv',
        title: item.title,
        episode_title: ep.title,
        season: selectedSeason,
        episode: ep.episodeNumber,
        poster_url: item.posterUrl,
        backdrop_url: item.backdropUrl,
        source_url: '',
        source_headers_json: '{}',
        binge_group: null,
        quality_badge: null,
        file_path: '',
        file_size_bytes: 0,
        downloaded_bytes: 0,
        speed_bytes_per_sec: 0,
        status: 'queued',
        error_message: null,
        requested_by_profile_id: activeProfile?.id || null,
        created_at: Date.now(),
        updated_at: Date.now(),
      }));
      setNasJobs((prev) => [
        ...prev.filter((j) => j.season !== selectedSeason || !epsToQueue.some((e) => e.episodeNumber === j.episode)),
        ...newJobs,
      ]);
    }

    try {
      const res = await fetch('/api/nas/cache', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Profile-Id': activeProfile?.id || '',
        },
        body: JSON.stringify({
          imdbId: targetImdb,
          tmdbId: item.tmdbId,
          mediaType: item.type,
          scope,
          seasonNumber,
          episodeNumber,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const label =
          scope === 'episode'
            ? `Episode S${seasonNumber}E${episodeNumber}`
            : scope === 'season'
            ? `Season ${seasonNumber} (${data.queuedCount || 'all'} episodes)`
            : scope === 'all_seasons'
            ? 'All Seasons'
            : scope === 'remaining_after_watched'
            ? lastWatched
              ? `Remaining Episodes after S${lastWatched.season}E${lastWatched.episode} (${data.queuedCount || 'all'})`
              : `All Remaining Episodes (${data.queuedCount || 'all'})`
            : `${data.queuedCount} item(s)`;
        setNasSuccessMessage(`Queued ${label} for NAS caching!`);
        setTimeout(() => setNasSuccessMessage(null), 4000);
        fetchNasJobs();
      }
    } catch (e) {
      console.error('Failed to queue NAS caching:', e);
    }
  };

  const getNasJob = (seasonNum: number, episodeNum: number) => {
    return nasJobs.find((j) => j.season === seasonNum && j.episode === episodeNum);
  };

  const movieNasJob = item.type === 'movie' ? (nasJobs.find((j) => j.media_type === 'movie') || getNasJob(0, 0)) : null;
  const currentEpNum = selectedEpisode?.episodeNumber || 1;
  const currentEpNasJob = item.type === 'tv' ? getNasJob(selectedSeason, currentEpNum) : null;

  const seasonJobs = nasJobs.filter((j) => j.season === selectedSeason);
  const seasonCompletedCount = seasonJobs.filter((j) => j.status === 'completed').length;
  const seasonDownloadingCount = seasonJobs.filter((j) => j.status === 'downloading').length;
  const seasonQueuedCount = seasonJobs.filter((j) => j.status === 'queued').length;
  const isEntireSeasonCached = episodes.length > 0 && seasonCompletedCount >= episodes.length;
  const isSeasonCaching = seasonDownloadingCount > 0 || seasonQueuedCount > 0;

  const anyCompleted = nasJobs.some((j) => j.status === 'completed') || item.isNasCached;
  const anyDownloading = nasJobs.some((j) => j.status === 'downloading');
  const anyQueued = nasJobs.some((j) => j.status === 'queued');

  const activeDownloadingJob = nasJobs.find((j) => j.status === 'downloading');
  const activePercent = activeDownloadingJob && activeDownloadingJob.file_size_bytes > 0
    ? Math.min(100, Math.round((activeDownloadingJob.downloaded_bytes / activeDownloadingJob.file_size_bytes) * 100))
    : 0;

  const handleDeviceDownload = async () => {
    if (streams.length === 0) return;
    const targetStream = bestStream || streams[0];
    if (!targetStream) return;

    const targetImdb = currentImdbId && currentImdbId.startsWith('tt') ? currentImdbId : item.imdbId;
    const season = item.type === 'tv' ? selectedSeason : 0;
    const episode = item.type === 'tv' ? selectedEpisode?.episodeNumber || 1 : 0;
    const downloadId = `${targetImdb}_${season}_${episode}_${targetStream.id}`;
    const streamUrl = targetStream.rawUrl || targetStream.url;

    // Trigger browser file download on desktop
    const pad = (n: number) => n.toString().padStart(2, '0');
    const epSuffix = item.type === 'tv' ? ` - S${pad(season)}E${pad(episode)}` : '';
    const qualSuffix = ` [${targetStream.badges.resolution}${targetStream.badges.sizeText ? ` - ${targetStream.badges.sizeText}` : ''}]`;
    const link = document.createElement('a');
    link.href = streamUrl.includes('/api/nas/stream') ? `${streamUrl}?download=1` : streamUrl;
    link.download = `${item.title}${epSuffix}${qualSuffix}.mkv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    const downloadedItem = await offlineDownloader.startDownload({
      downloadId,
      imdbId: targetImdb,
      tmdbId: item.tmdbId,
      mediaType: item.type,
      season,
      episode,
      title: item.title,
      episodeTitle: selectedEpisode?.title,
      posterUrl: item.posterUrl || undefined,
      backdropUrl: item.backdropUrl || undefined,
      streamUrl,
      headers: targetStream.headers,
    });

    await saveItem(downloadedItem);
    const sizeMsg = targetStream.badges.sizeText ? ` (${targetStream.badges.sizeText})` : '';
    setNasSuccessMessage(
      targetStream.badges.isNasCached
        ? `Started direct download from NAS to this device${sizeMsg}!`
        : `Started downloading ${targetStream.badges.resolution}${sizeMsg} (${targetStream.badges.source}) to this device!`
    );
    setTimeout(() => setNasSuccessMessage(null), 4000);
  };

  const handleDownloadStream = async (stream: ResolvedStream) => {
    const targetImdb = currentImdbId && currentImdbId.startsWith('tt') ? currentImdbId : item.imdbId;
    const season = item.type === 'tv' ? selectedSeason : 0;
    const episode = item.type === 'tv' ? selectedEpisode?.episodeNumber || 1 : 0;
    const downloadId = `${targetImdb}_${season}_${episode}_${stream.id}`;
    const streamUrl = stream.rawUrl || stream.url;

    const pad = (n: number) => n.toString().padStart(2, '0');
    const epSuffix = item.type === 'tv' ? ` - S${pad(season)}E${pad(episode)}` : '';
    const qualSuffix = ` [${stream.badges.resolution}${stream.badges.sizeText ? ` - ${stream.badges.sizeText}` : ''}]`;
    const filename = `${item.title}${epSuffix}${qualSuffix}.mkv`;

    // Trigger direct browser file download on desktop
    const downloadLink = streamUrl.includes('/api/nas/stream') ? `${streamUrl}?download=1` : streamUrl;
    const link = document.createElement('a');
    link.href = downloadLink;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Register with offline store / native bridge
    try {
      const downloadedItem = await offlineDownloader.startDownload({
        downloadId,
        imdbId: targetImdb,
        tmdbId: item.tmdbId,
        mediaType: item.type,
        season,
        episode,
        title: item.title,
        episodeTitle: selectedEpisode?.title,
        posterUrl: item.posterUrl || undefined,
        backdropUrl: item.backdropUrl || undefined,
        streamUrl,
        headers: stream.headers,
      });
      await saveItem(downloadedItem);
    } catch (_) {}

    const sizeMsg = stream.badges.sizeText ? ` (${stream.badges.sizeText})` : '';
    setNasSuccessMessage(`Started downloading ${stream.badges.resolution}${sizeMsg} (${stream.badges.source}) to device!`);
    setTimeout(() => setNasSuccessMessage(null), 4000);
  };

  const handleNasCacheSpecificStream = async (stream: ResolvedStream) => {
    const targetImdb = currentImdbId && currentImdbId.startsWith('tt') ? currentImdbId : item.imdbId;
    const seasonNumber = item.type === 'tv' ? selectedSeason : 0;
    const episodeNumber = item.type === 'tv' ? (selectedEpisode?.episodeNumber || 1) : 0;
    const scope = item.type === 'movie' ? 'movie' : 'episode';

    let qualityBadge = `${stream.badges.resolution}`;
    if (stream.badges.dolbyVision) qualityBadge += ' DV';
    else if (stream.badges.hdr) qualityBadge += ' HDR';
    if (stream.badges.atmos) qualityBadge += ' Atmos';
    if (stream.badges.remux) qualityBadge += ' Remux';

    // Optimistic UI updates
    if (scope === 'episode') {
      setNasJobs((prev) => [
        ...prev.filter((j) => !(j.season === seasonNumber && j.episode === episodeNumber)),
        {
          id: `${targetImdb}:${seasonNumber}:${episodeNumber}`,
          imdb_id: targetImdb,
          tmdb_id: item.tmdbId,
          media_type: 'tv',
          title: item.title,
          episode_title: selectedEpisode?.title || null,
          season: seasonNumber,
          episode: episodeNumber,
          poster_url: item.posterUrl,
          backdrop_url: item.backdropUrl,
          source_url: stream.url,
          source_headers_json: JSON.stringify(stream.headers || {}),
          binge_group: stream.bingeGroup || null,
          quality_badge: qualityBadge,
          file_path: '',
          file_size_bytes: 0,
          downloaded_bytes: 0,
          speed_bytes_per_sec: 0,
          status: 'queued',
          error_message: null,
          requested_by_profile_id: activeProfile?.id || null,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ]);
    } else {
      setNasJobs((prev) => [
        ...prev.filter((j) => j.imdb_id !== targetImdb),
        {
          id: `${targetImdb}:0:0`,
          imdb_id: targetImdb,
          tmdb_id: item.tmdbId,
          media_type: 'movie',
          title: item.title,
          episode_title: null,
          season: 0,
          episode: 0,
          poster_url: item.posterUrl,
          backdrop_url: item.backdropUrl,
          source_url: stream.url,
          source_headers_json: JSON.stringify(stream.headers || {}),
          binge_group: stream.bingeGroup || null,
          quality_badge: qualityBadge,
          file_path: '',
          file_size_bytes: 0,
          downloaded_bytes: 0,
          speed_bytes_per_sec: 0,
          status: 'queued',
          error_message: null,
          requested_by_profile_id: activeProfile?.id || null,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ]);
    }

    setNasSuccessMessage(`Queuing ${stream.badges.resolution} (${stream.badges.source}) to NAS...`);

    try {
      const res = await fetch('/api/nas/cache', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Profile-Id': activeProfile?.id || '',
        },
        body: JSON.stringify({
          imdbId: targetImdb,
          tmdbId: item.tmdbId,
          mediaType: item.type,
          scope,
          seasonNumber,
          episodeNumber,
          streamUrl: stream.url,
          streamHeaders: stream.headers,
          streamName: stream.name,
          streamSource: stream.badges.source,
          qualityBadge,
          preferredBingeGroup: stream.bingeGroup,
        }),
      });

      if (res.ok) {
        setNasSuccessMessage(`Queued ${stream.name} (${stream.badges.resolution}) for NAS caching!`);
        setTimeout(() => setNasSuccessMessage(null), 4000);
        fetchNasJobs();
      }
    } catch (e) {
      console.error('Failed to queue stream to NAS:', e);
    }
  };

  const handleDeviceDownloadEpisode = async (seasonNum: number, ep: TvSeasonEpisode) => {
    const targetImdb = currentImdbId && currentImdbId.startsWith('tt') ? currentImdbId : item.imdbId;
    const downloadId = `${targetImdb}_${seasonNum}_${ep.episodeNumber}`;
    const pad = (n: number) => n.toString().padStart(2, '0');

    let streamUrl = '';
    let isFromNas = false;

    if (ep.isNasCached) {
      const nasId = `${targetImdb}:${seasonNum}:${ep.episodeNumber}`;
      streamUrl = `/api/nas/stream/${encodeURIComponent(nasId)}?download=1`;
      isFromNas = true;
    } else {
      const best = streams[0];
      if (best) {
        streamUrl = best.rawUrl || best.url;
      } else {
        setNasSuccessMessage(`Selected S${seasonNum}E${ep.episodeNumber} - click again to download once streams finish loading`);
        setTimeout(() => setNasSuccessMessage(null), 4000);
        return;
      }
    }

    // Trigger direct browser download
    const link = document.createElement('a');
    link.href = streamUrl;
    link.download = `${item.title} - S${pad(seasonNum)}E${pad(ep.episodeNumber)} - ${ep.title}.mkv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Register with offline store
    try {
      const downloadedItem = await offlineDownloader.startDownload({
        downloadId,
        imdbId: targetImdb,
        tmdbId: item.tmdbId,
        mediaType: item.type,
        season: seasonNum,
        episode: ep.episodeNumber,
        title: item.title,
        episodeTitle: ep.title,
        posterUrl: item.posterUrl || undefined,
        backdropUrl: item.backdropUrl || undefined,
        streamUrl,
      });
      await saveItem(downloadedItem);
    } catch (_) {}

    setNasSuccessMessage(isFromNas ? `Downloading S${seasonNum}E${ep.episodeNumber} directly from NAS!` : `Downloading S${seasonNum}E${ep.episodeNumber} to this device!`);
    setTimeout(() => setNasSuccessMessage(null), 4000);
  };

  const cleanStreamDetails = (stream: ResolvedStream) => {
    const parts: string[] = [];
    if (stream.badges.resolution) parts.push(stream.badges.resolution);
    if (stream.badges.remux) parts.push('REMUX');
    if (stream.badges.dolbyVision) parts.push('Dolby Vision');
    if (stream.badges.hdr10Plus) parts.push('HDR10+');
    else if (stream.badges.hdr) parts.push('HDR');
    if (stream.badges.atmos) parts.push('Atmos');
    if (stream.badges.trueHd) parts.push('TrueHD');
    if (stream.badges.dtsHd) parts.push('DTS-HD');
    if (stream.badges.sizeText) parts.push(stream.badges.sizeText);

    // Release group from title or bingeGroup
    const groupMatch = /🏷️\s*([^\n\r]+)/.exec(stream.title);
    if (groupMatch) {
      parts.push(groupMatch[1].trim());
    } else if (stream.bingeGroup) {
      const bgParts = stream.bingeGroup.split('|');
      if (bgParts.length > 2) {
        const last = bgParts[bgParts.length - 1];
        if (last && !last.includes('.')) parts.push(last);
      }
    }

    return parts.join(' • ') || stream.title.replace(/\n/g, ' ');
  };

  const handleArrPush = async (targetStream: ResolvedStream) => {
    setPushingArrStreamId(targetStream.id);
    const serviceName = item.type === 'tv' ? 'Sonarr' : 'Radarr';
    const targetImdb = currentImdbId && currentImdbId.startsWith('tt') ? currentImdbId : item.imdbId;

    setNasSuccessMessage(`Searching ${serviceName} indexers for release within ±10% size (${targetStream.badges.sizeText || 'target'})...`);

    try {
      const res = await fetch('/api/arr/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Profile-Id': activeProfile?.id || '',
        },
        body: JSON.stringify({
          mediaType: item.type,
          tmdbId: item.tmdbId,
          imdbId: targetImdb,
          title: item.title,
          releaseTitle: targetStream.rawReleaseTitle || targetStream.title.split('\n')[0].trim(),
          year: item.releaseDate ? item.releaseDate.split('-')[0] : undefined,
          seasonNumber: item.type === 'tv' ? selectedSeason : undefined,
          episodeNumber: item.type === 'tv' ? (selectedEpisode?.episodeNumber || 1) : undefined,
          targetSizeBytes: targetStream.badges.sizeBytes || 0,
          targetBadges: targetStream.badges,
          targetMagnetUrl: targetStream.magnetUrl,
          targetNzbUrl: targetStream.nzbUrl,
        }),
      });

      const data: ArrPushResult = await res.json();
      if (data.success) {
        setNasSuccessMessage(`🎯 ${data.message}`);
        setTimeout(() => setNasSuccessMessage(null), 8000);
      } else {
        setNasSuccessMessage(`⚠️ ${data.message || data.error}`);
        setTimeout(() => setNasSuccessMessage(null), 8000);
      }
    } catch (err: any) {
      setNasSuccessMessage(`⚠️ Failed to push to ${serviceName}: ${err.message}`);
      setTimeout(() => setNasSuccessMessage(null), 8000);
    } finally {
      setPushingArrStreamId(null);
    }
  };

  const availableProviders = Array.from(new Set(streams.map((s) => s.badges.source || 'Debrid')));
  const filteredStreams = providerFilter === 'all'
    ? streams
    : streams.filter((s) => (s.badges.source || 'Debrid') === providerFilter);

  const isDirectPlayable = (s: ResolvedStream) => {
    if (s.badges.isNasCached) return true;
    if (s.isDirectStream === false) return false;
    if (s.nzbUrl && (s.badges.source === 'AltHub' || s.badges.source === 'NZBGeek' || s.badges.source === 'DrunkenSlug')) return false;
    return true;
  };

  const isBrowserLosslessAudio = (s: ResolvedStream) => Boolean(s.badges.trueHd || s.badges.dtsHd);
  const isNativeApp = Capacitor.isNativePlatform();

  const playableStreams = filteredStreams.filter(isDirectPlayable);
  const allPlayableStreams = streams.filter(isDirectPlayable);

  const bestStream = !isNativeApp
    ? (playableStreams.find((s) => !isBrowserLosslessAudio(s)) || playableStreams[0] || allPlayableStreams[0] || filteredStreams[0] || streams[0])
    : (playableStreams[0] || allPlayableStreams[0] || filteredStreams[0] || streams[0]);

  // Dynamically compute the best available quality string across resolved streams
  const dynamicQualityBadge = (() => {
    if (loadingStreams) return null;
    if (bestStream) {
      const parts: string[] = [];
      const res = bestStream.badges.resolution || 'HD';
      parts.push(res);
      if (bestStream.badges.dolbyVision) parts.push('DV');
      else if (bestStream.badges.hdr10Plus) parts.push('HDR10+');
      else if (bestStream.badges.hdr) parts.push('HDR');
      if (bestStream.badges.atmos) parts.push('Atmos');
      return parts.join(' • ');
    }
    if (item.qualityBadge) {
      return item.qualityBadge;
    }
    return null;
  })();

  const handlePlayBest = () => {
    if (bestStream) {
      if (!isDirectPlayable(bestStream)) {
        setNasSuccessMessage('⚠️ No direct streams found. Push an NZB release to download to NAS first.');
        setTimeout(() => setNasSuccessMessage(null), 6000);
        return;
      }
      onPlayStream(bestStream, item.title, selectedEpisode?.title);
    }
  };

  return (
    <div
      data-focus-scope="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-2 sm:p-6 overflow-y-auto"
    >
      <div className="relative w-full max-w-4xl bg-[#181818] rounded-xl overflow-hidden shadow-2xl border border-white/10 my-auto text-white">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-30 bg-black/70 hover:bg-black p-2 rounded-full text-white/80 hover:text-white transition-all shadow-lg focus:outline-none focus:ring-2 focus:ring-white"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Hero Banner inside Modal */}
        <div className="relative h-64 sm:h-96 w-full overflow-hidden">
          {item.backdropUrl && (
            <img
              src={item.backdropUrl}
              alt={item.title}
              className="w-full h-full object-cover object-top"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#181818] via-transparent to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#181818] via-[#181818]/40 to-transparent w-2/3" />

          {/* Banner Details */}
          <div className="absolute bottom-6 left-6 right-6 space-y-3 z-10">
            {item.clearLogoUrl ? (
              <img
                src={item.clearLogoUrl}
                alt={item.title}
                className="max-h-16 sm:max-h-24 max-w-xs object-contain drop-shadow-lg"
              />
            ) : (
              <h2 className="text-2xl sm:text-4xl font-black drop-shadow-md">{item.title}</h2>
            )}

            {/* Badges */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {anyCompleted ? (
                <span className="flex items-center gap-1 bg-amber-500/30 text-amber-300 border border-amber-500/50 px-2 py-0.5 rounded font-bold">
                  <Zap className="w-3.5 h-3.5 fill-amber-300" />
                  ⚡ Cached on NAS
                </span>
              ) : anyDownloading ? (
                <span className="flex items-center gap-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded font-bold animate-pulse">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                  ⏳ Caching to NAS ({activePercent}%)
                </span>
              ) : anyQueued ? (
                <span className="flex items-center gap-1.5 bg-blue-500/20 text-blue-300 border border-blue-500/40 px-2 py-0.5 rounded font-bold">
                  <Clock className="w-3.5 h-3.5 text-blue-400" />
                  ⏳ Queued for NAS Caching
                </span>
              ) : loadingStreams ? (
                <span className="flex items-center gap-1.5 bg-white/10 text-gray-300 border border-white/10 px-2 py-0.5 rounded font-medium">
                  <RefreshCw className="w-3 h-3 animate-spin text-gray-400" />
                  Checking qualities...
                </span>
              ) : dynamicQualityBadge ? (
                <span className="flex items-center gap-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded font-semibold">
                  <Sparkles className="w-3.5 h-3.5" />
                  Available in {dynamicQualityBadge}
                </span>
              ) : (
                <span className="flex items-center gap-1 bg-white/10 text-gray-400 border border-white/10 px-2 py-0.5 rounded font-medium">
                  No streams found
                </span>
              )}

              {item.releaseDate && (
                <span className="text-gray-300">{item.releaseDate.split('-')[0]}</span>
              )}

              {item.genres?.slice(0, 3).map((g) => (
                <span key={g} className="bg-white/10 px-2 py-0.5 rounded text-gray-300">
                  {g}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Success Alert Banner */}
        {nasSuccessMessage && (
          <div className="bg-emerald-600/90 text-white text-xs sm:text-sm font-bold px-6 py-2.5 flex items-center justify-between">
            <span>{nasSuccessMessage}</span>
            <Check className="w-4 h-4" />
          </div>
        )}

        {/* Content Body */}
        <div className="p-6 space-y-6">
          {/* Action Buttons Bar */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              data-autofocus="true"
              data-priority="high"
              onClick={handlePlayBest}
              disabled={loadingStreams || streams.length === 0}
              className="flex items-center gap-2 bg-white text-black hover:bg-white/90 disabled:opacity-50 px-6 py-2.5 rounded font-bold text-sm shadow transition-all focus:outline-none focus:ring-4 focus:ring-red-600 focus:scale-105"
            >
              <Play className="w-4 h-4 fill-black" />
              <span>
                {bestStream
                  ? `Play Best (${bestStream.badges.source || 'Stream'} • ${bestStream.badges.resolution})`
                  : 'Play Best Stream'}
              </span>
            </button>

            {/* Cache to NAS Button & Dropdown */}
            {item.type === 'movie' ? (
              movieNasJob?.status === 'completed' || item.isNasCached ? (
                <button
                  disabled
                  className="flex items-center gap-2 bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 px-5 py-2.5 rounded font-semibold text-sm cursor-default shadow"
                >
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>⚡ Cached on NAS</span>
                </button>
              ) : movieNasJob?.status === 'downloading' ? (
                <button
                  disabled
                  className="flex items-center gap-2 bg-amber-600/30 text-amber-300 border border-amber-500/40 px-5 py-2.5 rounded font-semibold text-sm animate-pulse cursor-default shadow"
                >
                  <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                  <span>Caching to NAS ({activePercent}%)</span>
                </button>
              ) : movieNasJob?.status === 'queued' ? (
                <button
                  disabled
                  className="flex items-center gap-2 bg-blue-600/30 text-blue-300 border border-blue-500/40 px-5 py-2.5 rounded font-semibold text-sm cursor-default shadow"
                >
                  <Clock className="w-4 h-4 text-blue-400" />
                  <span>Queued for Caching</span>
                </button>
              ) : (
                <button
                  onClick={() => handleNasCache('movie')}
                  className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white px-5 py-2.5 rounded font-semibold text-sm transition-all shadow"
                >
                  <Zap className="w-4 h-4 fill-white" />
                  <span>Cache to NAS</span>
                </button>
              )
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {/* Episode Button */}
                {currentEpNasJob?.status === 'completed' || selectedEpisode?.isNasCached ? (
                  <button
                    disabled
                    className="flex items-center gap-1.5 bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 px-3.5 py-2.5 rounded font-semibold text-sm cursor-default shadow"
                  >
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>Ep {currentEpNum} Cached</span>
                  </button>
                ) : currentEpNasJob?.status === 'downloading' ? (
                  <button
                    disabled
                    className="flex items-center gap-1.5 bg-amber-600/30 text-amber-300 border border-amber-500/40 px-3.5 py-2.5 rounded font-semibold text-sm animate-pulse cursor-default shadow"
                  >
                    <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                    <span>Caching Ep {currentEpNum} ({activePercent}%)</span>
                  </button>
                ) : currentEpNasJob?.status === 'queued' ? (
                  <button
                    disabled
                    className="flex items-center gap-1.5 bg-blue-600/30 text-blue-300 border border-blue-500/40 px-3.5 py-2.5 rounded font-semibold text-sm cursor-default shadow"
                  >
                    <Clock className="w-4 h-4 text-blue-400" />
                    <span>Ep {currentEpNum} Queued</span>
                  </button>
                ) : (
                  <button
                    onClick={() => handleNasCache('episode')}
                    className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white px-3.5 py-2.5 rounded font-semibold text-sm transition-all shadow"
                    title="Cache currently selected episode to NAS"
                  >
                    <Zap className="w-4 h-4 fill-white" />
                    <span>Cache Ep {currentEpNum}</span>
                  </button>
                )}

                {/* Season Button */}
                {isEntireSeasonCached ? (
                  <button
                    disabled
                    className="flex items-center gap-1.5 bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 px-3.5 py-2.5 rounded font-semibold text-sm cursor-default shadow"
                  >
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>Season {selectedSeason} Cached</span>
                  </button>
                ) : isSeasonCaching ? (
                  <button
                    disabled
                    className="flex items-center gap-1.5 bg-amber-600/30 text-amber-300 border border-amber-500/40 px-3.5 py-2.5 rounded font-semibold text-sm animate-pulse cursor-default shadow"
                  >
                    <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                    <span>Caching S{selectedSeason} ({seasonCompletedCount}/{episodes.length || seasonJobs.length})</span>
                  </button>
                ) : (
                  <button
                    onClick={() => handleNasCache('season')}
                    className="flex items-center gap-1.5 bg-amber-700 hover:bg-amber-600 text-white px-3.5 py-2.5 rounded font-semibold text-sm transition-all shadow"
                    title={`Cache all episodes of Season ${selectedSeason} to NAS`}
                  >
                    <Zap className="w-4 h-4 fill-white" />
                    <span>Cache Season {selectedSeason}</span>
                  </button>
                )}

                <div className="relative">
                  <button
                    onClick={() => setIsNasMenuOpen(!isNasMenuOpen)}
                    className="p-2.5 bg-white/10 hover:bg-white/20 text-white rounded font-semibold text-sm transition-all"
                    title="More caching options"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>

                  {isNasMenuOpen && (
                    <div className="absolute left-0 sm:right-0 sm:left-auto mt-2 w-64 bg-[#202020] border border-white/10 rounded-lg shadow-2xl py-1 z-30 text-xs">
                      {/* Smart Cache Remaining based on Watched */}
                      <button
                        onClick={() => handleNasCache('remaining_after_watched')}
                        className="w-full text-left px-4 py-2.5 hover:bg-white/10 font-bold text-amber-300 flex items-center justify-between border-b border-white/5"
                        title="Cache all unwatched aired episodes from after the last watched episode onwards"
                      >
                        <div className="flex flex-col">
                          <span>
                            {lastWatched
                              ? `Cache Remaining (after S${lastWatched.season}E${lastWatched.episode})`
                              : 'Cache Remaining (All Unwatched)'}
                          </span>
                          <span className="text-[10px] text-gray-400 font-normal">
                            Based on your watch history
                          </span>
                        </div>
                        <Zap className="w-3.5 h-3.5 fill-amber-300 flex-none" />
                      </button>

                      <button
                        onClick={() => handleNasCache('episode')}
                        className="w-full text-left px-4 py-2 hover:bg-white/10 text-gray-200"
                      >
                        Cache Ep {currentEpNum}
                      </button>
                      <button
                        onClick={() => handleNasCache('remaining_season')}
                        className="w-full text-left px-4 py-2 hover:bg-white/10 text-gray-200"
                      >
                        Cache Remaining in Season {selectedSeason}
                      </button>
                      <button
                        onClick={() => handleNasCache('season')}
                        className="w-full text-left px-4 py-2 hover:bg-white/10 text-gray-200"
                      >
                        Cache Entire Season {selectedSeason}
                      </button>
                      <button
                        onClick={() => handleNasCache('all_seasons')}
                        className="w-full text-left px-4 py-2 hover:bg-white/10 font-bold text-amber-400 border-t border-white/5"
                      >
                        Cache All Seasons (Full Series)
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Download to Device */}
            <button
              onClick={handleDeviceDownload}
              disabled={loadingStreams || streams.length === 0}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white px-4 py-2.5 rounded font-medium text-sm transition-all"
              title={
                bestStream
                  ? `Download ${bestStream.badges.source} ${bestStream.badges.resolution}${bestStream.badges.sizeText ? ` (${bestStream.badges.sizeText})` : ''} to this device`
                  : 'Download for trip'
              }
            >
              <Download className="w-4 h-4 flex-none" />
              <div className="flex flex-wrap items-baseline gap-1.5">
                <span>
                  {bestStream?.badges.isNasCached ? 'Download from NAS' : 'Download for Trip'}
                </span>
                {bestStream && (
                  <span className="text-xs text-gray-300 font-normal">
                    ({bestStream.badges.resolution}
                    {bestStream.badges.sizeText ? ` • ${bestStream.badges.sizeText}` : ''}
                    {bestStream.badges.source ? ` • ${bestStream.badges.source}` : ''})
                  </span>
                )}
              </div>
            </button>

            {/* Push Best Stream to Radarr / Sonarr */}
            {bestStream && (
              <button
                onClick={() => handleArrPush(bestStream)}
                disabled={pushingArrStreamId === bestStream.id}
                className="flex items-center gap-2 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 px-3.5 py-2.5 rounded font-medium text-sm transition-all disabled:opacity-50"
                title={`Search ${item.type === 'tv' ? 'Sonarr' : 'Radarr'} indexers for equivalent release (±10% of ${bestStream.badges.sizeText || 'target'})`}
              >
                {pushingArrStreamId === bestStream.id ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
                ) : item.type === 'tv' ? (
                  <SonarrIcon className="w-4 h-4 flex-shrink-0" />
                ) : (
                  <RadarrIcon className="w-4 h-4 flex-shrink-0" />
                )}
                <span>Push to {item.type === 'tv' ? 'Sonarr' : 'Radarr'} (±10% Size)</span>
              </button>
            )}

            {/* My List */}
            <button
              onClick={toggleMyList}
              className={`flex items-center gap-2 px-4 py-2.5 rounded font-medium text-sm border transition-all ${
                isInMyList
                  ? 'bg-red-600/20 text-red-400 border-red-600/40'
                  : 'bg-white/5 text-gray-300 border-white/10 hover:border-white'
              }`}
            >
              {isInMyList ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              <span>{isInMyList ? 'In My List' : 'Add to List'}</span>
            </button>
          </div>

          {/* Synopsis */}
          <p className="text-sm text-gray-300 leading-relaxed">{item.overview}</p>

          {/* TV Series Episode Picker */}
          {item.type === 'tv' && (
            <div className="space-y-4 pt-4 border-t border-white/10">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-bold text-lg">Episodes</h3>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Mark Season Watched Toggle */}
                  <button
                    onClick={() => handleMarkBatchWatched('season', selectedSeason, undefined, isSeasonFullyWatched)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold border transition-all ${
                      isSeasonFullyWatched
                        ? 'bg-purple-600/30 text-purple-300 border-purple-500/40 hover:bg-purple-600/50'
                        : 'bg-white/5 hover:bg-white/15 text-gray-300 border-white/10'
                    }`}
                    title={isSeasonFullyWatched ? `Mark Season ${selectedSeason} as unwatched` : `Mark entire Season ${selectedSeason} as watched`}
                  >
                    {isSeasonFullyWatched ? (
                      <>
                        <CheckCheck className="w-3.5 h-3.5 text-purple-400 stroke-[2.5]" />
                        <span>Season Watched</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5 text-gray-400" />
                        <span>Mark Season Watched</span>
                      </>
                    )}
                  </button>

                  {/* Mark All Prior Seasons Watched (when season > 1) */}
                  {selectedSeason > 1 && (
                    <button
                      onClick={() => handleMarkBatchWatched('before_season', selectedSeason)}
                      className="flex items-center gap-1.5 bg-white/5 hover:bg-white/15 text-gray-300 border border-white/10 px-2.5 py-1.5 rounded text-xs font-semibold transition-all"
                      title={`Mark all prior seasons (S1 through S${selectedSeason - 1}) as watched`}
                    >
                      <Layers className="w-3.5 h-3.5 text-gray-400" />
                      <span>Mark Prior Seasons Watched</span>
                    </button>
                  )}

                  {isEntireSeasonCached ? (
                    <span className="flex items-center gap-1.5 bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 px-3 py-1.5 rounded text-xs font-semibold shadow">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Season {selectedSeason} Cached</span>
                    </span>
                  ) : isSeasonCaching ? (
                    <span className="flex items-center gap-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 px-3 py-1.5 rounded text-xs font-semibold animate-pulse shadow">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                      <span>Caching Season {selectedSeason} ({seasonCompletedCount}/{episodes.length})</span>
                    </span>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNasCache('season', selectedSeason);
                      }}
                      className="flex items-center gap-1.5 bg-amber-600/30 hover:bg-amber-600 text-amber-300 hover:text-white border border-amber-500/40 px-3 py-1.5 rounded text-xs font-semibold transition-all shadow"
                      title={`Cache entire Season ${selectedSeason} to NAS`}
                    >
                      <Zap className="w-3.5 h-3.5 fill-current" />
                      <span>Cache Season {selectedSeason}</span>
                    </button>
                  )}

                  {/* Season Dropdown */}
                  {seasons.length > 1 && (
                    <select
                      value={selectedSeason}
                      onChange={(e) => setSelectedSeason(parseInt(e.target.value, 10))}
                      className="bg-[#242424] border border-gray-700 rounded px-3 py-1.5 text-sm font-semibold focus:outline-none focus:border-red-600"
                    >
                      {seasons.map((s) => (
                        <option key={s} value={s}>
                          Season {s}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {/* Episodes List */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-2">
                {episodes.map((ep) => {
                  const isSelected = selectedEpisode?.episodeNumber === ep.episodeNumber;
                  const epJob = getNasJob(selectedSeason, ep.episodeNumber);
                  const isEpCompleted = epJob?.status === 'completed' || ep.isNasCached;
                  const isEpDownloading = epJob?.status === 'downloading';
                  const isEpQueued = epJob?.status === 'queued';
                  const epPercent = epJob && epJob.file_size_bytes > 0
                    ? Math.min(100, Math.round((epJob.downloaded_bytes / epJob.file_size_bytes) * 100))
                    : 0;

                  const epProgress = watchedEpisodes.get(`${selectedSeason}:${ep.episodeNumber}`);
                  const isEpWatched = epProgress?.isCompleted || (epProgress && epProgress.durationMs > 0 && epProgress.positionMs >= epProgress.durationMs * 0.9);
                  const progressPercent = epProgress && epProgress.durationMs > 0
                    ? Math.min(100, Math.round((epProgress.positionMs / epProgress.durationMs) * 100))
                    : 0;

                  return (
                    <div
                      key={ep.episodeNumber}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setSelectedEpisode(ep);
                        loadStreams(selectedSeason, ep.episodeNumber, currentImdbId);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          setSelectedEpisode(ep);
                          loadStreams(selectedSeason, ep.episodeNumber, currentImdbId);
                        }
                      }}
                      className={`flex gap-3 p-2.5 rounded-lg border cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-white ${
                        isSelected
                          ? 'bg-white/15 border-white'
                          : 'bg-white/5 border-transparent hover:bg-white/10'
                      }`}
                    >
                      <div className="relative w-24 h-16 rounded overflow-hidden flex-none bg-[#242424]">
                        {ep.stillUrl ? (
                          <img
                            src={ep.stillUrl}
                            alt={ep.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-500 font-bold">
                            EP {ep.episodeNumber}
                          </div>
                        )}

                        {/* NAS status badge */}
                        {isEpCompleted && (
                          <div className="absolute top-1 left-1 bg-emerald-500 text-black p-0.5 rounded shadow" title="Cached on NAS">
                            <Check className="w-2.5 h-2.5 stroke-[3]" />
                          </div>
                        )}
                        {isEpDownloading && (
                          <div className="absolute top-1 left-1 bg-amber-500 text-black p-0.5 rounded shadow animate-pulse" title="Caching to NAS">
                            <RefreshCw className="w-2.5 h-2.5 animate-spin stroke-[3]" />
                          </div>
                        )}
                        {isEpQueued && (
                          <div className="absolute top-1 left-1 bg-blue-500 text-white p-0.5 rounded shadow" title="Queued for NAS cache">
                            <Clock className="w-2.5 h-2.5 stroke-[3]" />
                          </div>
                        )}

                        {/* Watched badge on thumbnail */}
                        {isEpWatched && (
                          <div className="absolute top-1 right-1 bg-purple-600/90 text-white px-1 py-0.5 rounded text-[8px] font-black uppercase flex items-center gap-0.5 shadow backdrop-blur-sm" title="Watched">
                            <Check className="w-2.5 h-2.5 stroke-[3]" />
                            <span>Watched</span>
                          </div>
                        )}

                        {/* Playback Progress Bar */}
                        {progressPercent > 0 && !isEpWatched && (
                          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-900">
                            <div className="h-full bg-red-600 transition-all" style={{ width: `${progressPercent}%` }} />
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-bold text-gray-200 truncate">
                            {ep.episodeNumber}. {ep.title}
                          </span>

                          <div className="flex items-center gap-1 flex-none ml-1">
                            {/* NAS Cache Badge / Button */}
                            {isEpCompleted ? (
                              <span
                                className="flex items-center gap-1 bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.5 rounded text-[10px] font-bold"
                                title="Cached on local NAS"
                              >
                                <Check className="w-2.5 h-2.5 text-emerald-400 stroke-[3]" />
                                <span>Cached</span>
                              </span>
                            ) : isEpDownloading ? (
                              <span
                                className="flex items-center gap-1 bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 rounded text-[10px] font-bold animate-pulse"
                                title="Currently caching to NAS"
                              >
                                <RefreshCw className="w-2.5 h-2.5 animate-spin text-amber-400" />
                                <span>{epPercent}%</span>
                              </span>
                            ) : isEpQueued ? (
                              <span
                                className="flex items-center gap-1 bg-blue-500/20 text-blue-300 border border-blue-500/40 px-1.5 py-0.5 rounded text-[10px] font-bold"
                                title="Queued for NAS cache"
                              >
                                <Clock className="w-2.5 h-2.5 text-blue-400" />
                                <span>Queued</span>
                              </span>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleNasCache('episode', selectedSeason, ep.episodeNumber);
                                }}
                                className="flex items-center gap-1 bg-amber-600/20 hover:bg-amber-600 text-amber-400 hover:text-white border border-amber-500/40 px-1.5 py-0.5 rounded text-[10px] font-bold transition-all shadow-sm"
                                title={`Cache Ep ${ep.episodeNumber} to NAS`}
                              >
                                <Zap className="w-2.5 h-2.5 fill-current" />
                                <span>Cache</span>
                              </button>
                            )}

                            {/* Mark Episode Watched / Unwatched Button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleEpisodeWatched(selectedSeason, ep);
                              }}
                              className={`p-1 rounded transition-colors ${
                                isEpWatched
                                  ? 'text-purple-400 hover:text-purple-300 hover:bg-purple-500/20'
                                  : 'text-gray-400 hover:text-white hover:bg-white/20'
                              }`}
                              title={isEpWatched ? 'Mark episode as unwatched' : 'Mark episode as watched'}
                            >
                              {isEpWatched ? (
                                <CheckCheck className="w-3.5 h-3.5 stroke-[2.5]" />
                              ) : (
                                <Check className="w-3.5 h-3.5" />
                              )}
                            </button>

                            {/* Mark All Episodes Prior to This as Watched */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMarkBatchWatched('before_episode', selectedSeason, ep.episodeNumber);
                              }}
                              className="p-1 hover:bg-white/20 text-gray-400 hover:text-white rounded transition-colors"
                              title={`Mark all episodes up to S${selectedSeason}E${ep.episodeNumber} as watched`}
                            >
                              <Layers className="w-3.5 h-3.5" />
                            </button>

                            {/* Device Download Button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeviceDownloadEpisode(selectedSeason, ep);
                              }}
                              className="p-1 hover:bg-white/20 text-gray-400 hover:text-white rounded transition-colors"
                              title={isEpCompleted ? 'Download episode to device from NAS' : 'Download episode to device'}
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <p className="text-[11px] text-gray-400 line-clamp-2 mt-1">
                          {ep.overview || 'No synopsis available.'}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Available Streams Section */}
          <div className="space-y-3 pt-4 border-t border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <span>Available Streams</span>
                {loadingStreams && <span className="text-xs text-gray-400 font-normal">Loading streams...</span>}
              </h3>

              {/* Provider Filter Tabs */}
              {availableProviders.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => setProviderFilter('all')}
                    className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                      providerFilter === 'all'
                        ? 'bg-white text-black shadow'
                        : 'bg-white/10 text-gray-300 hover:bg-white/20'
                    }`}
                  >
                    All ({streams.length})
                  </button>
                  {availableProviders.map((prov) => {
                    const count = streams.filter((s) => (s.badges.source || 'Debrid') === prov).length;
                    return (
                      <button
                        key={prov}
                        onClick={() => setProviderFilter(prov)}
                        className={`transition-all rounded-full ${
                          providerFilter === prov ? 'ring-2 ring-white ring-offset-2 ring-offset-[#181818] shadow' : 'opacity-70 hover:opacity-100'
                        }`}
                      >
                        <ProviderBadge source={prov} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {filteredStreams.length === 0 && !loadingStreams && (
              <div className="bg-white/5 border border-white/10 rounded-lg p-4 my-2 space-y-2">
                <div className="text-sm font-semibold text-gray-200">No playable streams currently available</div>
                <div className="text-xs text-gray-400">
                  If this is a fresh deployment, ensure your scrapers are enabled in AIOStreams at{' '}
                  <span className="font-mono text-amber-400">http://&lt;your-server-ip&gt;:3001</span> (login: admin / cinestream123) and that your token is set in your configuration.
                </div>
                <div>
                  <a
                    href="/diagnostics"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center text-xs text-amber-400 hover:text-amber-300 font-medium underline"
                  >
                    Open System Diagnostics &rarr;
                  </a>
                </div>
              </div>
            )}

            <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
              {filteredStreams.map((stream) => {
                const playable = isDirectPlayable(stream);
                return (
                <div
                  key={stream.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (!playable) {
                      setNasSuccessMessage('📰 Usenet NZB release: push to Sonarr/Radarr or SABnzbd to download to NAS before playing.');
                      setTimeout(() => setNasSuccessMessage(null), 6000);
                      return;
                    }
                    onPlayStream(stream, item.title, selectedEpisode?.title);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (!playable) {
                        setNasSuccessMessage('📰 Usenet NZB release: push to Sonarr/Radarr or SABnzbd to download to NAS before playing.');
                        setTimeout(() => setNasSuccessMessage(null), 6000);
                        return;
                      }
                      onPlayStream(stream, item.title, selectedEpisode?.title);
                    }
                  }}
                  className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-white ${
                    stream.badges.isNasCached
                      ? 'bg-amber-500/10 border-amber-500/40 hover:bg-amber-500/20'
                      : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 font-semibold text-sm">
                      <span>{stream.name}</span>
                      <ProviderBadge source={stream.badges.source} />
                      {stream.badges.isNasCached && (
                        <span className="bg-amber-500 text-black px-1.5 py-0.5 rounded text-[10px] font-black uppercase">
                          ⚡ Local Gigabit
                        </span>
                      )}
                      {!playable && (
                        <span
                          className="bg-blue-900/40 text-blue-300 border border-blue-500/30 px-1.5 py-0.5 rounded text-[10px] font-bold"
                          title="Usenet NZB index descriptor for SABnzbd / Sonarr / Radarr (cannot be streamed live over HTTP)"
                        >
                          📰 NZB (Download Only)
                        </span>
                      )}
                      {playable && !isNativeApp && isBrowserLosslessAudio(stream) && (
                        <span
                          className="bg-purple-900/40 text-purple-300 border border-purple-500/30 px-1.5 py-0.5 rounded text-[10px] font-bold"
                          title="Lossless TrueHD / DTS audio. Plays in VLC or on Android TV app."
                        >
                          🎧 Lossless (VLC / TV)
                        </span>
                      )}
                      {playable && !isNativeApp && !isBrowserLosslessAudio(stream) && (
                        <span
                          className="bg-emerald-900/40 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded text-[10px] font-bold"
                          title="Directly playable in desktop browser"
                        >
                          ✓ Browser Ready
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-300 font-medium">
                      {cleanStreamDetails(stream)}
                    </div>
                  </div>

                  {/* Badges & Play Button */}
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold">
                      <span className="bg-white/10 px-2 py-0.5 rounded text-white">
                        {stream.badges.resolution}
                      </span>
                      {stream.badges.dolbyVision && (
                        <span className="bg-purple-900/60 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/30">
                          DV
                        </span>
                      )}
                      {stream.badges.atmos && (
                        <span className="bg-blue-900/60 text-blue-300 px-1.5 py-0.5 rounded border border-blue-500/30">
                          Atmos
                        </span>
                      )}
                      {stream.badges.sizeText && (
                        <span
                          className={`px-1.5 py-0.5 rounded border text-[10px] ${
                            stream.badges.sizeTier === 'micro'
                              ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                              : stream.badges.sizeTier === 'high'
                              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                              : stream.badges.sizeTier === 'remux'
                              ? 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                              : 'bg-white/5 text-gray-300 border-white/10'
                          }`}
                          title={
                            stream.badges.sizeTier === 'micro'
                              ? 'Micro-encode: low bitrate (~2-4 Mbps) despite DV/Atmos tags'
                              : stream.badges.sizeTier === 'high'
                              ? 'High Bitrate: transparent quality release'
                              : stream.badges.sizeTier === 'remux'
                              ? '1:1 Disc Remux: uncompressed/highest bitrate'
                              : 'Standard release size'
                          }
                        >
                          {stream.badges.sizeTier === 'micro' ? `⚠️ ${stream.badges.sizeText}` : stream.badges.sizeText}
                        </span>
                      )}
                    </div>

                    {/* Cache this specific stream to NAS */}
                    {!stream.badges.isNasCached ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleNasCacheSpecificStream(stream);
                        }}
                        className="bg-amber-600/20 hover:bg-amber-600 text-amber-400 hover:text-white p-2 rounded-full transition-colors border border-amber-500/30"
                        title={`Cache this ${stream.badges.resolution} (${stream.badges.source}${stream.badges.sizeText ? ` • ${stream.badges.sizeText}` : ''}) directly to NAS`}
                      >
                        <Zap className="w-3.5 h-3.5 fill-current" />
                      </button>
                    ) : (
                      <span
                        className="bg-emerald-600/20 text-emerald-300 p-2 rounded-full border border-emerald-500/30 flex items-center justify-center"
                        title="Stream already cached on local NAS"
                      >
                        <Check className="w-3.5 h-3.5 text-emerald-400 stroke-[3]" />
                      </span>
                    )}

                    {/* Push equivalent release (±10% size) to Radarr / Sonarr */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleArrPush(stream);
                      }}
                      disabled={pushingArrStreamId === stream.id}
                      className="bg-cyan-600/20 hover:bg-cyan-600 text-cyan-300 hover:text-white p-2 rounded-full transition-colors border border-cyan-500/30 disabled:opacity-50"
                      title={
                        stream.magnetUrl
                          ? `Push exact magnet release directly to ${item.type === 'tv' ? 'Sonarr' : 'Radarr'}`
                          : `Search ${item.type === 'tv' ? 'Sonarr' : 'Radarr'} indexers for equivalent release within ±10% size (${stream.badges.sizeText || 'matching'}) and push to queue`
                      }
                    >
                      {pushingArrStreamId === stream.id ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : item.type === 'tv' ? (
                        <SonarrIcon className="w-3.5 h-3.5 flex-shrink-0" />
                      ) : (
                        <RadarrIcon className="w-3.5 h-3.5 flex-shrink-0" />
                      )}
                    </button>

                    {/* Copy Magnet Link / Open torrent client */}
                    {stream.magnetUrl && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (navigator.clipboard) {
                            navigator.clipboard.writeText(stream.magnetUrl!);
                            setNasSuccessMessage('🧲 Magnet link copied to clipboard!');
                            setTimeout(() => setNasSuccessMessage(null), 4000);
                          }
                        }}
                        className="bg-purple-600/20 hover:bg-purple-600 text-purple-300 hover:text-white p-2 rounded-full transition-colors border border-purple-500/30"
                        title="Copy Magnet link to clipboard"
                      >
                        <Magnet className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* Copy NZB Link / Download NZB */}
                    {stream.nzbUrl && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (navigator.clipboard) {
                            navigator.clipboard.writeText(stream.nzbUrl!);
                            setNasSuccessMessage('📰 NZB link copied to clipboard!');
                            setTimeout(() => setNasSuccessMessage(null), 4000);
                          }
                        }}
                        className="bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white p-2 rounded-full transition-colors border border-blue-500/30"
                        title="Copy NZB link to clipboard"
                      >
                        <FileDown className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* Download this specific stream */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownloadStream(stream);
                      }}
                      className="bg-white/10 hover:bg-white text-white hover:text-black p-2 rounded-full transition-colors"
                      title={`Download this ${stream.badges.resolution}${stream.badges.sizeText ? ` (${stream.badges.sizeText})` : ''} stream to device`}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>

                    {playable ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onPlayStream(stream, item.title, selectedEpisode?.title);
                        }}
                        className="bg-white/10 hover:bg-white text-white hover:text-black p-2 rounded-full transition-colors"
                        title="Play stream"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleArrPush(stream);
                        }}
                        className="bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white p-2 rounded-full transition-colors border border-blue-500/30"
                        title="Push Usenet NZB to Sonarr/Radarr / SABnzbd queue"
                      >
                        <FileDown className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

