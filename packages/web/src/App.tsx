import React, { useState, useEffect, useMemo } from 'react';
import { Play, Sparkles, Film, Tv, Plus, Zap, RefreshCw, Clock } from 'lucide-react';
import { useSpatialNavInit } from './hooks/useSpatialNav';
import { useProfileStore } from './store/useProfileStore';
import { useOfflineStore } from './store/useOfflineStore';
import { CatalogItem, NasCacheItem, OfflineMediaItem, ResolvedStream, WatchProgress } from './types/api';
import { Navbar } from './components/Navbar';
import { ProfileGate } from './components/ProfileGate';
import { HeroBillboard } from './components/HeroBillboard';
import { TopTenRow } from './components/TopTenRow';
import { VirtualPosterRow } from './components/VirtualPosterRow';
import { MediaDetailModal } from './components/MediaDetailModal';
import { DownloadsDrawer } from './components/DownloadsDrawer';
import { InstantSearch } from './components/InstantSearch';
import { PlayerOverlay } from './components/PlayerOverlay';
import { Capacitor } from '@capacitor/core';

interface ActivePlayerState {
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
}

export const App: React.FC = () => {
  useSpatialNavInit();

  const { activeProfile, isGateOpen } = useProfileStore();
  const { isOfflineMode, offlineItems } = useOfflineStore();

  const [activeTab, setActiveTab] = useState('home');
  const [heroItem, setHeroItem] = useState<CatalogItem | null>(null);

  // Top 10 State
  const [topTenItems, setTopTenItems] = useState<CatalogItem[]>([]);
  const [topTenRegion, setTopTenRegion] = useState('ZA');
  const [topTenProvider, setTopTenProvider] = useState<'all' | 'netflix' | 'apple' | 'disney' | 'prime' | 'max'>('all');
  const [topTenMediaType, setTopTenMediaType] = useState<'movie' | 'tv'>('movie');

  // Rows State
  const [newReleases, setNewReleases] = useState<CatalogItem[]>([]);
  const [trendingMovies, setTrendingMovies] = useState<CatalogItem[]>([]);
  const [trendingSeries, setTrendingSeries] = useState<CatalogItem[]>([]);
  const [continueWatching, setContinueWatching] = useState<WatchProgress[]>([]);
  const [myListItems, setMyListItems] = useState<CatalogItem[]>([]);
  const [nasCachedItems, setNasCachedItems] = useState<CatalogItem[]>([]);
  const [nasJobs, setNasJobs] = useState<NasCacheItem[]>([]);
  const [activeDownloadsCount, setActiveDownloadsCount] = useState(0);

  // Modals & Drawers
  const [selectedModalItem, setSelectedModalItem] = useState<CatalogItem | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isDownloadsOpen, setIsDownloadsOpen] = useState(false);
  const [playerState, setPlayerState] = useState<ActivePlayerState | null>(null);

  // Fetch catalog when active profile or top 10 filters change
  useEffect(() => {
    if (!activeProfile || isGateOpen) return;

    fetchTopTen();
    fetchNewReleases();
    fetchTrendingMovies();
    fetchTrendingSeries();
    fetchContinueWatching();
    fetchMyList();
    fetchNasJobs();
  }, [activeProfile, isGateOpen]);

  useEffect(() => {
    if (!activeProfile || isGateOpen) return;
    fetchTopTen();
  }, [topTenRegion, topTenProvider, topTenMediaType]);

  const fetchTrendingMovies = async () => {
    try {
      const res = await fetch('/api/catalog/trending?type=movie', {
        headers: { 'X-Profile-Id': activeProfile?.id || '' },
      });
      if (res.ok) {
        const data: CatalogItem[] = await res.json();
        setTrendingMovies(data);
      }
    } catch (_) {}
  };

  const fetchTrendingSeries = async () => {
    try {
      const res = await fetch('/api/catalog/trending?type=tv', {
        headers: { 'X-Profile-Id': activeProfile?.id || '' },
      });
      if (res.ok) {
        const data: CatalogItem[] = await res.json();
        setTrendingSeries(data);
      }
    } catch (_) {}
  };

  const fetchTopTen = async () => {
    try {
      const res = await fetch(
        `/api/catalog/top10?region=${topTenRegion}&provider=${topTenProvider}&type=${topTenMediaType}`,
        { headers: { 'X-Profile-Id': activeProfile?.id || '' } }
      );
      if (res.ok) {
        const data: CatalogItem[] = await res.json();
        setTopTenItems(data);
        if (!heroItem && data.length > 0) {
          setHeroItem(data[0]);
        }
      }
    } catch (_) {}
  };

  const fetchNewReleases = async () => {
    try {
      const res = await fetch('/api/catalog/new-releases', {
        headers: { 'X-Profile-Id': activeProfile?.id || '' },
      });
      if (res.ok) {
        const data: CatalogItem[] = await res.json();
        setNewReleases(data);
      }
    } catch (_) {}
  };

  const fetchContinueWatching = async () => {
    try {
      const res = await fetch('/api/progress', {
        headers: { 'X-Profile-Id': activeProfile?.id || '' },
      });
      if (res.ok) {
        const data: WatchProgress[] = await res.json();
        setContinueWatching(data);
      }
    } catch (_) {}
  };

  const fetchMyList = async () => {
    try {
      const res = await fetch('/api/mylist', {
        headers: { 'X-Profile-Id': activeProfile?.id || '' },
      });
      if (res.ok) {
        const rows: any[] = await res.json();
        const mapped: CatalogItem[] = rows.map((r) => ({
          id: r.tmdb_id,
          imdbId: r.imdb_id,
          tmdbId: r.tmdb_id,
          type: r.media_type,
          title: r.title,
          overview: '',
          posterUrl: r.poster_url,
          backdropUrl: r.backdrop_url,
          clearLogoUrl: null,
          voteAverage: 0,
          isNasCached: false,
          genres: [],
        }));
        setMyListItems(mapped);
      }
    } catch (_) {}
  };

  const updateNasState = (jobs: NasCacheItem[]) => {
    setNasJobs(jobs);
    const active = jobs.filter((j) => j.status === 'downloading' || j.status === 'queued');
    setActiveDownloadsCount(active.length);

    const seen = new Set<string>();
    const completedUnique: CatalogItem[] = [];
    for (const j of jobs) {
      if (j.status !== 'completed') continue;
      const key = j.imdb_id || String(j.tmdb_id);
      if (!seen.has(key)) {
        seen.add(key);
        completedUnique.push({
          id: j.tmdb_id,
          imdbId: j.imdb_id,
          tmdbId: j.tmdb_id,
          type: j.media_type,
          title: j.title,
          overview: j.episode_title || '',
          posterUrl: j.poster_url,
          backdropUrl: j.backdrop_url,
          clearLogoUrl: null,
          voteAverage: 0,
          isNasCached: true,
          qualityBadge: j.quality_badge,
          genres: [],
        });
      }
    }
    setNasCachedItems(completedUnique);
  };

  const fetchNasJobs = async () => {
    try {
      const res = await fetch('/api/nas/jobs');
      if (res.ok) {
        const jobs: NasCacheItem[] = await res.json();
        updateNasState(jobs);
      }
    } catch (_) {}
  };

  // Sync NAS jobs and WebSocket updates globally across the app
  useEffect(() => {
    fetchNasJobs();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/downloads`;
    let ws: WebSocket | null = null;
    let reconnectTimer: any = null;

    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.jobs) {
              updateNasState(data.jobs as NasCacheItem[]);
            }
          } catch (_) {}
        };
        ws.onclose = () => {
          reconnectTimer = setTimeout(connect, 4000);
        };
      } catch (_) {}
    };

    connect();

    return () => {
      if (ws) ws.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  const nasStatusMap = useMemo(() => {
    const map: Record<string, { status: 'completed' | 'downloading' | 'queued'; percent: number }> = {};
    for (const job of nasJobs) {
      const pct = job.file_size_bytes > 0
        ? Math.min(100, Math.round((job.downloaded_bytes / job.file_size_bytes) * 100))
        : 0;

      const keys = [job.imdb_id, String(job.tmdb_id)].filter(Boolean);
      for (const key of keys) {
        const existing = map[key];
        if (job.status === 'downloading') {
          map[key] = {
            status: 'downloading',
            percent: Math.max(existing?.status === 'downloading' ? existing.percent : 0, pct),
          };
        } else if (job.status === 'queued') {
          if (!existing || existing.status !== 'downloading') {
            map[key] = { status: 'queued', percent: 0 };
          }
        } else if (job.status === 'completed') {
          if (!existing) {
            map[key] = { status: 'completed', percent: 100 };
          }
        }
      }
    }
    return map;
  }, [nasJobs]);

  // Profile gate guard
  if (isGateOpen || !activeProfile) {
    return <ProfileGate />;
  }

  // Map continue watching rows to CatalogItem
  const continueWatchingCatalog: CatalogItem[] = continueWatching.map((cw) => ({
    id: cw.tmdb_id,
    imdbId: cw.imdb_id,
    tmdbId: cw.tmdb_id,
    type: cw.media_type,
    title: cw.title,
    overview: cw.episode_title || '',
    posterUrl: cw.poster_url,
    backdropUrl: cw.backdrop_url,
    clearLogoUrl: cw.clear_logo_url,
    voteAverage: 0,
    isNasCached: false,
    genres: [],
  }));

  const progressMap: Record<string, { positionMs: number; durationMs: number }> = {};
  continueWatching.forEach((cw) => {
    progressMap[cw.imdb_id] = { positionMs: cw.position_ms, durationMs: cw.duration_ms };
  });

  // Offline Mode view
  if (isOfflineMode) {
    const offlineCatalog: CatalogItem[] = offlineItems.map((oi) => ({
      id: oi.tmdbId,
      imdbId: oi.imdbId,
      tmdbId: oi.tmdbId,
      type: oi.mediaType,
      title: oi.title,
      overview: oi.episodeTitle || '',
      posterUrl: oi.posterBase64 || oi.posterUrl || null,
      backdropUrl: oi.backdropBase64 || oi.backdropUrl || null,
      clearLogoUrl: null,
      voteAverage: 0,
      isNasCached: false,
      qualityBadge: 'Offline File',
      genres: [],
    }));

    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white">
        {!playerState && (
          <Navbar
            onOpenSearch={() => setIsSearchOpen(true)}
            onOpenDownloads={() => setIsDownloadsOpen(true)}
            activeTab={activeTab}
            onSelectTab={setActiveTab}
            activeDownloadsCount={activeDownloadsCount}
          />
        )}

        <main className="pt-24 px-4 sm:px-12 space-y-8">
          <div className="bg-amber-500/10 border border-amber-500/30 p-6 rounded-2xl flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-amber-400">Offline Tablet Mode Active</h2>
              <p className="text-xs text-gray-300 mt-1">
                No active internet or server connection. Showing files saved locally on this device.
              </p>
            </div>
            <button
              onClick={() => setIsDownloadsOpen(true)}
              className="px-4 py-2 bg-amber-500 text-black font-bold text-xs rounded-lg"
            >
              Manage Storage
            </button>
          </div>

          <VirtualPosterRow
            title="Downloaded on This Device"
            subtitle="Ready for offline playback without Wi-Fi"
            items={offlineCatalog}
            onSelect={(item) => {
              const matched = offlineItems.find((oi) => oi.imdbId === item.imdbId);
              if (matched) {
                setPlayerState({
                  streamUrl: matched.localFileUri,
                  title: matched.title,
                  episodeTitle: matched.episodeTitle,
                  imdbId: matched.imdbId,
                  tmdbId: matched.tmdbId,
                  season: matched.season,
                  episode: matched.episode,
                  isOfflineFile: true,
                  provider: 'Offline Device',
                });
              }
            }}
          />
        </main>

        <DownloadsDrawer
          isOpen={isDownloadsOpen}
          onClose={() => setIsDownloadsOpen(false)}
          onPlayOffline={(oi) => {
            setIsDownloadsOpen(false);
            setPlayerState({
              streamUrl: oi.localFileUri,
              title: oi.title,
              episodeTitle: oi.episodeTitle,
              imdbId: oi.imdbId,
              tmdbId: oi.tmdbId,
              season: oi.season,
              episode: oi.episode,
              isOfflineFile: true,
            });
          }}
          onPlayNasItem={() => {}}
        />

        {playerState && (
          <PlayerOverlay
            {...playerState}
            onClose={() => setPlayerState(null)}
          />
        )}
      </div>
    );
  }

  const handleSelectTab = (tab: string) => {
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (tab === 'movies') {
      setTopTenMediaType('movie');
    } else if (tab === 'series') {
      setTopTenMediaType('tv');
    }
  };

  let currentHero = heroItem;
  if (activeTab === 'movies') {
    currentHero = (topTenMediaType === 'movie' && topTenItems[0]) || trendingMovies[0] || heroItem;
  } else if (activeTab === 'series') {
    currentHero = (topTenMediaType === 'tv' && topTenItems[0]) || trendingSeries[0] || heroItem;
  } else if (activeTab === 'new') {
    currentHero = newReleases[0] || heroItem;
  } else if (activeTab === 'mylist') {
    currentHero = myListItems[0] || heroItem;
  }

  const movieCw = continueWatchingCatalog.filter((c) => c.type === 'movie');
  const seriesCw = continueWatchingCatalog.filter((c) => c.type === 'tv');

  const movieNas = nasCachedItems.filter((n) => n.type === 'movie');
  const seriesNas = nasCachedItems.filter((n) => n.type === 'tv');

  const movieMyList = myListItems.filter((m) => m.type === 'movie');
  const seriesMyList = myListItems.filter((m) => m.type === 'tv');

  const uhdReleases = newReleases.filter(
    (r) => r.qualityBadge?.includes('4K') || r.qualityBadge?.includes('DV') || r.qualityBadge?.includes('Vision')
  );

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white overflow-x-hidden pb-20">
      {/* Top Navbar */}
      {!playerState && (
        <Navbar
          onOpenSearch={() => setIsSearchOpen(true)}
          onOpenDownloads={() => setIsDownloadsOpen(true)}
          activeTab={activeTab}
          onSelectTab={handleSelectTab}
          activeDownloadsCount={activeDownloadsCount}
        />
      )}

      {/* Main Content */}
      <main>
        {/* Render for My List Tab when Empty */}
        {activeTab === 'mylist' && myListItems.length === 0 ? (
          <div className="pt-36 px-4 sm:px-12 text-center space-y-5 max-w-lg mx-auto min-h-[60vh] flex flex-col items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center text-gray-400">
              <Plus className="w-8 h-8" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-black">Your list is empty</h2>
            <p className="text-sm text-gray-400 leading-relaxed">
              Explore movies and TV series across our catalog and tap &quot;Add to List&quot; to save them for quick access.
            </p>
            <button
              onClick={() => handleSelectTab('home')}
              className="px-6 py-2.5 bg-red-600 hover:bg-red-500 text-white font-bold text-sm rounded shadow transition-all"
            >
              Explore Catalog
            </button>
          </div>
        ) : (
          <>
            {/* Hero Billboard */}
            <HeroBillboard
              item={currentHero}
              nasStatus={currentHero ? (nasStatusMap[currentHero.imdbId] || (currentHero.tmdbId ? nasStatusMap[String(currentHero.tmdbId)] : undefined)) : undefined}
              onPlay={(item) => setSelectedModalItem(item)}
              onMoreInfo={(item) => setSelectedModalItem(item)}
            />

            <div className="-mt-16 sm:-mt-24 relative z-20 space-y-6">
              {/* HOME TAB */}
              {activeTab === 'home' && (
                <>
                  {continueWatchingCatalog.length > 0 && (
                    <VirtualPosterRow
                      title="Continue Watching"
                      items={continueWatchingCatalog}
                      onSelect={(item) => setSelectedModalItem(item)}
                      progressMap={progressMap}
                      nasStatusMap={nasStatusMap}
                    />
                  )}

                  {topTenItems.length > 0 && (
                    <TopTenRow
                      items={topTenItems}
                      region={topTenRegion}
                      onRegionChange={setTopTenRegion}
                      provider={topTenProvider}
                      onProviderChange={setTopTenProvider}
                      mediaType={topTenMediaType}
                      onMediaTypeChange={setTopTenMediaType}
                      onSelect={(item) => setSelectedModalItem(item)}
                      nasStatusMap={nasStatusMap}
                    />
                  )}

                  {newReleases.length > 0 && (
                    <VirtualPosterRow
                      title="Verified New Releases (Non-CAM)"
                      subtitle="Guaranteed 1080p & 4K BluRay / WEB-DL streams verified"
                      items={newReleases}
                      onSelect={(item) => setSelectedModalItem(item)}
                      nasStatusMap={nasStatusMap}
                    />
                  )}

                  {nasCachedItems.length > 0 && (
                    <VirtualPosterRow
                      title="⚡ Cached on Local NAS"
                      subtitle="Instantly playable from your home server over Gigabit LAN"
                      items={nasCachedItems}
                      onSelect={(item) => setSelectedModalItem(item)}
                      nasStatusMap={nasStatusMap}
                    />
                  )}

                  {myListItems.length > 0 && (
                    <VirtualPosterRow
                      title="My List"
                      items={myListItems}
                      onSelect={(item) => setSelectedModalItem(item)}
                      nasStatusMap={nasStatusMap}
                    />
                  )}
                </>
              )}

              {/* MOVIES TAB */}
              {activeTab === 'movies' && (
                <>
                  {movieCw.length > 0 && (
                    <VirtualPosterRow
                      title="Continue Watching Movies"
                      items={movieCw}
                      onSelect={(item) => setSelectedModalItem(item)}
                      progressMap={progressMap}
                      nasStatusMap={nasStatusMap}
                    />
                  )}

                  {topTenItems.length > 0 && (
                    <TopTenRow
                      items={topTenItems}
                      region={topTenRegion}
                      onRegionChange={setTopTenRegion}
                      provider={topTenProvider}
                      onProviderChange={setTopTenProvider}
                      mediaType="movie"
                      onMediaTypeChange={() => {}}
                      onSelect={(item) => setSelectedModalItem(item)}
                      nasStatusMap={nasStatusMap}
                    />
                  )}

                  {newReleases.length > 0 && (
                    <VirtualPosterRow
                      title="Verified New Releases (Non-CAM)"
                      subtitle="Guaranteed 1080p & 4K BluRay / WEB-DL releases"
                      items={newReleases}
                      onSelect={(item) => setSelectedModalItem(item)}
                      nasStatusMap={nasStatusMap}
                    />
                  )}

                  {trendingMovies.length > 0 && (
                    <VirtualPosterRow
                      title="Trending Movies This Week"
                      subtitle="Popular theatrical and streaming films"
                      items={trendingMovies}
                      onSelect={(item) => setSelectedModalItem(item)}
                      nasStatusMap={nasStatusMap}
                    />
                  )}

                  {movieNas.length > 0 && (
                    <VirtualPosterRow
                      title="⚡ Cached Movies on Local NAS"
                      subtitle="Gigabit LAN Direct Playback"
                      items={movieNas}
                      onSelect={(item) => setSelectedModalItem(item)}
                      nasStatusMap={nasStatusMap}
                    />
                  )}

                  {movieMyList.length > 0 && (
                    <VirtualPosterRow
                      title="My Saved Movies"
                      items={movieMyList}
                      onSelect={(item) => setSelectedModalItem(item)}
                      nasStatusMap={nasStatusMap}
                    />
                  )}
                </>
              )}

              {/* TV SERIES TAB */}
              {activeTab === 'series' && (
                <>
                  {seriesCw.length > 0 && (
                    <VirtualPosterRow
                      title="Continue Watching Series"
                      items={seriesCw}
                      onSelect={(item) => setSelectedModalItem(item)}
                      progressMap={progressMap}
                      nasStatusMap={nasStatusMap}
                    />
                  )}

                  {topTenItems.length > 0 && (
                    <TopTenRow
                      items={topTenItems}
                      region={topTenRegion}
                      onRegionChange={setTopTenRegion}
                      provider={topTenProvider}
                      onProviderChange={setTopTenProvider}
                      mediaType="tv"
                      onMediaTypeChange={() => {}}
                      onSelect={(item) => setSelectedModalItem(item)}
                      nasStatusMap={nasStatusMap}
                    />
                  )}

                  {trendingSeries.length > 0 && (
                    <VirtualPosterRow
                      title="Trending TV Series"
                      subtitle="Most-watched TV series this week"
                      items={trendingSeries}
                      onSelect={(item) => setSelectedModalItem(item)}
                      nasStatusMap={nasStatusMap}
                    />
                  )}

                  {seriesNas.length > 0 && (
                    <VirtualPosterRow
                      title="⚡ Cached Series on Local NAS"
                      subtitle="Gigabit LAN Direct Playback"
                      items={seriesNas}
                      onSelect={(item) => setSelectedModalItem(item)}
                      nasStatusMap={nasStatusMap}
                    />
                  )}

                  {seriesMyList.length > 0 && (
                    <VirtualPosterRow
                      title="My Saved TV Shows"
                      items={seriesMyList}
                      onSelect={(item) => setSelectedModalItem(item)}
                      nasStatusMap={nasStatusMap}
                    />
                  )}
                </>
              )}

              {/* NEW & VERIFIED TAB */}
              {activeTab === 'new' && (
                <>
                  <div className="px-4 sm:px-12 py-2">
                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-red-500" />
                      <span>Verified High-Quality Releases (Non-CAM)</span>
                    </h2>
                    <p className="text-xs sm:text-sm text-gray-400 mt-1 max-w-3xl">
                      Every title here is verified against high-speed Usenet and Debrid backends to guarantee authentic 4K UHD, HDR, Dolby Vision, and lossless multi-channel surround sound.
                    </p>
                  </div>

                  {uhdReleases.length > 0 && (
                    <VirtualPosterRow
                      title="🔥 Verified 4K UHD & Dolby Vision"
                      subtitle="Pristine 2160p releases verified non-cam"
                      items={uhdReleases}
                      onSelect={(item) => setSelectedModalItem(item)}
                      nasStatusMap={nasStatusMap}
                    />
                  )}

                  {newReleases.length > 0 && (
                    <VirtualPosterRow
                      title="All Verified Non-CAM Releases"
                      subtitle="Full catalog of releases verified ready for playback"
                      items={newReleases}
                      onSelect={(item) => setSelectedModalItem(item)}
                      nasStatusMap={nasStatusMap}
                    />
                  )}

                  {/* Complete Responsive Grid for New & Verified */}
                  {newReleases.length > 0 && (
                    <div className="px-4 sm:px-12 pt-6 space-y-4">
                      <h3 className="text-lg font-bold text-gray-200">Browse Verified Catalog</h3>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                        {newReleases.map((item) => {
                          const nasStatus = nasStatusMap[item.imdbId] || (item.tmdbId ? nasStatusMap[String(item.tmdbId)] : undefined);
                          const isCompleted = nasStatus?.status === 'completed' || item.isNasCached;
                          const isDownloading = nasStatus?.status === 'downloading';
                          const isQueued = nasStatus?.status === 'queued';
                          const pct = nasStatus?.percent || 0;

                          return (
                            <div
                              key={item.imdbId || item.id}
                              onClick={() => setSelectedModalItem(item)}
                              className="group relative rounded-lg overflow-hidden bg-[#181818] aspect-[2/3] cursor-pointer border border-white/5 hover:border-white shadow-xl transition-all duration-300 hover:scale-105"
                            >
                              {item.posterUrl ? (
                                <img src={item.posterUrl} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center p-3 text-center text-xs font-bold text-gray-300">
                                  {item.title}
                                </div>
                              )}
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <div className="bg-red-600 p-3 rounded-full shadow-lg">
                                  <Play className="w-5 h-5 fill-white text-white" />
                                </div>
                              </div>
                              <div className="absolute top-2 left-2 z-10 flex flex-col gap-1">
                                {isCompleted && (
                                  <span className="flex items-center gap-1 bg-emerald-500 text-black px-1.5 py-0.5 rounded text-[10px] font-black uppercase shadow">
                                    <Zap className="w-2.5 h-2.5 fill-black" />
                                    NAS
                                  </span>
                                )}
                                {isDownloading && (
                                  <span className="flex items-center gap-1 bg-amber-500 text-black px-1.5 py-0.5 rounded text-[10px] font-black uppercase shadow animate-pulse">
                                    <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                                    {pct}%
                                  </span>
                                )}
                                {isQueued && (
                                  <span className="flex items-center gap-1 bg-blue-500 text-white px-1.5 py-0.5 rounded text-[10px] font-black uppercase shadow">
                                    <Clock className="w-2.5 h-2.5" />
                                    QUEUED
                                  </span>
                                )}
                                {item.qualityBadge && (
                                  <span className="bg-black/80 backdrop-blur-sm text-white px-1.5 py-0.5 rounded text-[9px] font-bold border border-white/20">
                                    {item.qualityBadge}
                                  </span>
                                )}
                              </div>
                              <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black via-black/80 to-transparent">
                                <span className="text-xs font-bold text-white truncate block">{item.title}</span>
                                <span className="text-[10px] text-gray-400 uppercase font-semibold">
                                  {item.releaseDate ? item.releaseDate.split('-')[0] : 'Movie'}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* MY LIST TAB */}
              {activeTab === 'mylist' && myListItems.length > 0 && (
                <div className="px-4 sm:px-12 space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                        My Saved List ({myListItems.length})
                      </h2>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Titles you have bookmarked across all devices
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {myListItems.map((item) => {
                      const nasStatus = nasStatusMap[item.imdbId] || (item.tmdbId ? nasStatusMap[String(item.tmdbId)] : undefined);
                      const isCompleted = nasStatus?.status === 'completed' || item.isNasCached;
                      const isDownloading = nasStatus?.status === 'downloading';
                      const isQueued = nasStatus?.status === 'queued';
                      const pct = nasStatus?.percent || 0;

                      return (
                        <div
                          key={item.imdbId || item.id}
                          onClick={() => setSelectedModalItem(item)}
                          className="group relative rounded-lg overflow-hidden bg-[#181818] aspect-[2/3] cursor-pointer border border-white/5 hover:border-white shadow-xl transition-all duration-300 hover:scale-105"
                        >
                          {item.posterUrl ? (
                            <img src={item.posterUrl} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center p-3 text-center text-xs font-bold text-gray-300">
                              {item.title}
                            </div>
                          )}
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <div className="bg-red-600 p-3 rounded-full shadow-lg">
                              <Play className="w-5 h-5 fill-white text-white" />
                            </div>
                          </div>
                          <div className="absolute top-2 left-2 z-10 flex flex-col gap-1">
                            {isCompleted && (
                              <span className="flex items-center gap-1 bg-emerald-500 text-black px-1.5 py-0.5 rounded text-[10px] font-black uppercase shadow">
                                <Zap className="w-2.5 h-2.5 fill-black" />
                                NAS
                              </span>
                            )}
                            {isDownloading && (
                              <span className="flex items-center gap-1 bg-amber-500 text-black px-1.5 py-0.5 rounded text-[10px] font-black uppercase shadow animate-pulse">
                                <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                                {pct}%
                              </span>
                            )}
                            {isQueued && (
                              <span className="flex items-center gap-1 bg-blue-500 text-white px-1.5 py-0.5 rounded text-[10px] font-black uppercase shadow">
                                <Clock className="w-2.5 h-2.5" />
                                QUEUED
                              </span>
                            )}
                          </div>
                          <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black via-black/80 to-transparent">
                            <span className="text-xs font-bold text-white truncate block">{item.title}</span>
                            <span className="text-[10px] text-gray-400 uppercase font-semibold">
                              {item.type === 'tv' ? 'TV Series' : 'Movie'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {continueWatchingCatalog.length > 0 && (
                    <div className="pt-6">
                      <VirtualPosterRow
                        title="Continue Watching"
                        items={continueWatchingCatalog}
                        onSelect={(item) => setSelectedModalItem(item)}
                        progressMap={progressMap}
                        nasStatusMap={nasStatusMap}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* Media Detail Modal */}
      {selectedModalItem && (
        <MediaDetailModal
          item={selectedModalItem}
          onClose={() => {
            setSelectedModalItem(null);
            fetchContinueWatching();
            fetchMyList();
          }}
          onPlayStream={(stream: ResolvedStream, mediaTitle: string, epTitle?: string) => {
            setSelectedModalItem(null);
            const qParts: string[] = [];
            if (stream.badges.resolution) qParts.push(stream.badges.resolution);
            if (stream.badges.dolbyVision) qParts.push('DV');
            else if (stream.badges.hdr10Plus) qParts.push('HDR10+');
            else if (stream.badges.hdr) qParts.push('HDR');
            if (stream.badges.atmos) qParts.push('Atmos');
            const qBadge = qParts.join(' • ');

            setPlayerState({
              streamUrl: stream.url,
              title: mediaTitle,
              episodeTitle: epTitle,
              imdbId: selectedModalItem.imdbId,
              tmdbId: selectedModalItem.tmdbId,
              season: 0,
              episode: 0,
              isNasCached: stream.badges.isNasCached,
              provider: stream.badges.source,
              qualityBadge: qBadge || undefined,
            });
          }}
        />
      )}

      {/* Instant Search Overlay */}
      <InstantSearch
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelect={(item) => {
          setIsSearchOpen(false);
          setSelectedModalItem(item);
        }}
        nasStatusMap={nasStatusMap}
      />

      {/* Storage & Downloads Drawer */}
      <DownloadsDrawer
        isOpen={isDownloadsOpen}
        onClose={() => setIsDownloadsOpen(false)}
        onPlayOffline={(oi) => {
          setIsDownloadsOpen(false);
          setPlayerState({
            streamUrl: oi.localFileUri,
            title: oi.title,
            episodeTitle: oi.episodeTitle,
            imdbId: oi.imdbId,
            tmdbId: oi.tmdbId,
            season: oi.season,
            episode: oi.episode,
            isOfflineFile: true,
            provider: 'Offline Device',
            qualityBadge: 'Offline Local',
          });
        }}
        onPlayNasItem={(job) => {
          setIsDownloadsOpen(false);
          setPlayerState({
            streamUrl: `/api/nas/stream/${encodeURIComponent(job.id)}`,
            title: job.title,
            episodeTitle: job.episode_title || undefined,
            imdbId: job.imdb_id,
            tmdbId: job.tmdb_id,
            season: job.season,
            episode: job.episode,
            isNasCached: true,
            provider: 'NAS Cache',
            qualityBadge: job.quality_badge || undefined,
          });
        }}
      />

      {/* Native Video Player Overlay */}
      {playerState && (
        <PlayerOverlay
          {...playerState}
          onClose={() => {
            setPlayerState(null);
            fetchContinueWatching();
          }}
          onNextEpisode={
            playerState.season !== undefined && playerState.season > 0 && playerState.episode !== undefined && playerState.episode > 0
              ? async () => {
                  const nextSeason = playerState.season!;
                  const nextEpisode = playerState.episode! + 1;
                  try {
                    const res = await fetch(
                      `/api/streams/tv/${encodeURIComponent(playerState.imdbId || '')}?season=${nextSeason}&episode=${nextEpisode}`,
                      { headers: { 'X-Profile-Id': activeProfile?.id || '' } }
                    );
                    if (res.ok) {
                      const streams: ResolvedStream[] = await res.json();
                      if (streams.length > 0) {
                        const isNativeApp = Capacitor.isNativePlatform();
                        const best = !isNativeApp
                          ? streams.find((s) => !s.badges.trueHd && !s.badges.dtsHd) || streams[0]
                          : streams[0];

                        const qParts: string[] = [];
                        if (best.badges.resolution) qParts.push(best.badges.resolution);
                        if (best.badges.dolbyVision) qParts.push('DV');
                        else if (best.badges.hdr10Plus) qParts.push('HDR10+');
                        else if (best.badges.hdr) qParts.push('HDR');
                        if (best.badges.atmos) qParts.push('Atmos');
                        const qBadge = qParts.join(' • ');

                        setPlayerState({
                          streamUrl: best.url,
                          title: playerState.title,
                          episodeTitle: `Episode ${nextEpisode}`,
                          imdbId: playerState.imdbId,
                          tmdbId: playerState.tmdbId,
                          season: nextSeason,
                          episode: nextEpisode,
                          isNasCached: best.badges.isNasCached,
                          provider: best.badges.source,
                          qualityBadge: qBadge || undefined,
                        });
                        return;
                      }
                    }
                  } catch (_) {}

                  setPlayerState(null);
                  fetchContinueWatching();
                }
              : undefined
          }
        />
      )}
    </div>
  );
};

