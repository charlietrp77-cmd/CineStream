import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import fs from 'fs';
import { config } from '../config';
import { db } from '../db';
import { NasCacheItemRow } from '../db/schema';
import { smartCacheService } from '../services/smartCacheService';
import { getProfileById } from './profiles';

function getOriginFromRequest(req: FastifyRequest): string {
  const protoHeader = (req.headers['x-forwarded-proto'] as string) || '';
  const hostHeader = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string) || '';
  if (hostHeader) {
    const proto = protoHeader.split(',')[0].trim() || (config.enableCaddyDuckdns ? 'https' : req.protocol || 'http');
    return `${proto}://${hostHeader}`;
  }
  return config.publicServerUrl;
}

export async function likesRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  // List liked movies/shows & rewatch stats for active profile
  fastify.get('/api/likes', async (req: FastifyRequest, reply: FastifyReply) => {
    const profileId =
      (req.headers['x-profile-id'] as string) ||
      (req.query as { profile_id?: string }).profile_id ||
      '';

    const likes = smartCacheService.getLikes(profileId || undefined);
    const playStats = smartCacheService.getPlayStats(profileId || undefined);

    return reply.send({
      likes,
      likedIds: likes.map((l) => l.imdb_id),
      playStats,
    });
  });

  // Check status of a single title (liked, rewatch count, NAS cache status)
  fastify.get('/api/likes/:imdbId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { imdbId } = req.params as { imdbId: string };
    const profileId =
      (req.headers['x-profile-id'] as string) ||
      (req.query as { profile_id?: string }).profile_id ||
      'default';

    const liked = smartCacheService.isLiked(profileId, imdbId);
    const playCount = smartCacheService.getPlayCount(profileId, imdbId, 0, 0);
    const nasRow = db
      .prepare('SELECT status, file_path FROM nas_cache_items WHERE imdb_id = ? AND season = 0 AND episode = 0')
      .get(imdbId) as Pick<NasCacheItemRow, 'status' | 'file_path'> | undefined;

    const isNasCached = Boolean(nasRow && nasRow.status === 'completed' && fs.existsSync(nasRow.file_path));

    return reply.send({
      imdbId,
      liked,
      playCount,
      isNasCached,
      nasStatus: nasRow?.status || null,
    });
  });

  // Like / unlike a title (liking allows caching & immediately triggers best-quality download)
  fastify.post('/api/likes', async (req: FastifyRequest, reply: FastifyReply) => {
    const profileId =
      (req.headers['x-profile-id'] as string) ||
      (req.body as any)?.profileId ||
      'default';

    const body = req.body as {
      imdbId: string;
      tmdbId?: number;
      mediaType?: 'movie' | 'tv';
      title?: string;
      posterUrl?: string | null;
      backdropUrl?: string | null;
      liked: boolean;
    };

    if (!body?.imdbId) {
      return reply.status(400).send({ error: 'imdbId is required' });
    }

    const profile = profileId !== 'default' ? getProfileById(profileId) : undefined;
    const result = await smartCacheService.setMediaLike({
      profileId,
      imdbId: body.imdbId,
      tmdbId: body.tmdbId,
      mediaType: body.mediaType === 'tv' ? 'tv' : 'movie',
      title: body.title,
      posterUrl: body.posterUrl,
      backdropUrl: body.backdropUrl,
      liked: Boolean(body.liked),
      configOverride: profile?.aiostreams_config_override,
    });

    return reply.send(result);
  });

  // One-tap action endpoint opened from Stremio to Like & Cache a movie/show to local NAS
  fastify.get('/api/likes/quick-cache', async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as {
      imdbId?: string;
      mediaType?: 'movie' | 'tv';
      season?: string;
      episode?: string;
      profileId?: string;
    };

    if (!q.imdbId) {
      return reply.status(400).send({ error: 'imdbId is required' });
    }

    const profileId = q.profileId || 'default';
    const profile = profileId !== 'default' ? getProfileById(profileId) : undefined;
    const mediaType: 'movie' | 'tv' = q.mediaType === 'tv' ? 'tv' : 'movie';

    let outcome;
    if (mediaType === 'tv' && q.season && q.episode) {
      outcome = await smartCacheService.queueBestToNasOrArr({
        imdbId: q.imdbId,
        mediaType: 'tv',
        season: parseInt(q.season, 10) || 1,
        episode: parseInt(q.episode, 10) || 1,
        profileId,
        configOverride: profile?.aiostreams_config_override,
        reason: 'stremio_quick_cache',
      });
    } else {
      const res = await smartCacheService.setMediaLike({
        profileId,
        imdbId: q.imdbId,
        mediaType,
        liked: true,
        configOverride: profile?.aiostreams_config_override,
      });
      outcome = res.cacheOutcome;
    }

    const titleText =
      outcome?.status === 'already_cached'
        ? 'Already Cached on NAS'
        : outcome?.status === 'pushed_arr'
        ? `Queued Best NZB (${outcome.qualityBadge || ''})`
        : outcome?.status === 'queued_nas'
        ? `Downloading Best Quality (${outcome.qualityBadge || ''})`
        : 'Liked & Cache Triggered';

    const detailText = outcome?.message || 'CineStream is caching the highest quality release to your local NAS.';

    reply.type('text/html');
    return reply.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CineStream Smart Cache</title>
  <style>
    body { background:#111; color:#fff; font-family:system-ui,sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
    .card { background:#1b1b1b; border:1px solid rgba(255,255,255,0.12); border-radius:12px; padding:28px; max-width:460px; text-align:center; box-shadow:0 20px 50px rgba(0,0,0,.6); }
    .badge { display:inline-block; background:#e50914; color:#fff; font-weight:800; font-size:12px; padding:4px 10px; border-radius:999px; margin-bottom:12px; }
    h1 { font-size:22px; margin:0 0 10px; }
    p { color:#b3b3b3; font-size:14px; line-height:1.5; margin:0 0 20px; }
    a { display:inline-block; background:#fff; color:#000; text-decoration:none; font-weight:700; padding:10px 18px; border-radius:6px; font-size:14px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">CINESTREAM NAS CACHE</div>
    <h1>❤️ ${titleText}</h1>
    <p>${detailText}</p>
    <a href="/">Open CineStream Dashboard</a>
  </div>
</body>
</html>`);
  });

  // Read Smart Cache settings & Stremio / SSL integration info
  fastify.get('/api/smart-cache/settings', async (req: FastifyRequest, reply: FastifyReply) => {
    const profileId = (req.headers['x-profile-id'] as string) || '';
    const origin = getOriginFromRequest(req);
    const settings = smartCacheService.getSettings();

    const addonPath = profileId
      ? `/cs-stremio/${encodeURIComponent(profileId)}/manifest.json`
      : '/cs-stremio/manifest.json';
    const stremioAddonUrl = `${origin}${addonPath}`;
    const stremioInstallUrl = stremioAddonUrl.replace(/^https?:\/\//i, 'stremio://');

    const aiostreamsUiUrl = config.duckdnsSubdomain
      ? `https://${config.duckdnsSubdomain}.duckdns.org`
      : `${origin.replace(/:\d+$/, '')}:3001`;

    const likesCountRow = db.prepare('SELECT COUNT(*) as cnt FROM media_likes').get() as { cnt: number };
    const cachedCountRow = db
      .prepare("SELECT COUNT(*) as cnt FROM nas_cache_items WHERE status = 'completed'")
      .get() as { cnt: number };

    return reply.send({
      settings,
      stremioAddonUrl,
      stremioInstallUrl,
      aiostreamsUiUrl,
      sslEnabled: Boolean(config.enableCaddyDuckdns && config.duckdnsSubdomain),
      duckdnsDomain: config.duckdnsSubdomain ? `${config.duckdnsSubdomain}.duckdns.org` : null,
      stats: {
        likedCount: likesCountRow?.cnt || 0,
        cachedCount: cachedCountRow?.cnt || 0,
      },
      playStats: smartCacheService.getPlayStats(profileId || undefined),
    });
  });

  // Update Smart Cache settings
  fastify.post('/api/smart-cache/settings', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      smartSeriesCacheEnabled?: boolean;
      smartSeriesTriggerEpisodes?: number;
      autoCacheEpisodesAhead?: number;
      smartMovieCacheEnabled?: boolean;
      movieRewatchThreshold?: number;
      likeAutoCacheEnabled?: boolean;
    };

    const updated = smartCacheService.updateSettings(body || {});
    return reply.send({ success: true, settings: updated });
  });
}
