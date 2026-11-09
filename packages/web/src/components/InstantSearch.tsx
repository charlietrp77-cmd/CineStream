import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Zap, RefreshCw, Clock } from 'lucide-react';
import { CatalogItem } from '../types/api';
import { useProfileStore } from '../store/useProfileStore';

interface InstantSearchProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (item: CatalogItem) => void;
  nasStatusMap?: Record<string, { status: 'completed' | 'downloading' | 'queued'; percent: number }>;
}

const TV_KEYBOARD = [
  ['A', 'B', 'C', 'D', 'E', 'F'],
  ['G', 'H', 'I', 'J', 'K', 'L'],
  ['M', 'N', 'O', 'P', 'Q', 'R'],
  ['S', 'T', 'U', 'V', 'W', 'X'],
  ['Y', 'Z', '1', '2', '3', '4'],
  ['5', '6', '7', '8', '9', '0'],
  ['SPACE', 'CLEAR', 'BACKSPACE'],
];

export const InstantSearch: React.FC<InstantSearchProps> = ({ isOpen, onClose, onSelect, nasStatusMap }) => {
  const { activeProfile } = useProfileStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showTvKeyboard, setShowTvKeyboard] = useState(false);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const prefetchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery('');
      setResults([]);
    }
  }, [isOpen]);

  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);

    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          headers: { 'X-Profile-Id': activeProfile?.id || '' },
        });

        if (res.ok) {
          const data: CatalogItem[] = await res.json();
          setResults(data);

          // Speculative pre-fetch top search result after 800ms
          if (data.length > 0) {
            const top = data[0];
            prefetchTimerRef.current = setTimeout(() => {
              fetch('/api/streams/prefetch', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Profile-Id': activeProfile?.id || '',
                },
                body: JSON.stringify({
                  type: top.type,
                  imdbId: top.imdbId,
                  season: 0,
                  episode: 0,
                }),
              }).catch(() => {});
            }, 800);
          }
        }
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setLoading(false);
      }
    }, 150);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
    };
  }, [query, activeProfile?.id]);

  const handleKeyPress = (key: string) => {
    if (key === 'SPACE') {
      setQuery((prev) => prev + ' ');
    } else if (key === 'BACKSPACE') {
      setQuery((prev) => prev.slice(0, -1));
    } else if (key === 'CLEAR') {
      setQuery('');
    } else {
      setQuery((prev) => prev + key);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0a]/95 backdrop-blur-xl flex flex-col p-4 sm:p-12 overflow-y-auto select-none">
      {/* Search Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-4 max-w-6xl mx-auto w-full gap-4">
        <div className="flex items-center gap-3 flex-1">
          <Search className="w-6 h-6 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search movies, TV shows, actors..."
            className="w-full bg-transparent text-xl sm:text-2xl font-semibold text-white placeholder-gray-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowTvKeyboard(!showTvKeyboard)}
            className="hidden sm:block text-xs font-semibold px-3 py-1.5 rounded bg-white/10 text-gray-300 hover:text-white"
          >
            {showTvKeyboard ? 'Hide On-Screen Keyboard' : 'TV On-Screen Keyboard'}
          </button>

          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/10 text-gray-400 hover:text-white"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* TV D-Pad On-Screen Keyboard Grid */}
      {showTvKeyboard && (
        <div className="max-w-2xl mx-auto my-6 p-4 bg-[#141414] rounded-xl border border-white/10 shadow-2xl space-y-2">
          {TV_KEYBOARD.map((row, rIdx) => (
            <div key={rIdx} className="flex gap-2 justify-center">
              {row.map((k) => (
                <button
                  key={k}
                  onClick={() => handleKeyPress(k)}
                  className={`h-11 px-4 rounded bg-white/5 hover:bg-white/20 active:scale-95 font-bold text-sm text-white transition-all ${
                    k === 'SPACE' ? 'flex-1' : k === 'BACKSPACE' ? 'w-24 text-red-400' : 'w-11'
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Results Grid */}
      <div className="max-w-6xl mx-auto w-full mt-8 flex-1">
        {loading && <div className="text-gray-400 text-sm py-4">Searching catalog...</div>}

        {!loading && query && results.length === 0 && (
          <div className="text-gray-500 text-center py-16">
            No titles found matching "<span className="text-white">{query}</span>"
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {results.map((item) => (
            <div
              key={item.imdbId || item.id}
              onClick={() => {
                onSelect(item);
                onClose();
              }}
              className="group cursor-pointer space-y-1.5 transition-transform duration-200 hover:scale-105"
            >
              <div className="relative aspect-[2/3] rounded-md overflow-hidden bg-[#181818] border border-white/10 group-hover:border-white shadow-lg">
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
                {(() => {
                  const nasStatus = nasStatusMap
                    ? nasStatusMap[item.imdbId] || (item.tmdbId ? nasStatusMap[String(item.tmdbId)] : undefined)
                    : undefined;
                  const isCompleted = nasStatus?.status === 'completed' || item.isNasCached;
                  const isDownloading = nasStatus?.status === 'downloading';
                  const isQueued = nasStatus?.status === 'queued';
                  const pct = nasStatus?.percent || 0;

                  if (isCompleted) {
                    return (
                      <div className="absolute top-1.5 left-1.5 bg-emerald-500 text-black p-1 rounded-full shadow" title="Cached on Local NAS">
                        <Zap className="w-3 h-3 fill-black" />
                      </div>
                    );
                  }
                  if (isDownloading) {
                    return (
                      <div className="absolute top-1.5 left-1.5 bg-amber-500 text-black px-1.5 py-0.5 rounded-full shadow flex items-center gap-1 text-[9px] font-black animate-pulse" title={`Caching to NAS (${pct}%)`}>
                        <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                        <span>{pct}%</span>
                      </div>
                    );
                  }
                  if (isQueued) {
                    return (
                      <div className="absolute top-1.5 left-1.5 bg-blue-500 text-white p-1 rounded-full shadow" title="Queued for NAS Caching">
                        <Clock className="w-3 h-3" />
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>

              <div className="text-xs font-semibold text-gray-200 truncate group-hover:text-white">
                {item.title}
              </div>
              <div className="text-[10px] text-gray-400 flex items-center justify-between">
                <span>{item.type === 'tv' ? 'TV Series' : 'Movie'}</span>
                {item.releaseDate && <span>{item.releaseDate.split('-')[0]}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

