import React from 'react';
import { CatalogItem } from '../types/api';
import { usePreFetcher } from '../hooks/usePreFetcher';
import { Zap, RefreshCw, Clock } from 'lucide-react';

interface TopTenRowProps {
  items: CatalogItem[];
  region: string;
  onRegionChange: (region: string) => void;
  provider: 'all' | 'netflix' | 'apple' | 'disney' | 'prime' | 'max';
  onProviderChange: (provider: 'all' | 'netflix' | 'apple' | 'disney' | 'prime' | 'max') => void;
  mediaType: 'movie' | 'tv';
  onMediaTypeChange: (type: 'movie' | 'tv') => void;
  onSelect: (item: CatalogItem) => void;
  nasStatusMap?: Record<string, { status: 'completed' | 'downloading' | 'queued'; percent: number }>;
}

const TopTenCard: React.FC<{
  item: CatalogItem;
  rank: number;
  onSelect: (item: CatalogItem) => void;
  nasStatus?: { status: 'completed' | 'downloading' | 'queued'; percent: number };
}> = ({ item, rank, onSelect, nasStatus }) => {
  const prefetchProps = usePreFetcher({
    imdbId: item.imdbId,
    type: item.type,
  });

  const isCompleted = nasStatus?.status === 'completed' || item.isNasCached;
  const isDownloading = nasStatus?.status === 'downloading';
  const isQueued = nasStatus?.status === 'queued';
  const percent = nasStatus?.percent || 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(item)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSelect(item);
      }}
      {...prefetchProps}
      className="relative flex-none w-44 sm:w-56 h-64 sm:h-80 cursor-pointer group select-none transition-transform duration-300 hover:scale-105 focus:outline-none focus:scale-105"
    >
      {/* Giant Metallic Rank Number */}
      <svg
        viewBox="0 0 100 140"
        className="absolute -left-6 sm:-left-8 bottom-0 h-44 sm:h-60 w-32 sm:w-40 z-0 pointer-events-none drop-shadow-[0_4px_12px_rgba(0,0,0,0.8)]"
      >
        <text
          x="50%"
          y="78%"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="130"
          fontWeight="900"
          fill="#141414"
          stroke="#555555"
          strokeWidth="6"
          strokeLinejoin="round"
        >
          {rank}
        </text>
      </svg>

      {/* Poster */}
      <div className="absolute right-0 bottom-0 w-32 sm:w-40 h-48 sm:h-60 rounded-md overflow-hidden bg-[#181818] z-10 shadow-2xl border border-white/10 group-hover:border-white group-focus:border-white group-focus:ring-2 group-focus:ring-white transition-all">
        {item.posterUrl ? (
          <img
            src={item.posterUrl}
            alt={item.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center p-2 text-center text-xs text-gray-500 font-bold">
            {item.title}
          </div>
        )}

        {/* NAS Status Badges */}
        {isCompleted && (
          <div className="absolute top-1.5 left-1.5 bg-emerald-500 text-black p-1 rounded-full shadow" title="Cached on Local NAS">
            <Zap className="w-3 h-3 fill-black" />
          </div>
        )}
        {isDownloading && (
          <div className="absolute top-1.5 left-1.5 bg-amber-500 text-black px-1.5 py-0.5 rounded-full shadow flex items-center gap-1 text-[10px] font-black animate-pulse" title={`Caching to NAS (${percent}%)`}>
            <RefreshCw className="w-2.5 h-2.5 animate-spin" />
            <span>{percent}%</span>
          </div>
        )}
        {isQueued && (
          <div className="absolute top-1.5 left-1.5 bg-blue-500 text-white p-1 rounded-full shadow" title="Queued for NAS Caching">
            <Clock className="w-3 h-3" />
          </div>
        )}
      </div>
    </div>
  );
};

export const TopTenRow: React.FC<TopTenRowProps> = ({
  items,
  region,
  onRegionChange,
  provider,
  onProviderChange,
  mediaType,
  onMediaTypeChange,
  onSelect,
  nasStatusMap,
}) => {
  return (
    <div className="my-8 px-4 sm:px-12 space-y-4">
      {/* Header with Title & Filter Pills */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <span>Top 10 in</span>
          <button
            onClick={() => onRegionChange(region === 'GLOBAL' ? 'ZA' : 'GLOBAL')}
            className="text-red-500 hover:text-red-400 underline underline-offset-4 decoration-dotted"
          >
            {region === 'GLOBAL' ? '🌍 Global' : `${region}`}
          </button>
        </h2>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Media Type Toggle */}
          <div className="flex bg-white/10 p-0.5 rounded-lg border border-white/10">
            <button
              onClick={() => onMediaTypeChange('movie')}
              className={`px-3 py-1 rounded-md font-semibold transition-colors ${
                mediaType === 'movie' ? 'bg-red-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              Movies
            </button>
            <button
              onClick={() => onMediaTypeChange('tv')}
              className={`px-3 py-1 rounded-md font-semibold transition-colors ${
                mediaType === 'tv' ? 'bg-red-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              TV Series
            </button>
          </div>

          {/* Provider Pills */}
          <div className="hidden lg:flex items-center gap-1.5 bg-white/5 p-1 rounded-lg border border-white/10">
            {[
              { id: 'all', label: 'All Services' },
              { id: 'netflix', label: 'Netflix' },
              { id: 'apple', label: 'Apple TV+' },
              { id: 'disney', label: 'Disney+' },
              { id: 'prime', label: 'Prime Video' },
              { id: 'max', label: 'Max' },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => onProviderChange(p.id as any)}
                className={`px-2.5 py-1 rounded font-medium transition-all ${
                  provider === p.id
                    ? 'bg-white/20 text-white font-bold'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Horizontal Carousel */}
      <div className="flex gap-2 sm:gap-4 overflow-x-auto overflow-y-hidden pb-4 pt-2 no-scrollbar scroll-smooth">
        {items.map((item, idx) => {
          const nasStatus = nasStatusMap
            ? nasStatusMap[item.imdbId] || (item.tmdbId ? nasStatusMap[String(item.tmdbId)] : undefined)
            : undefined;
          return (
            <TopTenCard
              key={item.imdbId || item.id}
              item={item}
              rank={idx + 1}
              onSelect={onSelect}
              nasStatus={nasStatus}
            />
          );
        })}
      </div>
    </div>
  );
};

