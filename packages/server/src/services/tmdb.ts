import { fetch as undiciFetch } from 'undici';
import { config } from '../config';
import { db } from '../db';
import { TmdbCacheRow, VerifiedReleaseRow } from '../db/schema';
import { aioStreams } from './aiostreams';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

export interface CatalogItem {
  id: number;
  imdbId: string;
  tmdbId: number;
  type: 'movie' | 'tv';
  title: string;
  overview: string;
  releaseDate?: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  clearLogoUrl: string | null;
  voteAverage: number;
  rank?: number;
  isNasCached: boolean;
  qualityBadge?: string | null;
  certification?: string;
  genres: string[];
}

export interface TvSeasonEpisode {
  episodeNumber: number;
  seasonNumber: number;
  title: string;
  overview: string;
  airDate: string;
  stillUrl: string | null;
  isAired: boolean;
  isNasCached: boolean;
}

export interface TvSeasonDetail {
  seasonNumber: number;
  name: string;
  episodes: TvSeasonEpisode[];
}

class TmdbService {
  private async fetchTmdb<T>(endpoint: string, cacheTtlSeconds: number = 3600): Promise<T | null> {
    if (!config.tmdbApiKey) {
      console.warn('TMDB_API_KEY is not configured.');
      return null;
    }

    const cacheKey = `tmdb:${endpoint}`;
    const now = Date.now();

    const cachedStmt = db.prepare('SELECT * FROM tmdb_cache WHERE cache_key = ?');
    const cachedRow = cachedStmt.get(cacheKey) as TmdbCacheRow | undefined;

    if (cachedRow && cachedRow.expires_at > now) {
      try {
        return JSON.parse(cachedRow.payload_json) as T;
      } catch (_) {}
    }

    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `${TMDB_BASE_URL}${endpoint}${separator}api_key=${config.tmdbApiKey}`;

    try {
      const response = await undiciFetch(url);
      if (!response.ok) {
        return null;
      }

      const json = (await response.json()) as T;
      const expiresAt = now + cacheTtlSeconds * 1000;

      const upsertStmt = db.prepare(`
        INSERT INTO tmdb_cache (cache_key, payload_json, expires_at)
        VALUES (?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          payload_json = excluded.payload_json,
          expires_at = excluded.expires_at
      `);
      upsertStmt.run(cacheKey, JSON.stringify(json), expiresAt);

      return json;
    } catch (err) {
      console.error(`TMDB fetch failed for ${endpoint}:`, err);
      return null;
    }
  }

  public checkIsNasCached(imdbId: string, season: number = 0, episode: number = 0): boolean {
    const stmt = db.prepare(`
      SELECT COUNT(*) as count FROM nas_cache_items
      WHERE imdb_id = ? AND season = ? AND episode = ? AND status = 'completed'
    `);
    const res = stmt.get(imdbId, season, episode) as { count: number };
    return res.count > 0;
  }

  public async getImdbId(type: 'movie' | 'tv', tmdbId: number): Promise<string> {
    const details = await this.fetchTmdb<any>(`/${type}/${tmdbId}/external_ids`, 86400 * 7);
    return details?.imdb_id || `tmdb_${tmdbId}`;
  }

