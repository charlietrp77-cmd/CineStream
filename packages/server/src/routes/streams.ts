import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import { config } from '../config';
import { db } from '../db';
import { NasCacheItemRow } from '../db/schema';
import { aioStreams, ResolvedStream } from '../services/aiostreams';
import { tmdb } from '../services/tmdb';
import { getProfileById } from './profiles';

export async function streamRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  fastify.get('/api/streams/:type/:imdbId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { type, imdbId } = req.params as { type: 'movie' | 'tv' | 'series'; imdbId: string };
    const query = req.query as { season?: string; episode?: string };

    const isTv = type === 'tv' || type === 'series';
    const seasonNumber = query.season ? parseInt(query.season, 10) : (isTv ? 1 : 0);
    const episodeNumber = query.episode ? parseInt(query.episode, 10) : (isTv ? 1 : 0);

    let actualImdbId = imdbId;
    if (!actualImdbId.startsWith('tt')) {
      const tmdbIdNum = parseInt(actualImdbId.replace(/^tmdb_/, ''), 10);
      if (!isNaN(tmdbIdNum)) {
        actualImdbId = await tmdb.getImdbId(isTv ? 'tv' : 'movie', tmdbIdNum);
      }
    }

    const profileId = (req.headers['x-profile-id'] as string) || '';
    const profile = profileId ? getProfileById(profileId) : undefined;
    const configOverride = profile?.aiostreams_config_override;

    const results: ResolvedStream[] = [];

    // 1. Check local NAS cache first
    const nasStmt = db.prepare(`
      SELECT * FROM nas_cache_items
      WHERE imdb_id = ? AND season = ? AND episode = ? AND status = 'completed'
    `);
    const nasItem = nasStmt.get(actualImdbId, seasonNumber, episodeNumber) as NasCacheItemRow | undefined;

    if (nasItem && fs.existsSync(nasItem.file_path)) {
      const is4K = Boolean(nasItem.quality_badge?.includes('4K') || nasItem.quality_badge?.includes('2160p'));
      const isDV = Boolean(nasItem.quality_badge?.includes('DV') || nasItem.quality_badge?.includes('Vision'));
      const isHDR = Boolean(nasItem.quality_badge?.includes('HDR') || isDV);
      const isAtmos = Boolean(nasItem.quality_badge?.includes('Atmos'));
      const isRemux = Boolean(nasItem.quality_badge?.includes('Remux'));

      const sizeGb = nasItem.file_size_bytes
        ? `${(nasItem.file_size_bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
        : '';

      const nasStream: ResolvedStream = {
        id: `nas_${nasItem.id}`,
        name: '⚡ Local NAS Storage',
        title: `${nasItem.title} ${nasItem.quality_badge || '4K Remux'} (Gigabit LAN Direct)`,
        url: `${config.publicServerUrl}/api/nas/stream/${encodeURIComponent(nasItem.id)}`,
        rawUrl: `${config.publicServerUrl}/api/nas/stream/${encodeURIComponent(nasItem.id)}`,
        bingeGroup: nasItem.binge_group || undefined,
        badges: {
          resolution: is4K ? '4K' : '1080p',
          dolbyVision: isDV,
          hdr10Plus: false,
          hdr: isHDR,
          atmos: isAtmos,
          trueHd: isAtmos,
          dtsHd: false,
          remux: isRemux,
          source: 'NAS Storage',
          sizeText: sizeGb,
          isNasCached: true,
        },
        qualityScore: 999999,
      };

      results.push(nasStream);
    }

    // 2. Fetch AIOStreams streams (strictly mapped to Stremio series / movie)
    const stremioType = isTv ? 'series' : 'movie';
    const streamLookupId = isTv ? `${actualImdbId}:${seasonNumber}:${episodeNumber}` : actualImdbId;
    const externalStreams = await aioStreams.resolveStreams(stremioType, streamLookupId, configOverride);

    results.push(...externalStreams);

    return reply.send(results);
  });

  fastify.post('/api/streams/prefetch', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      type: 'movie' | 'tv' | 'series';
      imdbId: string;
      season?: number;
      episode?: number;
    };

    if (!body.type || !body.imdbId) {
      return reply.status(400).send({ error: 'type and imdbId required' });
    }

    const isTv = body.type === 'tv' || body.type === 'series';
    let actualImdbId = body.imdbId;
    if (!actualImdbId.startsWith('tt')) {
      const tmdbIdNum = parseInt(actualImdbId.replace(/^tmdb_/, ''), 10);
      if (!isNaN(tmdbIdNum)) {
        actualImdbId = await tmdb.getImdbId(isTv ? 'tv' : 'movie', tmdbIdNum);
      }
    }

    const profileId = (req.headers['x-profile-id'] as string) || '';
    const profile = profileId ? getProfileById(profileId) : undefined;
    const configOverride = profile?.aiostreams_config_override;

    const stremioType = isTv ? 'series' : 'movie';
    const streamLookupId = isTv
      ? `${actualImdbId}:${body.season || 1}:${body.episode || 1}`
      : actualImdbId;

    // Fire and forget prefetch
    aioStreams.prefetchStreams(stremioType, streamLookupId, configOverride).catch(() => {});

    return reply.send({ success: true });
  });
}

