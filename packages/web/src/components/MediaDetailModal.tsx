import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { CatalogItem, ResolvedStream, TvSeasonEpisode } from '../types/api';
import { useProfileStore } from '../store/useProfileStore';
import { offlineDownloader } from '../bridge/offlineDownloader';
import { useOfflineStore } from '../store/useOfflineStore';
import { ProviderBadge } from './ProviderBadge';

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
  const [seasons, setSeasons] = useState<number[]>([1]);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [episodes, setEpisodes] = useState<TvSeasonEpisode[]>([]);
  const [selectedEpisode, setSelectedEpisode] = useState<TvSeasonEpisode | null>(null);

  // My List State
  const [isInMyList, setIsInMyList] = useState(false);

  // Provider Filter State
  const [providerFilter, setProviderFilter] = useState<string>('all');

  // NAS Cache Dropdown
  const [isNasMenuOpen, setIsNasMenuOpen] = useState(false);
  const [nasSuccessMessage, setNasSuccessMessage] = useState<string | null>(null);

  // Load streams & initial TV details
  useEffect(() => {
    loadStreams(selectedSeason, selectedEpisode?.episodeNumber || 1);
    checkMyList();

    if (item.type === 'tv') {
      fetchSeriesInfo();
    }
  }, [item]);

  useEffect(() => {
    if (item.type === 'tv') {
      fetchSeasonEpisodes(selectedSeason);
    }
  }, [selectedSeason]);

  const fetchSeriesInfo = async () => {
    try {
      const res = await fetch(`/api/catalog/series/${item.tmdbId}`);
      if (res.ok) {
        const data = await res.json();
        const validSeasons = (data.seasons || [])
          .filter((s: any) => s.season_number > 0)
          .map((s: any) => s.season_number);
        if (validSeasons.length > 0) {
          setSeasons(validSeasons);
          setSelectedSeason(validSeasons[0]);
        }
      }
    } catch (_) {}
  };

  const fetchSeasonEpisodes = async (seasonNum: number) => {
    try {
      const res = await fetch(
        `/api/catalog/series/${item.tmdbId}/season/${seasonNum}?imdbId=${item.imdbId}`
      );
      if (res.ok) {
        const data = await res.json();
        setEpisodes(data.episodes || []);
        if (data.episodes && data.episodes.length > 0) {
          const first = data.episodes[0];
          setSelectedEpisode(first);
          loadStreams(seasonNum, first.episodeNumber);
        }
      }
    } catch (_) {}
  };

  const loadStreams = async (seasonNum: number, episodeNum: number) => {
    setLoadingStreams(true);
    try {
      let url = `/api/streams/${item.type}/${item.imdbId}`;
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
      }
    } catch (_) {}
  };

  const handleNasCache = async (scope: 'movie' | 'episode' | 'remaining_season' | 'season' | 'all_seasons') => {
    setIsNasMenuOpen(false);
    try {
      const res = await fetch('/api/nas/cache', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Profile-Id': activeProfile?.id || '',
        },
        body: JSON.stringify({
          imdbId: item.imdbId,
          tmdbId: item.tmdbId,
          mediaType: item.type,
          scope,
          seasonNumber: selectedSeason,
          episodeNumber: selectedEpisode?.episodeNumber || 1,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setNasSuccessMessage(`Queued ${data.queuedCount} item(s) for NAS caching!`);
        setTimeout(() => setNasSuccessMessage(null), 4000);
      }
    } catch (e) {
      console.error('Failed to queue NAS caching:', e);
    }
  };

  const handleDeviceDownload = async () => {
    if (streams.length === 0) return;
    const bestStream = streams[0];
    const season = item.type === 'tv' ? selectedSeason : 0;
    const episode = item.type === 'tv' ? selectedEpisode?.episodeNumber || 1 : 0;
    const downloadId = `${item.imdbId}_${season}_${episode}`;

    const downloadedItem = await offlineDownloader.startDownload({
      downloadId,
      imdbId: item.imdbId,
      tmdbId: item.tmdbId,
      mediaType: item.type,
      season,
      episode,
      title: item.title,
      episodeTitle: selectedEpisode?.title,
      posterUrl: item.posterUrl || undefined,
      backdropUrl: item.backdropUrl || undefined,
      streamUrl: bestStream.rawUrl,
      headers: bestStream.headers,
    });

    await saveItem(downloadedItem);
    setNasSuccessMessage('Started offline download to this device!');
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

  const availableProviders = Array.from(new Set(streams.map((s) => s.badges.source || 'Debrid')));
  const filteredStreams = providerFilter === 'all'
    ? streams
    : streams.filter((s) => (s.badges.source || 'Debrid') === providerFilter);

  const handlePlayBest = () => {
    const streamToPlay = filteredStreams.length > 0 ? filteredStreams[0] : streams[0];
    if (streamToPlay) {
      onPlayStream(streamToPlay, item.title, selectedEpisode?.title);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-2 sm:p-6 overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-[#181818] rounded-xl overflow-hidden shadow-2xl border border-white/10 my-auto text-white">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-30 bg-black/70 hover:bg-black p-2 rounded-full text-white/80 hover:text-white transition-all shadow-lg"
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
              {item.isNasCached ? (
                <span className="flex items-center gap-1 bg-amber-500/30 text-amber-300 border border-amber-500/50 px-2 py-0.5 rounded font-bold">
                  <Zap className="w-3.5 h-3.5 fill-amber-300" />
                  ⚡ Cached on NAS
                </span>
              ) : (
                <span className="flex items-center gap-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded font-semibold">
                  <Sparkles className="w-3.5 h-3.5" />
                  Available in 4K DV / Atmos
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
              onClick={handlePlayBest}
              disabled={loadingStreams || streams.length === 0}
              className="flex items-center gap-2 bg-white text-black hover:bg-white/90 disabled:opacity-50 px-6 py-2.5 rounded font-bold text-sm shadow transition-all"
            >
              <Play className="w-4 h-4 fill-black" />
              <span>
                {streams.length > 0
                  ? `Play Best (${(filteredStreams.length > 0 ? filteredStreams[0] : streams[0]).badges.source || 'Stream'} • ${(filteredStreams.length > 0 ? filteredStreams[0] : streams[0]).badges.resolution})`
                  : 'Play Best Stream'}
              </span>
            </button>

            {/* Cache to NAS Button & Dropdown */}
            <div className="relative">
              {item.type === 'movie' ? (
                <button
                  onClick={() => handleNasCache('movie')}
                  className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white px-5 py-2.5 rounded font-semibold text-sm transition-all"
                >
                  <Zap className="w-4 h-4 fill-white" />
                  <span>Cache to NAS</span>
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setIsNasMenuOpen(!isNasMenuOpen)}
                    className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white px-5 py-2.5 rounded font-semibold text-sm transition-all"
                  >
                    <Zap className="w-4 h-4 fill-white" />
                    <span>Cache to NAS</span>
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>

                  {isNasMenuOpen && (
                    <div className="absolute left-0 mt-2 w-56 bg-[#202020] border border-white/10 rounded-lg shadow-2xl py-1 z-30 text-xs">
                      <button
                        onClick={() => handleNasCache('episode')}
                        className="w-full text-left px-4 py-2 hover:bg-white/10"
                      >
                        Cache Current Episode
                      </button>
                      <button
                        onClick={() => handleNasCache('remaining_season')}
                        className="w-full text-left px-4 py-2 hover:bg-white/10"
                      >
                        Cache Remaining Season {selectedSeason}
                      </button>
                      <button
                        onClick={() => handleNasCache('season')}
                        className="w-full text-left px-4 py-2 hover:bg-white/10"
                      >
                        Cache Entire Season {selectedSeason}
                      </button>
                      <button
                        onClick={() => handleNasCache('all_seasons')}
                        className="w-full text-left px-4 py-2 hover:bg-white/10 font-bold text-amber-400"
                      >
                        Cache All Seasons
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Download to Device */}
            <button
              onClick={handleDeviceDownload}
              disabled={loadingStreams || streams.length === 0}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white px-4 py-2.5 rounded font-medium text-sm transition-all"
            >
              <Download className="w-4 h-4" />
              <span>Download for Trip</span>
            </button>

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
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">Episodes</h3>

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

              {/* Episodes List */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-2">
                {episodes.map((ep) => {
                  const isSelected = selectedEpisode?.episodeNumber === ep.episodeNumber;
                  return (
                    <div
                      key={ep.episodeNumber}
                      onClick={() => {
                        setSelectedEpisode(ep);
                        loadStreams(selectedSeason, ep.episodeNumber);
                      }}
                      className={`flex gap-3 p-2.5 rounded-lg border cursor-pointer transition-all ${
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
                        {ep.isNasCached && (
                          <div className="absolute top-1 left-1 bg-amber-500 text-black p-0.5 rounded shadow">
                            <Zap className="w-2.5 h-2.5 fill-black" />
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-gray-200 truncate">
                            {ep.episodeNumber}. {ep.title}
                          </span>
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
              <div className="text-xs text-gray-500 py-3">No playable streams currently available for this selection.</div>
            )}

            <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
              {filteredStreams.map((stream) => (
                <div
                  key={stream.id}
                  onClick={() => onPlayStream(stream, item.title, selectedEpisode?.title)}
                  className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
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
                    </div>
                    <div className="text-xs text-gray-300 font-medium">
                      {cleanStreamDetails(stream)}
                    </div>
                  </div>

                  {/* Badges & Play Button */}
                  <div className="flex items-center gap-3">
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
                        <span className="text-gray-400">{stream.badges.sizeText}</span>
                      )}
                    </div>

                    <button className="bg-white/10 hover:bg-white text-white hover:text-black p-2 rounded-full transition-colors">
                      <Play className="w-3.5 h-3.5 fill-current" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