  public async enrichItem(
    type: 'movie' | 'tv',
    rawItem: any,
    rank?: number
  ): Promise<CatalogItem | null> {
    const tmdbId = rawItem.id;
    const details = await this.fetchTmdb<any>(
      `/${type}/${tmdbId}?append_to_response=images,external_ids,release_dates,content_ratings`,
      86400
    );

    const imdbId = details?.external_ids?.imdb_id || rawItem.imdb_id || `tmdb_${tmdbId}`;
    const isNasCached = this.checkIsNasCached(imdbId, 0, 0);

    // Extract ClearLogo
    let clearLogoUrl: string | null = null;
    if (details?.images?.logos && details.images.logos.length > 0) {
      const enLogo = details.images.logos.find((l: any) => l.iso_639_1 === 'en' || !l.iso_639_1);
      const chosen = enLogo || details.images.logos[0];
      if (chosen && chosen.file_path) {
        clearLogoUrl = `https://image.tmdb.org/t/p/w500${chosen.file_path}`;
      }
    }

    const backdropUrl = rawItem.backdrop_path
      ? `https://image.tmdb.org/t/p/w1280${rawItem.backdrop_path}`
      : details?.backdrop_path
      ? `https://image.tmdb.org/t/p/w1280${details.backdrop_path}`
      : null;

    const posterUrl = rawItem.poster_path
      ? `https://image.tmdb.org/t/p/w500${rawItem.poster_path}`
      : details?.poster_path
      ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
      : null;

    const title = rawItem.title || rawItem.name || details?.title || details?.name || 'Untitled';
    const overview = rawItem.overview || details?.overview || '';
    const releaseDate = rawItem.release_date || rawItem.first_air_date || details?.release_date || details?.first_air_date;
    const voteAverage = rawItem.vote_average ?? details?.vote_average ?? 0;

    const genres: string[] = (details?.genres || []).map((g: any) => g.name);

    return {
      id: tmdbId,
      imdbId,
      tmdbId,
      type,
      title,
      overview,
      releaseDate,
      posterUrl,
      backdropUrl,
      clearLogoUrl,
      voteAverage,
      rank,
      isNasCached,
      genres,
    };
  }

  public async getTop10(options: {
    region?: string;
    provider?: 'all' | 'netflix' | 'apple' | 'disney' | 'prime' | 'max';
    type?: 'movie' | 'tv';
    isKids?: boolean;
  }): Promise<CatalogItem[]> {
    const region = (options.region || config.defaultCountry).toUpperCase();
    const provider = options.provider || 'all';
    const type = options.type || 'movie';
    const isKids = Boolean(options.isKids);

    const providerMap: Record<string, number> = {
      netflix: 8,
      apple: 350,
      disney: 337,
      prime: 9,
      max: 1899,
    };

    let endpoint = '';
    if (provider === 'all') {
      if (region === 'GLOBAL') {
        endpoint = `/trending/${type}/day`;
      } else {
        endpoint = `/discover/${type}?watch_region=${region}&sort_by=popularity.desc`;
      }
    } else {
      const pId = providerMap[provider];
      endpoint = `/discover/${type}?watch_region=${region === 'GLOBAL' ? 'US' : region}&with_watch_providers=${pId}&sort_by=popularity.desc`;
    }

    if (isKids) {
      const sep = endpoint.includes('?') ? '&' : '?';
      endpoint += `${sep}certification_country=US&certification.lte=PG&without_genres=27,53,80`;
    }

    const data = await this.fetchTmdb<any>(endpoint, 1800);
    const results = data?.results || [];
    const top10Raw = results.slice(0, 10);

    const enriched = await Promise.all(
      top10Raw.map((item: any, idx: number) => this.enrichItem(type, item, idx + 1))
    );

    return enriched.filter((item): item is CatalogItem => item !== null);
  }

  public async getTrending(type: 'movie' | 'tv', isKids?: boolean): Promise<CatalogItem[]> {
    let endpoint = `/trending/${type}/week`;
    if (isKids) {
      endpoint = `/discover/${type}?sort_by=popularity.desc&certification_country=US&certification.lte=PG&without_genres=27,53,80`;
    }
    const data = await this.fetchTmdb<any>(endpoint, 1800);
    const results = (data?.results || []).slice(0, 20);

    const enriched = await Promise.all(
      results.map((item: any) => this.enrichItem(type, item))
    );

    return enriched.filter((item): item is CatalogItem => item !== null);
  }

