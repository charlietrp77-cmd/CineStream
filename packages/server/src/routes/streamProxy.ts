import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { handleProxyStream } from '../services/proxy';
import { smartCacheService } from '../services/smartCacheService';
import { getProfileById } from './profiles';

export async function streamProxyRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  fastify.options('/proxy/stream', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
      .header('Access-Control-Allow-Headers', '*')
      .header('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length, Content-Type')
      .status(204)
      .send();
  });

  fastify.get('/proxy/stream', async (req: FastifyRequest, reply: FastifyReply) => {
    const {
      url: encodedUrl,
      headers: encodedHeaders,
      imdbId,
      tmdbId,
      mediaType,
      season,
      episode,
      title,
      profileId,
    } = req.query as {
      url?: string;
      headers?: string;
      imdbId?: string;
      tmdbId?: string;
      mediaType?: 'movie' | 'tv';
      season?: string;
      episode?: string;
      title?: string;
      profileId?: string;
    };

    if (!encodedUrl) {
      return reply.status(400).send({ error: 'Missing url parameter' });
    }

    let decodedUrl = '';
    try {
      decodedUrl = Buffer.from(encodedUrl, 'base64url').toString('utf-8');
      new URL(decodedUrl); // Validate valid URL
    } catch (e) {
      return reply.status(400).send({ error: 'Invalid base64url stream url' });
    }

    let customHeaders: Record<string, string> | undefined;
    if (encodedHeaders) {
      try {
        const jsonStr = Buffer.from(encodedHeaders, 'base64url').toString('utf-8');
        customHeaders = JSON.parse(jsonStr);
      } catch (_) {}
    }

    // Track real playback sessions from Stremio / VLC / external players without delaying stream start.
    // Ignore tiny metadata probes (< 64KB closed ranges).
    if (imdbId && imdbId.startsWith('tt')) {
      const rangeHeader = req.headers.range;
      let isTinyProbe = false;
      if (rangeHeader) {
        const m = /bytes=(\d+)-(\d+)/.exec(rangeHeader);
        if (m && parseInt(m[2], 10) - parseInt(m[1], 10) < 65536) {
          isTinyProbe = true;
        }
      }
      if (!isTinyProbe) {
        const resolvedProfileId = profileId || (req.headers['x-profile-id'] as string) || 'default';
        const profile = profileId ? getProfileById(profileId) : undefined;
        smartCacheService
          .recordStreamPlayback({
            profileId: resolvedProfileId,
            imdbId,
            tmdbId: tmdbId ? parseInt(tmdbId, 10) || undefined : undefined,
            mediaType: mediaType === 'tv' ? 'tv' : 'movie',
            season: season ? parseInt(season, 10) : undefined,
            episode: episode ? parseInt(episode, 10) : undefined,
            title,
            configOverride: profile?.aiostreams_config_override,
          })
          .catch(() => {});
      }
    }

    await handleProxyStream(req, reply, decodedUrl, customHeaders);
  });
}

