import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { db } from '../db';
import { MediaLikeRow, MediaPlayStatsRow, NasCacheItemRow } from '../db/schema';
import { aioStreams, computeQualityScore, ResolvedStream } from './aiostreams';
import { appSettings } from './appSettings';
import { arrService } from './arrService';
import { nasDownloader } from './nasDownloader';
import { tmdb } from './tmdb';

const SESSION_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours per watch session

export interface SmartCacheSettings {
  smartSeriesCacheEnabled: boolean;
  smartSeriesTriggerEpisodes: number;
  autoCacheEpisodesAhead: number;
  smartMovieCacheEnabled: boolean;
  movieRewatchThreshold: number;
  likeAutoCacheEnabled: boolean;
}

export interface PlaybackTrackParams {
  profileId: string;
  imdbId: string;
  tmdbId?: number;
  mediaType: 'movie' | 'tv';
  season?: number;
  episode?: number;
  title?: string;
  configOverride?: string | null;
}

export interface CacheQueueTargetParams {
  imdbId: string;
  tmdbId?: number;
  mediaType: 'movie' | 'tv';
  title?: string;
  year?: string;
  season?: number;
  episode?: number;
  episodeTitle?: string | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  preferredQuality?: '2160p' | '1080p';
  preferredBingeGroup?: string;
  explicitStream?: ResolvedStream;
  profileId?: string;
  configOverride?: string | null;
  reason?: string;
}

export interface CacheQueueOutcome {
  status: 'already_cached' | 'already_queued' | 'queued_nas' | 'pushed_arr' | 'no_streams' | 'failed';
  method?: 'nas_direct' | 'arr_nzb';
  qualityBadge?: string;
  source?: string;
  message?: string;
}