  public async getNewReleases(isKids?: boolean): Promise<CatalogItem[]> {
    const today = new Date().toISOString().split('T')[0];
    let endpoint = `/discover/movie?with_release_type=4|5&primary_release_date.lte=${today}&sort_by=primary_release_date.desc&vote_count.gte=15`;

    if (isKids) {
      endpoint += '&certification_country=US&certification.lte=PG&without_genres=27,53,80';
    }

    const data = await this.fetchTmdb<any>(endpoint, 1800);
    const candidates = (data?.results || []).slice(0, 20);

    const validItems: CatalogItem[] = [];
    const now = Date.now();
    const FOUR_HOURS = 4 * 60 * 60 * 1000;

    for (const raw of candidates) {
      const tmdbId = raw.id;
      const imdbId = await this.getImdbId('movie', tmdbId);

      // Check verified_releases in SQLite
      const stmt = db.prepare('SELECT * FROM verified_releases WHERE imdb_id = ?');
      const row = stmt.get(imdbId) as VerifiedReleaseRow | undefined;

      let hasNonCam = false;
      let bestQuality: string | null = null;

      if (row && now - row.checked_at < FOUR_HOURS) {
        hasNonCam = row.has_non_cam_stream === 1;
        bestQuality = row.best_quality_badge;
      } else {
        // Verify via AIOStreams
        const verification = await aioStreams.verifyNonCamStream(imdbId);
        hasNonCam = verification.hasNonCam;
        bestQuality = verification.bestBadge;

        const upsert = db.prepare(`
          INSERT INTO verified_releases (imdb_id, tmdb_id, has_non_cam_stream, best_quality_badge, checked_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(imdb_id) DO UPDATE SET
            has_non_cam_stream = excluded.has_non_cam_stream,
            best_quality_badge = excluded.best_quality_badge,
            checked_at = excluded.checked_at
        `);
        upsert.run(imdbId, tmdbId, hasNonCam ? 1 : 0, bestQuality, now);
      }

      if (hasNonCam) {
        const enriched = await this.enrichItem('movie', { ...raw, imdb_id: imdbId });
        if (enriched) {
          enriched.qualityBadge = bestQuality || '1080p WEB-DL';
          validItems.push(enriched);
        }
      }
    }

    return validItems;
  }

  public async searchMulti(query: string, isKids?: boolean): Promise<CatalogItem[]> {
    if (!query.trim()) return [];

    const endpoint = `/search/multi?query=${encodeURIComponent(query)}&include_adult=false`;
    const data = await this.fetchTmdb<any>(endpoint, 600);
    const rawList = data?.results || [];

    const filtered = rawList.filter((item: any) => {
      if (item.media_type !== 'movie' && item.media_type !== 'tv') return false;
      if (isKids) {
        const genres = item.genre_ids || [];
        if (genres.includes(27) || genres.includes(53) || genres.includes(80)) return false;
      }
      return true;
    });

    const enriched = await Promise.all(
      filtered.slice(0, 15).map((item: any) => this.enrichItem(item.media_type, item))
    );

    return enriched.filter((i): i is CatalogItem => i !== null);
  }

  public async getSeriesDetails(tmdbId: number): Promise<any> {
    return this.fetchTmdb<any>(`/tv/${tmdbId}?append_to_response=external_ids,images`, 86400);
  }

  public async getSeasonEpisodes(
    tmdbId: number,
    seasonNumber: number,
    imdbId: string
  ): Promise<TvSeasonEpisode[]> {
    const data = await this.fetchTmdb<any>(`/tv/${tmdbId}/season/${seasonNumber}`, 86400);
    if (!data?.episodes) return [];

    const today = new Date().toISOString().split('T')[0];

    return data.episodes.map((ep: any) => {
      const airDate = ep.air_date || '';
      const isAired = airDate ? airDate <= today : false;
      const isNasCached = this.checkIsNasCached(imdbId, seasonNumber, ep.episode_number);

      return {
        episodeNumber: ep.episode_number,
        seasonNumber,
        title: ep.name || `Episode ${ep.episode_number}`,
        overview: ep.overview || '',
        airDate,
        stillUrl: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : null,
        isAired,
        isNasCached,
      };
    });
  }
}

export const tmdb = new TmdbService();

