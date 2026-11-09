import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { arrService } from '../services/arrService';
import { appSettings } from '../services/appSettings';
import { StreamBadges } from '../services/aiostreams';

export async function arrRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  // Check Radarr & Sonarr status
  fastify.get('/api/arr/status', async (_req: FastifyRequest, reply: FastifyReply) => {
    const status = await arrService.getStatus();
    return reply.send(status);
  });

  // Get current Arr settings
  fastify.get('/api/arr/settings', async (_req: FastifyRequest, reply: FastifyReply) => {
    const settings = appSettings.getAll();
    return reply.send(settings);
  });

  // Update Arr settings
  fastify.post('/api/arr/settings', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      radarr_url?: string;
      radarr_api_key?: string;
      sonarr_url?: string;
      sonarr_api_key?: string;
    };

    if (body.radarr_url !== undefined) appSettings.set('radarr_url', body.radarr_url);
    if (body.radarr_api_key !== undefined) appSettings.set('radarr_api_key', body.radarr_api_key);
    if (body.sonarr_url !== undefined) appSettings.set('sonarr_url', body.sonarr_url);
    if (body.sonarr_api_key !== undefined) appSettings.set('sonarr_api_key', body.sonarr_api_key);

    const updated = appSettings.getAll();
    const status = await arrService.getStatus();
    return reply.send({ settings: updated, status });
  });

  // Push release to Radarr / Sonarr matching +-10% size
  fastify.post('/api/arr/push', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      mediaType: 'movie' | 'tv';
      tmdbId: number;
      imdbId: string;
      title: string;
      year?: string;
      seasonNumber?: number;
      episodeNumber?: number;
      targetSizeBytes: number;
      targetBadges?: Partial<StreamBadges>;
      targetMagnetUrl?: string;
      targetNzbUrl?: string;
      selectedGuid?: string;
      selectedIndexerId?: number;
    };

    if (!body.mediaType || !body.imdbId) {
      return reply.status(400).send({ error: 'mediaType and imdbId are required' });
    }

    if (body.mediaType === 'movie') {
      const result = await arrService.pushRadarrMovie({
        tmdbId: body.tmdbId,
        imdbId: body.imdbId,
        movieTitle: body.title,
        year: body.year,
        targetSizeBytes: body.targetSizeBytes || 0,
        targetBadges: body.targetBadges,
        targetMagnetUrl: body.targetMagnetUrl,
        targetNzbUrl: body.targetNzbUrl,
        selectedGuid: body.selectedGuid,
        selectedIndexerId: body.selectedIndexerId,
      });
      return reply.send(result);
    } else {
      const result = await arrService.pushSonarrSeries({
        imdbId: body.imdbId,
        seriesTitle: body.title,
        seasonNumber: body.seasonNumber || 1,
        episodeNumber: body.episodeNumber,
        targetSizeBytes: body.targetSizeBytes || 0,
        targetBadges: body.targetBadges,
        targetMagnetUrl: body.targetMagnetUrl,
        targetNzbUrl: body.targetNzbUrl,
        selectedGuid: body.selectedGuid,
      });
      return reply.send(result);
    }
  });
}

