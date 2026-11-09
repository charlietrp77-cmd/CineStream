import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { tmdb } from '../services/tmdb';
import { getProfileById } from './profiles';

export async function catalogRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  // Top 10 endpoint
  fastify.get('/api/catalog/top10', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as {
      region?: string;
      provider?: 'all' | 'netflix' | 'apple' | 'disney' | 'prime' | 'max';
      type?: 'movie' | 'tv';
    };

    const profileId = (req.headers['x-profile-id'] as string) || '';
    const profile = profileId ? getProfileById(profileId) : undefined;
    const isKids = profile ? profile.is_kids === 1 : false;

    const items = await tmdb.getTop10({
      region: query.region,
      provider: query.provider,
      type: query.type,
      isKids,
    });

    return reply.send(items);
  });

  // Verified Non-CAM New Releases
  fastify.get('/api/catalog/new-releases', async (req: FastifyRequest, reply: FastifyReply) => {
    const profileId = (req.headers['x-profile-id'] as string) || '';
    const profile = profileId ? getProfileById(profileId) : undefined;
    const isKids = profile ? profile.is_kids === 1 : false;

    const items = await tmdb.getNewReleases(isKids);
    return reply.send(items);
  });

  // Multi-Search (Movies + TV)
  fastify.get('/api/search', async (req: FastifyRequest, reply: FastifyReply) => {
    const { q } = req.query as { q?: string };
    if (!q || !q.trim()) {
      return reply.send([]);
    }

    const profileId = (req.headers['x-profile-id'] as string) || '';
    const profile = profileId ? getProfileById(profileId) : undefined;
    const isKids = profile ? profile.is_kids === 1 : false;

    const results = await tmdb.searchMulti(q, isKids);
    return reply.send(results);
  });

  // Series Season Episodes
  fastify.get('/api/catalog/series/:id/season/:season', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id, season } = req.params as { id: string; season: string };
    const { imdbId } = req.query as { imdbId?: string };

    const tmdbId = parseInt(id, 10);
    const seasonNumber = parseInt(season, 10);

    const actualImdbId = imdbId && imdbId.startsWith('tt') ? imdbId : await tmdb.getImdbId('tv', tmdbId);
    const episodes = await tmdb.getSeasonEpisodes(tmdbId, seasonNumber, actualImdbId);

    return reply.send({
      tmdbId,
      seasonNumber,
      imdbId: actualImdbId,
      episodes,
    });
  });

  // Series details
  fastify.get('/api/catalog/series/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const tmdbId = parseInt(id, 10);
    const details = await tmdb.getSeriesDetails(tmdbId);
    if (!details) {
      return reply.status(404).send({ error: 'Series not found' });
    }
    return reply.send(details);
  });
}

