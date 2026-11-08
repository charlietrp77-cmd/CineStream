import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import { config } from '../config';
import { db } from '../db';
import { NasCacheItemRow } from '../db/schema';
import { aioStreams, ResolvedStream } from '../services/aiostreams';
import { getProfileById } from './profiles';

export async function streamRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  fastify.get('/api/streams/:type/:imdbId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { type, imdbId } = req.params as { type: 'movie' | 'tv'; imdbId: string };
    const query = req.query as { season?: string; episode?: string };

    const seasonNumber = query.season ? parseInt(query.season, 10) : 0;
    const episodeNumber = query.episode ? parseInt(query.episode, 10) : 0;

    const profileId = (req.headers['x-profile-id'] as string) || '';
    const profile = profileId ? getProfileById(profileId) : undefined;
    const configOverride = profile?.aiostreams_config_override;

    const results: ResolvedStream[] = [];

    // 1. Check local NAS cache first
    const nasStmt = db.prepare(`
      SELECT * FROM nas_cache_items
      WHERE imdb_id = ? AND season = ? AND episode = ? AND status = 'completed'
    `);
    const nasItem = nasStmt.get(imdbId, seasonNumber, episodeNumber) as NasCacheItemRow | undefined;

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

    // 2. Fetch AIOStreams streams
    const streamLookupId = type === 'tv' ? `${imdbId}:${seasonNumber}:${episodeNumber}` : imdbId;
    const externalStreams = await aioStreams.resolveStreams(type, streamLookupId, configOverride);

    results.push(...externalStreams);

    return reply.send(results);
  });

  fastify.post('/api/streams/prefetch', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      type: 'movie' | 'tv';
      imdbId: string;
      season?: number;
      episode?: number;
    };

    if (!body.type || !body.imdbId) {
      return reply.status(400).send({ error: 'type and imdbId required' });
    }

    const profileId = (req.headers['x-profile-id'] as string) || '';
    const profile = profileId ? getProfileById(profileId) : undefined;
    const configOverride = profile?.aiostreams_config_override;

    const streamLookupId =
      body.type === 'tv'
        ? `${body.imdbId}:${body.season || 1}:${body.episode || 1}`
        : body.imdbId;

    // Fire and forget prefetch
    aioStreams.prefetchStreams(body.type, streamLookupId, configOverride).catch(() => {});

    return reply.send({ success: true });
  });
}