function sanitizeFilename(str: string): string {
  return str.replace(/[/\\?%*:|"<>]/g, '').trim();
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

export function formatStreamQualityBadge(stream: Pick<ResolvedStream, 'badges'>): string {
  let badge = `${stream.badges.resolution || '1080p'}`;
  if (stream.badges.dolbyVision) badge += ' DV';
  else if (stream.badges.hdr10Plus) badge += ' HDR10+';
  else if (stream.badges.hdr) badge += ' HDR';
  if (stream.badges.atmos) badge += ' Atmos';
  else if (stream.badges.trueHd) badge += ' TrueHD';
  if (stream.badges.remux) badge += ' Remux';
  return badge;
}

export function buildNasTargetPath(params: {
  mediaType: 'movie' | 'tv';
  title: string;
  year?: string;
  season?: number;
  episode?: number;
  episodeTitle?: string | null;
  qualityBadge: string;
}): string {
  const cleanTitle = sanitizeFilename(params.title || (params.mediaType === 'movie' ? 'Movie' : 'TV Series'));
  if (params.mediaType === 'movie') {
    const folder = `${cleanTitle}${params.year ? ` (${params.year})` : ''}`;
    return path.join(
      config.nasCachePath,
      'Movies',
      folder,
      `${folder} [${params.qualityBadge}].mkv`
    );
  }
  const s = params.season || 1;
  const e = params.episode || 1;
  const cleanEpTitle = sanitizeFilename(params.episodeTitle || `Episode ${e}`);
  return path.join(
    config.nasCachePath,
    'TV Shows',
    cleanTitle,
    `Season ${pad2(s)}`,
    `${cleanTitle} - S${pad2(s)}E${pad2(e)} - ${cleanEpTitle} [${params.qualityBadge}].mkv`
  );
}

/**
 * Selects the absolute highest-quality release available for downloading/caching,
 * evaluating both direct HTTP (Debrid/Easynews) AND raw NZB (AltHub/NZBGeek/DrunkenSlug)
 * releases by pure quality score without applying the streaming penalty.
 */
export function pickBestDownloadCandidate(
  streams: ResolvedStream[],
  options?: { preferredQuality?: '2160p' | '1080p'; preferredBingeGroup?: string }
): ResolvedStream | undefined {
  if (!streams || streams.length === 0) return undefined;

  const sorted = [...streams].sort((a, b) => {
    const scoreA = a.rawQualityScore ?? computeQualityScore(a.badges);
    const scoreB = b.rawQualityScore ?? computeQualityScore(b.badges);
    if (scoreB !== scoreA) return scoreB - scoreA;

    const sizeA = a.badges.sizeBytes || 0;
    const sizeB = b.badges.sizeBytes || 0;
    if (sizeB !== sizeA) return sizeB - sizeA;

    // Prefer direct multi-thread HTTP over NZB when exact quality & size tie
    const directA = a.isDirectStream !== false ? 1 : 0;
    const directB = b.isDirectStream !== false ? 1 : 0;
    return directB - directA;
  });

  if (options?.preferredBingeGroup) {
    const bingeMatch = sorted.find((s) => s.bingeGroup === options.preferredBingeGroup);
    if (bingeMatch) return bingeMatch;
  }

  if (options?.preferredQuality) {
    const targetRes = options.preferredQuality === '2160p' ? '4K' : '1080p';
    const resMatch = sorted.find((s) => s.badges.resolution === targetRes);
    if (resMatch) return resMatch;
  }

  return sorted[0];
}

class SmartCacheService {
  private recentSessionCache = new Map<string, number>();
  private activeSeriesEvalKeys = new Set<string>();
  private activeMovieEvalKeys = new Set<string>();

  public getSettings(): SmartCacheSettings {
    const parseBool = (val: string, fallback: boolean) =>
      val ? !/^(false|0|no)$/i.test(val.trim()) : fallback;

    const smartSeriesCacheEnabled = parseBool(
      appSettings.get('smart_series_cache_enabled', 'true'),
      true
    );
    const smartSeriesTriggerEpisodes = Math.max(
      1,
      parseInt(appSettings.get('smart_series_trigger_episodes', String(config.smartSeriesTriggerEpisodes)), 10) ||
        config.smartSeriesTriggerEpisodes
    );
    const autoCacheEpisodesAhead = Math.max(
      1,
      parseInt(
        appSettings.get('auto_cache_episodes_ahead', String(Math.max(2, config.autoCacheEpisodesAhead || 2))),
        10
      ) || 2
    );
    const smartMovieCacheEnabled = parseBool(
      appSettings.get('smart_movie_cache_enabled', 'true'),
      true
    );
    const movieRewatchThreshold = Math.max(
      1,
      parseInt(appSettings.get('movie_rewatch_threshold', String(config.autoCacheMovieRewatchCount)), 10) ||
        config.autoCacheMovieRewatchCount
    );
    const likeAutoCacheEnabled = parseBool(
      appSettings.get('like_auto_cache_enabled', 'true'),
      true
    );

    return {
      smartSeriesCacheEnabled,
      smartSeriesTriggerEpisodes,
      autoCacheEpisodesAhead,
      smartMovieCacheEnabled,
      movieRewatchThreshold,
      likeAutoCacheEnabled,
    };
  }

  public updateSettings(partial: Partial<SmartCacheSettings>): SmartCacheSettings {
    if (partial.smartSeriesCacheEnabled !== undefined) {
      appSettings.set('smart_series_cache_enabled', partial.smartSeriesCacheEnabled ? 'true' : 'false');
    }
    if (partial.smartSeriesTriggerEpisodes !== undefined) {
      appSettings.set('smart_series_trigger_episodes', String(Math.max(1, partial.smartSeriesTriggerEpisodes)));
    }
    if (partial.autoCacheEpisodesAhead !== undefined) {
      appSettings.set('auto_cache_episodes_ahead', String(Math.max(1, partial.autoCacheEpisodesAhead)));
    }
    if (partial.smartMovieCacheEnabled !== undefined) {
      appSettings.set('smart_movie_cache_enabled', partial.smartMovieCacheEnabled ? 'true' : 'false');
    }
    if (partial.movieRewatchThreshold !== undefined) {
      appSettings.set('movie_rewatch_threshold', String(Math.max(1, partial.movieRewatchThreshold)));
    }
    if (partial.likeAutoCacheEnabled !== undefined) {
      appSettings.set('like_auto_cache_enabled', partial.likeAutoCacheEnabled ? 'true' : 'false');
    }
    return this.getSettings();
  }

  public isLiked(profileId: string, imdbId: string): boolean {
    if (!imdbId) return false;
    const row = profileId
      ? (db
          .prepare('SELECT allow_cache FROM media_likes WHERE profile_id = ? AND imdb_id = ?')
          .get(profileId, imdbId) as { allow_cache: number } | undefined)
      : (db
          .prepare('SELECT allow_cache FROM media_likes WHERE imdb_id = ? LIMIT 1')
          .get(imdbId) as { allow_cache: number } | undefined);
    return Boolean(row && row.allow_cache === 1);
  }

  public getLikes(profileId?: string): MediaLikeRow[] {
    if (profileId) {
      return db
        .prepare('SELECT * FROM media_likes WHERE profile_id = ? ORDER BY created_at DESC')
        .all(profileId) as MediaLikeRow[];
    }
    return db.prepare('SELECT * FROM media_likes ORDER BY created_at DESC').all() as MediaLikeRow[];
  }

  public getPlayCount(profileId: string, imdbId: string, season = 0, episode = 0): number {
    if (!imdbId) return 0;
    const row = db
      .prepare('SELECT play_count FROM media_play_stats WHERE profile_id = ? AND imdb_id = ? AND season = ? AND episode = ?')
      .get(profileId, imdbId, season, episode) as { play_count: number } | undefined;
    if (row) return row.play_count;

    // Fallback: sum/max across profiles if viewing without profile header
    const anyRow = db
      .prepare('SELECT MAX(play_count) as cnt FROM media_play_stats WHERE imdb_id = ? AND season = ? AND episode = ?')
      .get(imdbId, season, episode) as { cnt: number | null } | undefined;
    return anyRow?.cnt || 0;
  }

  public getPlayStats(profileId?: string): MediaPlayStatsRow[] {
    if (profileId) {
      return db
        .prepare('SELECT * FROM media_play_stats WHERE profile_id = ? ORDER BY last_played_at DESC LIMIT 100')
        .all(profileId) as MediaPlayStatsRow[];
    }
    return db
      .prepare('SELECT * FROM media_play_stats ORDER BY last_played_at DESC LIMIT 100')
      .all() as MediaPlayStatsRow[];
  }

  /**
   * Queues a single movie or episode in the best available quality across Debrid,
   * Easynews (multi-threaded NAS downloader), AND raw Usenet NZB (Radarr/Sonarr -> SABnzbd).
   */
  public async queueBestToNasOrArr(params: CacheQueueTargetParams): Promise<CacheQueueOutcome> {
    const season = params.mediaType === 'tv' ? params.season || 1 : 0;
    const episode = params.mediaType === 'tv' ? params.episode || 1 : 0;
    const itemId = `${params.imdbId}:${season}:${episode}`;

    // 1. Check if already cached or queued in CineStream NAS queue
    const existing = nasDownloader.getJob(itemId);
    if (existing) {
      if (existing.status === 'completed' && fs.existsSync(existing.file_path)) {
        return {
          status: 'already_cached',
          qualityBadge: existing.quality_badge || undefined,
          message: 'Already cached on local NAS',
        };
      }
      if (existing.status === 'downloading' || existing.status === 'queued') {
        return {
          status: 'already_queued',
          qualityBadge: existing.quality_badge || undefined,
          message: `Already ${existing.status} on NAS`,
        };
      }
    }

    // Check Sonarr disk presence for TV episodes
    if (params.mediaType === 'tv' && season > 0 && episode > 0) {
      try {
        const inSonarr = await arrService.isEpisodeDownloadedInSonarr(
          params.imdbId,
          season,
          episode,
          params.tmdbId || undefined
        );
        if (inSonarr) {
          return {
            status: 'already_cached',
            message: `S${pad2(season)}E${pad2(episode)} already downloaded by Sonarr`,
          };
        }
      } catch (_) {}
    }

    // 2. Enrich metadata from TMDB when triggered by minimal identifiers (e.g. Stremio IMDb ID)
    let tmdbId = params.tmdbId || 0;
    let title = params.title || '';
    let year = params.year || '';
    let posterUrl = params.posterUrl || null;
    let backdropUrl = params.backdropUrl || null;
    let episodeTitle = params.episodeTitle ?? null;

    if (!tmdbId || !title) {
      const found = await tmdb.findByImdbId(params.imdbId, params.mediaType);
      if (found) {
        tmdbId = tmdbId || found.tmdbId;
        title = title || found.title;
        year = year || found.year;
        posterUrl = posterUrl || found.posterUrl;
        backdropUrl = backdropUrl || found.backdropUrl;
      }
    }

    if (params.mediaType === 'tv' && !episodeTitle && tmdbId > 0) {
      try {
        const eps = await tmdb.getSeasonEpisodes(tmdbId, season, params.imdbId);
        const ep = eps.find((e) => e.episodeNumber === episode);
        if (ep) episodeTitle = ep.title;
      } catch (_) {}
    }

    title = title || params.imdbId;

    // 3. Resolve all streams and pick BEST quality available (Debrid + Easynews + NZB)
    let streams: ResolvedStream[] = [];
    let bestStream = params.explicitStream;

    if (!bestStream) {
      const lookupId = params.mediaType === 'tv' ? `${params.imdbId}:${season}:${episode}` : params.imdbId;
      streams = await aioStreams.resolveStreams(
        params.mediaType === 'tv' ? 'series' : 'movie',
        lookupId,
        params.configOverride
      );
      if (streams.length === 0) {
        return { status: 'no_streams', message: 'No streams available to cache' };
      }
      bestStream = pickBestDownloadCandidate(streams, {
        preferredQuality: params.preferredQuality,
        preferredBingeGroup: params.preferredBingeGroup,
      });
    }

    if (!bestStream) {
      return { status: 'no_streams', message: 'No suitable stream candidate found' };
    }

    const qualityBadge = formatStreamQualityBadge(bestStream);
    const isDirect = bestStream.isDirectStream !== false;

    // 4. If best quality is raw NZB (not cached on TorBox/Premiumize), push to Radarr/Sonarr -> SABnzbd
    if (!isDirect && (bestStream.nzbUrl || bestStream.rawUrl)) {
      let arrResult = null;
      if (params.mediaType === 'movie') {
        arrResult = await arrService.pushRadarrMovie({
          tmdbId,
          imdbId: params.imdbId,
          movieTitle: title,
          releaseTitle: bestStream.rawReleaseTitle,
          year,
          targetSizeBytes: bestStream.badges.sizeBytes || 0,
          targetBadges: bestStream.badges,
          targetNzbUrl: bestStream.nzbUrl || bestStream.rawUrl,
        });
      } else {
        arrResult = await arrService.pushSonarrSeries({
          imdbId: params.imdbId,
          seriesTitle: title,
          releaseTitle: bestStream.rawReleaseTitle,
          seasonNumber: season,
          episodeNumber: episode,
          targetSizeBytes: bestStream.badges.sizeBytes || 0,
          targetBadges: bestStream.badges,
          targetNzbUrl: bestStream.nzbUrl || bestStream.rawUrl,
        });
      }

      if (arrResult?.success) {
        console.log(
          `📰 [SmartCache:${params.reason || 'manual'}] Queued best NZB (${qualityBadge} via ${bestStream.badges.source}) for ${title}${params.mediaType === 'tv' ? ` S${pad2(season)}E${pad2(episode)}` : ''}`
        );
        return {
          status: 'pushed_arr',
          method: 'arr_nzb',
          qualityBadge,
          source: bestStream.badges.source,
          message: arrResult.message,
        };
      }

      // If Radarr/Sonarr isn't configured or failed, fall back to best direct HTTP stream if available
      const fallbackDirect = pickBestDownloadCandidate(
        streams.filter((s) => s.isDirectStream !== false),
        {
          preferredQuality: params.preferredQuality,
          preferredBingeGroup: params.preferredBingeGroup,
        }
      );
      if (!fallbackDirect) {
        return {
          status: 'failed',
          qualityBadge,
          source: bestStream.badges.source,
          message: arrResult?.message || 'NZB download failed and no direct HTTP stream fallback available',
        };
      }
      bestStream = fallbackDirect;
    }

    // 5. Queue direct stream (TorBox/Premiumize cached NZB or Torrent, RD, AD, Easynews) into multi-thread NAS downloader
    const finalBadge = formatStreamQualityBadge(bestStream);
    const targetPath = buildNasTargetPath({
      mediaType: params.mediaType,
      title,
      year,
      season,
      episode,
      episodeTitle,
      qualityBadge: finalBadge,
    });
    const now = Date.now();

    db.prepare(`
      INSERT INTO nas_cache_items (
        id, imdb_id, tmdb_id, media_type, title, episode_title, season, episode,
        poster_url, backdrop_url, source_url, source_headers_json, binge_group,
        quality_badge, file_path, file_size_bytes, downloaded_bytes, speed_bytes_per_sec,
        status, error_message, requested_by_profile_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_url = excluded.source_url,
        source_headers_json = excluded.source_headers_json,
        quality_badge = excluded.quality_badge,
        file_path = excluded.file_path,
        status = 'queued',
        error_message = NULL,
        updated_at = excluded.updated_at
    `).run(
      itemId,
      params.imdbId,
      tmdbId,
      params.mediaType,
      title,
      episodeTitle,
      season,
      episode,
      posterUrl,
      backdropUrl,
      bestStream.rawUrl,
      JSON.stringify(bestStream.headers || {}),
      bestStream.bingeGroup || null,
      finalBadge,
      targetPath,
      bestStream.badges.sizeBytes || 0,
      0,
      0,
      'queued',
      null,
      params.profileId || null,
      now,
      now
    );

    nasDownloader.processQueue().catch(() => {});
    console.log(
      `⚡ [SmartCache:${params.reason || 'manual'}] Queued best direct stream (${finalBadge} via ${bestStream.badges.source}) -> ${path.basename(targetPath)}`
    );

    return {
      status: 'queued_nas',
      method: 'nas_direct',
      qualityBadge: finalBadge,
      source: bestStream.badges.source,
      message: `Queued ${finalBadge} (${bestStream.badges.source}) to NAS`,
    };
  }

  /**
   * Like or unlike a movie/show for local NAS caching permission & instant auto-cache.
   */
  public async setMediaLike(params: {
    profileId: string;
    imdbId: string;
    tmdbId?: number;
    mediaType: 'movie' | 'tv';
    title?: string;
    posterUrl?: string | null;
    backdropUrl?: string | null;
    liked: boolean;
    configOverride?: string | null;
  }): Promise<{ liked: boolean; cacheOutcome?: CacheQueueOutcome }> {
    const now = Date.now();
    if (!params.liked) {
      db.prepare('DELETE FROM media_likes WHERE profile_id = ? AND imdb_id = ?').run(
        params.profileId,
        params.imdbId
      );
      return { liked: false };
    }

    let tmdbId = params.tmdbId || 0;
    let title = params.title || '';
    let posterUrl = params.posterUrl || null;
    let backdropUrl = params.backdropUrl || null;

    if (!tmdbId || !title) {
      const found = await tmdb.findByImdbId(params.imdbId, params.mediaType);
      if (found) {
        tmdbId = tmdbId || found.tmdbId;
        title = title || found.title;
        posterUrl = posterUrl || found.posterUrl;
        backdropUrl = backdropUrl || found.backdropUrl;
      }
    }

    db.prepare(`
      INSERT INTO media_likes (
        profile_id, imdb_id, tmdb_id, media_type, title, poster_url, backdrop_url, allow_cache, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(profile_id, imdb_id) DO UPDATE SET
        tmdb_id = COALESCE(NULLIF(excluded.tmdb_id, 0), media_likes.tmdb_id),
        title = COALESCE(NULLIF(excluded.title, ''), media_likes.title),
        poster_url = COALESCE(excluded.poster_url, media_likes.poster_url),
        backdrop_url = COALESCE(excluded.backdrop_url, media_likes.backdrop_url),
        allow_cache = 1
    `).run(params.profileId, params.imdbId, tmdbId, params.mediaType, title || params.imdbId, posterUrl, backdropUrl, now);

    const settings = this.getSettings();
    let cacheOutcome: CacheQueueOutcome | undefined;

    if (settings.likeAutoCacheEnabled) {
      cacheOutcome = await this.queueBestToNasOrArr({
        imdbId: params.imdbId,
        tmdbId,
        mediaType: params.mediaType,
        title,
        posterUrl,
        backdropUrl,
        season: params.mediaType === 'tv' ? 1 : 0,
        episode: params.mediaType === 'tv' ? 1 : 0,
        profileId: params.profileId,
        configOverride: params.configOverride,
        reason: 'liked_movie',
      });
    }

    return { liked: true, cacheOutcome };
  }

  /**
   * Called automatically whenever Stremio / VLC / external player starts playback through
   * CineStream's /proxy/stream or /api/nas/stream endpoints.
   * Debounced per 6-hour watch session so seeking or buffering never double-counts.
   */
  public async recordStreamPlayback(params: PlaybackTrackParams): Promise<void> {
    if (!params.imdbId || !params.imdbId.startsWith('tt')) return;

    const profileId = params.profileId || 'default';
    const season = params.mediaType === 'tv' ? params.season || 1 : 0;
    const episode = params.mediaType === 'tv' ? params.episode || 1 : 0;
    const sessionKey = `${profileId}:${params.imdbId}:${season}:${episode}`;
    const now = Date.now();

    const lastMem = this.recentSessionCache.get(sessionKey);
    if (lastMem && now - lastMem < SESSION_COOLDOWN_MS) {
      return;
    }

    // Check DB cooldown as well (survives container restarts)
    const existingStat = db
      .prepare('SELECT * FROM media_play_stats WHERE profile_id = ? AND imdb_id = ? AND season = ? AND episode = ?')
      .get(profileId, params.imdbId, season, episode) as MediaPlayStatsRow | undefined;

    if (existingStat && now - existingStat.last_played_at < SESSION_COOLDOWN_MS) {
      this.recentSessionCache.set(sessionKey, existingStat.last_played_at);
      return;
    }

    this.recentSessionCache.set(sessionKey, now);
    if (this.recentSessionCache.size > 500) {
      const oldest = this.recentSessionCache.keys().next().value;
      if (oldest) this.recentSessionCache.delete(oldest);
    }

    let tmdbId = params.tmdbId || existingStat?.tmdb_id || 0;
    let title = params.title || existingStat?.title || '';
    let posterUrl: string | null = null;
    let backdropUrl: string | null = null;

    if (!tmdbId || !title) {
      const found = await tmdb.findByImdbId(params.imdbId, params.mediaType);
      if (found) {
        tmdbId = tmdbId || found.tmdbId;
        title = title || found.title;
        posterUrl = found.posterUrl;
        backdropUrl = found.backdropUrl;
      }
    }

    const nextPlayCount = (existingStat?.play_count || 0) + 1;
    db.prepare(`
      INSERT INTO media_play_stats (
        profile_id, imdb_id, tmdb_id, media_type, season, episode, title, play_count, last_played_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, imdb_id, season, episode) DO UPDATE SET
        tmdb_id = COALESCE(NULLIF(excluded.tmdb_id, 0), media_play_stats.tmdb_id),
        title = COALESCE(NULLIF(excluded.title, ''), media_play_stats.title),
        play_count = media_play_stats.play_count + 1,
        last_played_at = excluded.last_played_at
    `).run(profileId, params.imdbId, tmdbId, params.mediaType, season, episode, title || params.imdbId, 1, now, now);

    // Record watch_progress presence so Stremio plays count toward intelligent series binge tracking
    const profileExists = db.prepare('SELECT id FROM profiles WHERE id = ?').get(profileId);
    if (profileExists) {
      db.prepare(`
        INSERT INTO watch_progress (
          profile_id, imdb_id, tmdb_id, media_type, season, episode,
          title, poster_url, backdrop_url, position_ms, duration_ms, is_completed, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 200000, 0, 0, ?)
        ON CONFLICT(profile_id, imdb_id, season, episode) DO UPDATE SET
          updated_at = excluded.updated_at
      `).run(profileId, params.imdbId, tmdbId, params.mediaType, season, episode, title || params.imdbId, posterUrl, backdropUrl, now);
    }

    console.log(
      `📺 [PlaybackTracker] ${params.mediaType === 'tv' ? `${title || params.imdbId} S${pad2(season)}E${pad2(episode)}` : title || params.imdbId} (session #${nextPlayCount})`
    );

    if (params.mediaType === 'movie') {
      await this.evaluateIntelligentMovieCache({
        profileId,
        imdbId: params.imdbId,
        tmdbId,
        title,
        playCount: nextPlayCount,
        configOverride: params.configOverride,
      });
    } else if (season > 0 && episode > 0) {
      await this.evaluateIntelligentSeriesCache({
        profileId,
        imdbId: params.imdbId,
        tmdbId,
        season,
        episode,
        title: title || params.imdbId,
        configOverride: params.configOverride,
      });
    }
  }

  /**
   * Intelligent Movie Cache:
   * Automatically caches a movie in best available quality when it has been Liked
   * OR watched >= movieRewatchThreshold times (default: 2 separate sessions).
   */
  public async evaluateIntelligentMovieCache(params: {
    profileId: string;
    imdbId: string;
    tmdbId: number;
    title: string;
    playCount: number;
    configOverride?: string | null;
  }): Promise<void> {
    const dedupeKey = `${params.imdbId}`;
    if (this.activeMovieEvalKeys.has(dedupeKey)) return;
    this.activeMovieEvalKeys.add(dedupeKey);

    try {
      const settings = this.getSettings();
      const liked = this.isLiked(params.profileId, params.imdbId);
      const rewatchTriggered = settings.smartMovieCacheEnabled && params.playCount >= settings.movieRewatchThreshold;

      if (!liked && !rewatchTriggered) return;

      const reason = liked ? 'liked_movie' : `movie_rewatched_${params.playCount}x`;
      console.log(`🎬 [Smart Movie Cache] Triggered for "${params.title || params.imdbId}" (${reason}). Fetching best quality...`);
      await this.queueBestToNasOrArr({
        imdbId: params.imdbId,
        tmdbId: params.tmdbId,
        mediaType: 'movie',
        title: params.title,
        profileId: params.profileId,
        configOverride: params.configOverride,
        reason,
      });
    } finally {
      setTimeout(() => this.activeMovieEvalKeys.delete(dedupeKey), 30000);
    }
  }

  /**
   * Intelligent Series Cache:
   * Tracks distinct episodes watched across both Stremio proxy playback and web progress:
   * - < triggerEpisodes (default 3): prefetches next episode links for zero-lag playback
   * - >= triggerEpisodes: caches next `autoCacheEpisodesAhead` (default 2) episodes in best quality
   * - > 5 episodes watched: caches remaining episodes of the season sequentially
   * - Season finale: caches next season starting at E01
   */
  public async evaluateIntelligentSeriesCache(params: {
    profileId: string;
    imdbId: string;
    tmdbId: number;
    season: number;
    episode: number;
    title: string;
    configOverride?: string | null;
  }): Promise<void> {
    const { profileId, imdbId, tmdbId, season, episode, title, configOverride } = params;
    const key = `${imdbId}:${season}:${episode}`;
    if (this.activeSeriesEvalKeys.has(key)) return;
    this.activeSeriesEvalKeys.add(key);

    if (this.activeSeriesEvalKeys.size > 200) {
      const first = this.activeSeriesEvalKeys.values().next().value;
      if (first) this.activeSeriesEvalKeys.delete(first);
    }

    try {
      // Always prefetch next episode streams into 12h SQLite stream_cache
      const nextEpNum = episode + 1;
      aioStreams.prefetchStreams('series', `${imdbId}:${season}:${nextEpNum}`, configOverride).catch(() => {});

      const settings = this.getSettings();
      if (!settings.smartSeriesCacheEnabled) return;

      // Count distinct watched episodes from both watch_progress and media_play_stats
      const watchCountRow = db
        .prepare(`
          SELECT COUNT(*) as cnt FROM (
            SELECT season, episode FROM watch_progress
            WHERE profile_id = ? AND imdb_id = ? AND media_type = 'tv' AND (is_completed = 1 OR position_ms >= 180000)
            UNION
            SELECT season, episode FROM media_play_stats
            WHERE profile_id = ? AND imdb_id = ? AND media_type = 'tv' AND play_count >= 1
          )
        `)
        .get(profileId, imdbId, profileId, imdbId) as { cnt: number } | undefined;

      const watchedCount = watchCountRow?.cnt || 0;
      if (watchedCount < settings.smartSeriesTriggerEpisodes) {
        return;
      }

      let resolvedTmdbId = tmdbId;
      if (!resolvedTmdbId) {
        const found = await tmdb.findByImdbId(imdbId, 'tv');
        if (found) resolvedTmdbId = found.tmdbId;
      }

      let totalSeasonEpisodes = await arrService.getSonarrSeasonTotalEpisodes(imdbId, title, season, resolvedTmdbId);
      if (totalSeasonEpisodes === 0 && resolvedTmdbId > 0) {
        try {
          const tmdbEps = await tmdb.getSeasonEpisodes(resolvedTmdbId, season, imdbId);
          totalSeasonEpisodes = tmdbEps.length;
        } catch (_) {}
      }

      const isLastEpisodeOfSeason = totalSeasonEpisodes > 0 && episode >= totalSeasonEpisodes;

      // Helper to queue multiple episodes sequentially in best quality
      const queueEpisodesRange = async (targetSeason: number, startEp: number, maxEp: number | null, reason: string) => {
        let epCap = maxEp;
        if (epCap === null && resolvedTmdbId > 0) {
          try {
            const seasonEps = await tmdb.getSeasonEpisodes(resolvedTmdbId, targetSeason, imdbId);
            const aired = seasonEps.filter((e) => e.isAired);
            if (aired.length > 0) {
              epCap = aired[aired.length - 1].episodeNumber;
            }
          } catch (_) {}
        }
        if (epCap === null) epCap = startEp + settings.autoCacheEpisodesAhead - 1;

        for (let epNum = startEp; epNum <= epCap; epNum++) {
          await this.queueBestToNasOrArr({
            imdbId,
            tmdbId: resolvedTmdbId,
            mediaType: 'tv',
            title,
            season: targetSeason,
            episode: epNum,
            profileId,
            configOverride,
            reason,
          }).catch(() => {});
        }
      };

      // RULE 3: Season finale reached -> Cache next season
      if (isLastEpisodeOfSeason) {
        const nextSeasonNum = season + 1;
        console.log(`🎬 [Smart Series Cache] Finale reached (S${pad2(season)}E${pad2(episode)}). Queueing Season ${nextSeasonNum} in best quality!`);
        await queueEpisodesRange(nextSeasonNum, 1, null, 'smart_series_next_season');
        return;
      }

      // RULE 2: Watched > 5 episodes -> Committed viewer, cache rest of season
      if (watchedCount > 5) {
        console.log(`🔥 [Smart Series Cache] Committed (${watchedCount} eps watched). Caching rest of Season ${season} from E${pad2(episode + 1)}!`);
        await queueEpisodesRange(season, episode + 1, totalSeasonEpisodes || null, 'smart_series_full_season');
        return;
      }

      // RULE 1: Watched >= 3 episodes -> Rolling ahead cache
      const endEp =
        totalSeasonEpisodes > 0
          ? Math.min(episode + settings.autoCacheEpisodesAhead, totalSeasonEpisodes)
          : episode + settings.autoCacheEpisodesAhead;
      console.log(`🍿 [Smart Series Cache] Rolling cache (${watchedCount} eps watched). Caching up to S${pad2(season)}E${pad2(endEp)}!`);
      await queueEpisodesRange(season, episode + 1, endEp, 'smart_series_rolling');
    } finally {
      setTimeout(() => this.activeSeriesEvalKeys.delete(key), 30000);
    }
  }
}

export const smartCacheService = new SmartCacheService();
