import React from 'react';
import { Play, Info, Zap, Sparkles } from 'lucide-react';
import { CatalogItem } from '../types/api';

interface HeroBillboardProps {
  item: CatalogItem | null;
  onPlay: (item: CatalogItem) => void;
  onMoreInfo: (item: CatalogItem) => void;
}

export const HeroBillboard: React.FC<HeroBillboardProps> = ({ item, onPlay, onMoreInfo }) => {
  if (!item) {
    return <div className="h-[65vh] sm:h-[80vh] w-full bg-[#141414] animate-pulse" />;
  }

  return (
    <div className="relative h-[65vh] sm:h-[82vh] w-full select-none overflow-hidden">
      {/* 4K Backdrop Image */}
      {item.backdropUrl && (
        <img
          src={item.backdropUrl}
          alt={item.title}
          className="absolute inset-0 w-full h-full object-cover object-top opacity-90 transition-opacity duration-700"
        />
      )}

      {/* Gradients */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#0a0a0a] via-[#0a0a0a]/60 to-transparent w-full sm:w-2/3 z-10" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-transparent to-transparent z-10" />

      {/* Hero Content */}
      <div className="absolute bottom-12 sm:bottom-20 left-4 sm:left-12 max-w-2xl z-20 space-y-4">
        {/* Quality Badges */}
        <div className="flex flex-wrap items-center gap-2">
          {item.isNasCached ? (
            <span className="flex items-center gap-1 bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded text-[11px] font-bold tracking-wider uppercase shadow">
              <Zap className="w-3 h-3 fill-amber-300" />
              ⚡ Cached on NAS
            </span>
          ) : (
            <span className="flex items-center gap-1 bg-red-600/20 text-red-400 border border-red-600/30 px-2 py-0.5 rounded text-[11px] font-bold tracking-wider uppercase">
              <Sparkles className="w-3 h-3" />
              4K Dolby Vision • Atmos
            </span>
          )}

          {item.voteAverage > 0 && (
            <span className="bg-white/10 text-emerald-400 px-2 py-0.5 rounded text-[11px] font-bold">
              ★ {item.voteAverage.toFixed(1)}
            </span>
          )}

          {item.releaseDate && (
            <span className="text-gray-400 text-xs font-medium">
              {item.releaseDate.split('-')[0]}
            </span>
          )}
        </div>

        {/* ClearLogo or Typography Title */}
        {item.clearLogoUrl ? (
          <img
            src={item.clearLogoUrl}
            alt={item.title}
            className="max-h-24 sm:max-h-36 max-w-md object-contain drop-shadow-[0_8px_16px_rgba(0,0,0,0.9)]"
          />
        ) : (
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight text-white drop-shadow-lg">
            {item.title}
          </h1>
        )}

        {/* Overview Synopsis */}
        <p className="text-xs sm:text-sm text-gray-300 line-clamp-3 leading-relaxed drop-shadow-md">
          {item.overview}
        </p>

        {/* Action Buttons */}
        <div className="flex items-center gap-4 pt-2">
          <button
            onClick={() => onPlay(item)}
            className="flex items-center gap-2 bg-white text-black hover:bg-white/90 active:scale-95 px-6 sm:px-8 py-2.5 sm:py-3 rounded font-bold text-sm sm:text-base shadow-xl transition-all"
          >
            <Play className="w-5 h-5 fill-black" />
            <span>Play</span>
          </button>

          <button
            onClick={() => onMoreInfo(item)}
            className="flex items-center gap-2 bg-gray-600/60 hover:bg-gray-600/80 active:scale-95 backdrop-blur-md text-white px-5 sm:px-7 py-2.5 sm:py-3 rounded font-semibold text-sm sm:text-base transition-all"
          >
            <Info className="w-5 h-5" />
            <span>More Info</span>
          </button>
        </div>
      </div>
    </div>
  );
};

