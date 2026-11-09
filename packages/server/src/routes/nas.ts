import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { db } from '../db';
import { aioStreams } from '../services/aiostreams';
import { nasDownloader } from '../services/nasDownloader';
import { tmdb } from '../services/tmdb';
import { getProfileById } from './profiles';

function sanitize(str: string): string {
  return str.replace(/[/\\?%*:|"<>]/g, '').trim();
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

export async function nasRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  // Queue season or series caching to NAS
  fastify.post('/api/nas/cache', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      imdbId: string;
      tmdbId: number;
      mediaType: 'movie' | 'tv';
      scope: 'movie' | 'episode' | 'remaining_season' | 'season' | 'all_seasons';
      seasonNumber?: number;
      episodeNumber?: number;
      preferredQuality?: '2160p' | '1080p';
      preferredBingeGroup?: string;
    };

    if (!body.imdbId || !body.tmdbId || !body.mediaType) {
      return reply.status(400).send({ error: 'imdbId, tmdbId, and mediaType are required' });
    }

    const profileId = (req.headers['x-profile-id'] as string) || '';
    const profile = profileId ? getProfileById(profileId) : undefined;
    const preferredQuality = body.preferredQuality || (profile?.preferred_nas_quality as '2160p' | '1080p') || '2160p';
    const configOverride = profile?.aiostreams_config_override;

    interface TargetEpisode {
      season: number;
      episode: number;
      episodeTitle: string | null;
    }

    const targetEpisodes: TargetEpisode[] = [];
    let showOrMovieTitle = '';
    let year = '';
    let posterUrl: string | null = null;
    let backdropUrl: string | null = null;

    if (body.mediaType === 'movie') {
      const details = await tmdb.enrichItem('movie', { id: body.tmdbId, imdb_id: body.imdbId });
      showOrMovieTitle = details?.title || 'Movie';
      year = details?.releaseDate ? details.releaseDate.split('-')[0] : '';
      posterUrl = details?.posterUrl || null;
      backdropUrl = details?.backdropUrl || null;
      targetEpisodes.push({ season: 0, episode: 0, episodeTitle: null });
    } else {
      const seriesDetails = await tmdb.getSeriesDetails(body.tmdbId);
      showOrMovieTitle = seriesDetails?.name || 'TV Series';
      year = seriesDetails?.first_air_date ? seriesDetails.first_air_date.split('-')[0] : '';
      posterUrl = seriesDetails?.poster_path
        ? `https://image.tmdb.org/t/p/w500${seriesDetails.poster_path}`
        : null;
      backdropUrl = seriesDetails?.backdrop_path
        ? `https://image.tmdb.org/t/p/w1280${seriesDetails.backdrop_path}`
        : null;

      const currentSeason = body.seasonNumber || 1;
      const currentEpisode = body.episodeNumber || 1;

      if (body.scope === 'episode') {
        const episodes = await tmdb.getSeasonEpisodes(body.tmdbId, currentSeason, body.imdbId);
        const ep = episodes.find((e) => e.episodeNumber === currentEpisode);
        targetEpisodes.push({
          season: currentSeason,
          episode: currentEpisode,
          episodeTitle: ep?.title || `Episode ${currentEpisode}`,
        });
      } else if (body.scope === 'season' || body.scope === 'remaining_season') {
        const episodes = await tmdb.getSeasonEpisodes(body.tmdbId, currentSeason, body.imdbId);
        for (const ep of episodes) {
          if (!ep.isAired) continue;
          if (body.scope === 'remaining_season' && ep.episodeNumber < currentEpisode) continue;
          targetEpisodes.push({
            season: currentSeason,
            episode: ep.episodeNumber,
            episodeTitle: ep.title,
          });
        }
      } else if (body.scope === 'all_seasons') {
        const validSeasons = (seriesDetails?.seasons || []).filter((s: any) => s.season_number > 0);
        for (const s of validSeasons) {
          const episodes = await tmdb.getSeasonEpisodes(body.tmdbId, s.season_number, body.imdbId);
          for (const ep of episodes) {
            if (!ep.isAired) continue;
            targetEpisodes.push({
              season: s.season_number,
              episode: ep.episodeNumber,
              episodeTitle: ep.title,
            });
          }
        }
      }
    }

    if (targetEpisodes.length === 0) {
      return reply.status(400).send({ error: 'No aired episodes found to cache' });
    }

    // Resolve first stream to lock bingeGroup and quality
    const firstEp = targetEpisodes[0];
    const firstLookupId =
      body.mediaType === 'tv'
        ? `${body.imdbId}:${firstEp.season}:${firstEp.episode}`
        : body.imdbId;

    const streams = await aioStreams.resolveStreams(body.mediaType, firstLookupId, configOverride);
    if (streams.length === 0) {
      return reply.status(404).send({ error: 'No available streams found on AIOStreams for this title' });
    }

    // Choose best stream matching preferred quality
    let lockedStream = streams.find((s) => s.badges.resolution === (preferredQuality === '2160p' ? '4K' : '1080p'));
    if (!lockedStream) {
      lockedStream = streams[0];
    }

    const lockedBingeGroup = body.preferredBingeGroup || lockedStream.bingeGroup;
    let qualityBadge = `${lockedStream.badges.resolution}`;
    if (lockedStream.badges.dolbyVision) qualityBadge += ' DV';
    else if (lockedStream.badges.hdr) qualityBadge += ' HDR';
    if (lockedStream.badges.atmos) qualityBadge += ' Atmos';
    if (lockedStream.badges.remux) qualityBadge += ' Remux';

    const cleanTitle = sanitize(showOrMovieTitle);
    const now = Date.now();
    let queuedCount = 0;

    const insertStmt = db.prepare(`
      INSERT INTO nas_cache_items (
        id, imdb_id, tmdb_id, media_type, title, episode_title, season, episode,
        poster_url, backdrop_url, source_url, source_headers_json, binge_group,
        quality_badge, file_path, file_size_bytes, downloaded_bytes, speed_bytes_per_sec,
        status, error_message, requested_by_profile_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_url = excluded.source_url,
        source_headers_json = excluded.source_headers_json,
        status = 'queued',
        error_message = NULL,
        updated_at = excluded.updated_at
    `);

    for (const ep of targetEpisodes) {
      const itemId = `${body.imdbId}:${ep.season}:${ep.episode}`;

      // Check if already completed
      const existing = nasDownloader.getJob(itemId);
      if (existing && existing.status === 'completed' && fs.existsSync(existing.file_path)) {
        continue;
      }

      let epStream = lockedStream;
      if (ep !== firstEp) {
        const epLookupId = `${body.imdbId}:${ep.season}:${ep.episode}`;
        const epStreams = await aioStreams.resolveStreams('tv', epLookupId, configOverride);
        const match = epStreams.find((s) => lockedBingeGroup && s.bingeGroup === lockedBingeGroup);
        epStream = match || epStreams[0] || lockedStream;
      }

      let targetPath = '';
      if (body.mediaType === 'movie') {
        const folder = `${cleanTitle}${year ? ` (${year})` : ''}`;
        targetPath = path.join(
          config.nasCachePath,
          'Movies',
          folder,
          `${cleanTitle}${year ? ` (${year})` : ''} [${qualityBadge}].mkv`
        );
      } else {
        const cleanEpTitle = sanitize(ep.episodeTitle || `Episode ${ep.episode}`);
        targetPath = path.join(
          config.nasCachePath,
          'TV Shows',
          cleanTitle,
          `Season ${pad2(ep.season)}`,
          `${cleanTitle} - S${pad2(ep.season)}E${pad2(ep.episode)} - ${cleanEpTitle} [${qualityBadge}].mkv`
        );
      }

      insertStmt.run(
        itemId,
        body.imdbId,
        body.tmdbId,
        body.mediaType,
        showOrMovieTitle,
        ep.episodeTitle,
        ep.season,
        ep.episode,
        posterUrl,
        backdropUrl,
        epStream.rawUrl,
        JSON.stringify(epStream.headers || {}),
        lockedBingeGroup || null,
        qualityBadge,
        targetPath,
        0,
        0,
        0,
        'queued',
        null,
        profileId || null,
        now,
        now
      );
      queuedCount++;
    }

    // Trigger queue processing
    nasDownloader.processQueue().catch(() => {});

    return reply.status(202).send({
      success: true,
      queuedCount,
      qualityBadge,
      bingeGroup: lockedBingeGroup,
    });
  });

  // Get active & completed NAS jobs
  fastify.get('/api/nas/jobs', async (_req: FastifyRequest, reply: FastifyReply) => {
    const jobs = nasDownloader.getAllJobs();
    return reply.send(jobs);
  });

  // Pause job
  fastify.post('/api/nas/jobs/:id/pause', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const success = await nasDownloader.pauseJob(id);
    return reply.send({ success });
  });

  // Resume job
  fastify.post('/api/nas/jobs/:id/resume', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const success = await nasDownloader.resumeJob(id);
    return reply.send({ success });
  });

  // Delete job & file
  fastify.delete('/api/nas/jobs/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const success = await nasDownloader.deleteJob(id);
    return reply.send({ success });
  });

  // Get NAS disk space info
  fastify.get('/api/nas/disk', async (_req: FastifyRequest, reply: FastifyReply) => {
    const space = await nasDownloader.getDiskSpace();
    return reply.send(space);
  });

  // Stream or download local NAS media file
  fastify.get('/api/nas/stream/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const query = req.query as { download?: string };
    const item = nasDownloader.getJob(id);

    if (!item || item.status !== 'completed' || !fs.existsSync(item.file_path)) {
      return reply.status(404).send({ error: 'Cached NAS file not found or not completed' });
    }

    const stat = fs.statSync(item.file_path);
    const totalSize = stat.size;
    const rawRange = req.headers.range;
    const filename = path.basename(item.file_path);
    const isDownload = Boolean(query && (query.download === '1' || query.download === 'true'));

    let start = 0;
    let end = totalSize - 1;

    if (rawRange) {
      const match = /bytes=(\d*)-(\d*)/.exec(rawRange);
      if (match) {
        if (match[1]) start = parseInt(match[1], 10);
        if (match[2]) end = parseInt(match[2], 10);
      }
    }

    if (start >= totalSize) {
      reply.status(416).headers({
        'Content-Range': `bytes */${totalSize}`,
        'Access-Control-Allow-Origin': '*',
      }).send('Requested range not satisfiable');
      return;
    }

    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    reply.raw.setHeader('Accept-Ranges', 'bytes');
    reply.raw.setHeader('Content-Type', 'video/x-matroska');
    reply.raw.setHeader('Connection', 'keep-alive');

    if (isDownload) {
      reply.raw.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    }

    if (!rawRange) {
      reply.raw.statusCode = 200;
      reply.raw.setHeader('Content-Length', totalSize.toString());
      const stream = fs.createReadStream(item.file_path, { highWaterMark: 2 * 1024 * 1024 });
      return reply.send(stream);
    }

    const chunkSize = end - start + 1;
    reply.raw.statusCode = 206;
    reply.raw.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    reply.raw.setHeader('Content-Length', chunkSize.toString());

    const stream = fs.createReadStream(item.file_path, {
      start,
      end,
      highWaterMark: 2 * 1024 * 1024,
    });

    return reply.send(stream);
  });
}

