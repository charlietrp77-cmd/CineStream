import { useRef, useCallback } from 'react';
import { useProfileStore } from '../store/useProfileStore';

export function usePreFetcher(params: {
  imdbId?: string;
  type?: 'movie' | 'tv';
  season?: number;
  episode?: number;
}) {
  const { activeProfile } = useProfileStore();
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const startPrefetchTimer = useCallback(() => {
    if (!params.imdbId || !params.type) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      fetch('/api/streams/prefetch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Profile-Id': activeProfile?.id || '',
        },
        body: JSON.stringify({
          type: params.type,
          imdbId: params.imdbId,
          season: params.season || 0,
          episode: params.episode || 0,
        }),
      }).catch(() => {});
    }, 1200);
  }, [params.imdbId, params.type, params.season, params.episode, activeProfile?.id]);

  const cancelPrefetchTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return {
    onMouseEnter: startPrefetchTimer,
    onMouseLeave: cancelPrefetchTimer,
    onFocus: startPrefetchTimer,
    onBlur: cancelPrefetchTimer,
  };
}

