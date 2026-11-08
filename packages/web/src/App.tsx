import React, { useState, useEffect } from 'react';
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
  const [continueWatching, setContinueWatching] = useState<WatchProgress[]>([]);
  const [myListItems, setMyListItems] = useState<CatalogItem[]>([]);
  const [nasCachedItems, setNasCachedItems] = useState<CatalogItem[]>([]);
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
    fetchContinueWatching();
    fetchMyList();
    fetchNasJobs();
  }, [activeProfile, isGateOpen]);

  useEffect(() => {
    if (!activeProfile || isGateOpen) return;
    fetchTopTen();
  }, [topTenRegion, topTenProvider, topTenMediaType]);

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

  const fetchNasJobs = async () => {
    try {
      const res = await fetch('/api/nas/jobs');
      if (res.ok) {
        const jobs: NasCacheItem[] = await res.json();
        const active = jobs.filter((j) => j.status === 'downloading' || j.status === 'queued');
        setActiveDownloadsCount(active.length);

        const completed = jobs
          .filter((j) => j.status === 'completed')
          .map((j) => ({
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
          }));
        setNasCachedItems(completed);
      }
    } catch (_) {}
  };

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
        <Navbar
          onOpenSearch={() => setIsSearchOpen(true)}
          onOpenDownloads={() => setIsDownloadsOpen(true)}
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          activeDownloadsCount={activeDownloadsCount}
        />

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

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white overflow-x-hidden pb-20">
      {/* Top Navbar */}
      <Navbar
        onOpenSearch={() => setIsSearchOpen(true)}
        onOpenDownloads={() => setIsDownloadsOpen(true)}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        activeDownloadsCount={activeDownloadsCount}
      />

      {/* Main Content */}
      <main>
        {/* Hero Billboard */}
        <HeroBillboard
          item={heroItem}
          onPlay={(item) => setSelectedModalItem(item)}
          onMoreInfo={(item) => setSelectedModalItem(item)}
        />

        <div className="-mt-16 sm:-mt-24 relative z-20 space-y-6">
          {/* Continue Watching Row */}
          {continueWatchingCatalog.length > 0 && (
            <VirtualPosterRow
              title="Continue Watching"
              items={continueWatchingCatalog}
              onSelect={(item) => setSelectedModalItem(item)}
              progressMap={progressMap}
            />
          )}

          {/* Top 10 Row */}
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
            />
          )}

          {/* Verified Non-CAM New Releases */}
          {newReleases.length > 0 && (
            <VirtualPosterRow
              title="Verified New Releases (Non-CAM)"
              subtitle="Guaranteed 1080p & 4K BluRay / WEB-DL streams verified"
              items={newReleases}
              onSelect={(item) => setSelectedModalItem(item)}
            />
          )}

          {/* Cached on Local NAS */}
          {nasCachedItems.length > 0 && (
            <VirtualPosterRow
              title="⚡ Cached on Local NAS"
              subtitle="Instantly playable from your home server over Gigabit LAN"
              items={nasCachedItems}
              onSelect={(item) => setSelectedModalItem(item)}
            />
          )}

          {/* My List */}
          {myListItems.length > 0 && (
            <VirtualPosterRow
              title="My List"
              items={myListItems}
              onSelect={(item) => setSelectedModalItem(item)}
            />
          )}
        </div>
      </main>

      {/* Media Detail Modal */}
      {selectedModalItem && (
        <MediaDetailModal
          item={selectedModalItem}
          onClose={() => setSelectedModalItem(null)}
          onPlayStream={(stream: ResolvedStream, mediaTitle: string, epTitle?: string) => {
            setSelectedModalItem(null);
            setPlayerState({
              streamUrl: stream.url,
              title: mediaTitle,
              episodeTitle: epTitle,
              imdbId: selectedModalItem.imdbId,
              tmdbId: selectedModalItem.tmdbId,
              season: 0,
              episode: 0,
              isNasCached: stream.badges.isNasCached,
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
          });
        }}
      />

      {/* Native Video Player Overlay */}
      {playerState && (
        <PlayerOverlay
          {...playerState}
          onClose={() => setPlayerState(null)}
        />
      )}
    </div>
  );
};

