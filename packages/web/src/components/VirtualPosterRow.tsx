import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Zap, Play } from 'lucide-react';
import { CatalogItem } from '../types/api';
import { usePreFetcher } from '../hooks/usePreFetcher';

interface VirtualPosterRowProps {
  title: string;
  subtitle?: string;
  items: CatalogItem[];
  onSelect: (item: CatalogItem) => void;
  progressMap?: Record<string, { positionMs: number; durationMs: number }>;
}

const PosterCard: React.FC<{
  item: CatalogItem;
  onSelect: (item: CatalogItem) => void;
  progress?: { positionMs: number; durationMs: number };
}> = ({ item, onSelect, progress }) => {
  const prefetchProps = usePreFetcher({
    imdbId: item.imdbId,
    type: item.type,
  });

  const progressPercent =
    progress && progress.durationMs > 0
      ? Math.min(100, Math.round((progress.positionMs / progress.durationMs) * 100))
      : 0;

  return (
    <div
      onClick={() => onSelect(item)}
      {...prefetchProps}
      className="relative flex-none w-36 sm:w-48 h-56 sm:h-72 rounded-md overflow-hidden bg-[#181818] cursor-pointer group select-none border border-white/5 hover:border-white shadow-xl transition-all duration-300 hover:scale-105"
    >
      {/* Poster Image */}
      {item.posterUrl ? (
        <img
          src={item.posterUrl}
          alt={item.title}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center bg-[#202020]">
          <span className="text-xs font-bold text-gray-300">{item.title}</span>
        </div>
      )}

      {/* Hover Overlay with Play Button */}
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
        <div className="bg-red-600/90 text-white p-3 rounded-full shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
          <Play className="w-5 h-5 fill-white" />
        </div>
      </div>

      {/* Top Badges */}
      <div className="absolute top-2 left-2 flex flex-col gap-1 z-10">
        {item.isNasCached && (
          <span className="flex items-center gap-1 bg-amber-500 text-black px-1.5 py-0.5 rounded text-[10px] font-black uppercase shadow">
            <Zap className="w-2.5 h-2.5 fill-black" />
            NAS
          </span>
        )}
        {item.qualityBadge && (
          <span className="bg-black/70 backdrop-blur-sm text-white px-1.5 py-0.5 rounded text-[9px] font-bold border border-white/20">
            {item.qualityBadge}
          </span>
        )}
      </div>

      {/* Progress Bar for Continue Watching */}
      {progressPercent > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-gray-700">
          <div className="h-full bg-red-600 transition-all" style={{ width: `${progressPercent}%` }} />
        </div>
      )}
    </div>
  );
};

export const VirtualPosterRow: React.FC<VirtualPosterRowProps> = ({
  title,
  subtitle,
  items,
  onSelect,
  progressMap,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);

  if (items.length === 0) return null;

  return (
    <div className="my-8 px-4 sm:px-12 space-y-3">
      {/* Header */}
      <div>
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">{title}</h2>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      </div>

      {/* Row Carousel */}
      <div
        ref={parentRef}
        className="flex gap-3 sm:gap-4 overflow-x-auto overflow-y-hidden pb-4 pt-2 no-scrollbar scroll-smooth"
      >
        {items.map((item) => {
          const progress = progressMap ? progressMap[item.imdbId] : undefined;
          return (
            <PosterCard
              key={`${item.imdbId || item.id}`}
              item={item}
              onSelect={onSelect}
              progress={progress}
            />
          );
        })}
      </div>
    </div>
  );
};

