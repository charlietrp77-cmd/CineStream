import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { arrService } from '../services/arrService';
import { appSettings } from '../services/appSettings';
import { StreamBadges } from '../services/aiostreams';
import { bootstrapService } from '../services/bootstrapService';

export async function arrRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  // Check Radarr & Sonarr status
  fastify.get('/api/arr/status', async (req: FastifyRequest, reply: FastifyReply) => {
    const rawHost = req.headers['x-forwarded-host'] || req.headers.host || '';
    const clientHost = String(rawHost).split(':')[0].trim();
    const status = await arrService.getStatus(clientHost);
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
      auto_cache_episodes_ahead?: number | string;
    };

    if (body.radarr_url !== undefined) appSettings.set('radarr_url', body.radarr_url);
    if (body.radarr_api_key !== undefined) appSettings.set('radarr_api_key', body.radarr_api_key);
    if (body.sonarr_url !== undefined) appSettings.set('sonarr_url', body.sonarr_url);
    if (body.sonarr_api_key !== undefined) appSettings.set('sonarr_api_key', body.sonarr_api_key);
    if (body.auto_cache_episodes_ahead !== undefined) {
      appSettings.set('auto_cache_episodes_ahead', String(Math.max(0, parseInt(String(body.auto_cache_episodes_ahead), 10) || 0)));
    }

    const updated = appSettings.getAll();
    const status = await arrService.getStatus();
    return reply.send({ settings: updated, status });
  });

  // Force sync configured Newznab indexers into Radarr & Sonarr
  fastify.post('/api/arr/sync-indexers', async (_req: FastifyRequest, reply: FastifyReply) => {
    const radarrUrl = appSettings.get('radarr_url') || 'http://radarr:7878';
    const radarrKey = appSettings.get('radarr_api_key');
    const sonarrUrl = appSettings.get('sonarr_url') || 'http://sonarr:8989';
    const sonarrKey = appSettings.get('sonarr_api_key');

    const results: any = {};
    if (radarrKey) {
      results.radarr = await bootstrapService.registerNewznabIndexers('radarr', radarrUrl, radarrKey, [2000, 2030, 2040, 2045, 2060]);
    }
    if (sonarrKey) {
      results.sonarr = await bootstrapService.registerNewznabIndexers('sonarr', sonarrUrl, sonarrKey, [5000, 5020, 5030, 5040, 5045]);
    }

    return reply.send({ success: true, results });
  });

  // Push release to Radarr / Sonarr matching +-10% size
  fastify.post('/api/arr/push', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      mediaType: 'movie' | 'tv';
      tmdbId: number;
      imdbId: string;
      title: string;
      releaseTitle?: string;
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
        releaseTitle: body.releaseTitle,
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
        releaseTitle: body.releaseTitle,
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

