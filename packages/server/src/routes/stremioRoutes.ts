import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { db } from '../db';
import { MediaLikeRow, NasCacheItemRow } from '../db/schema';
import { aioStreams } from '../services/aiostreams';
import { nasDownloader } from '../services/nasDownloader';
import { formatStreamQualityBadge } from '../services/smartCacheService';
import { getProfileById } from './profiles';

function resolveOrigin(req: FastifyRequest): string {
  const protoHeader = (req.headers['x-forwarded-proto'] as string) || '';
  const hostHeader = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string) || '';
  if (hostHeader) {
    const proto = protoHeader.split(',')[0].trim() || (config.enableCaddyDuckdns ? 'https' : req.protocol || 'http');
    return `${proto}://${hostHeader}`;
  }
  return config.publicServerUrl;
}

function buildManifest(profileId?: string) {
  const profile = profileId ? getProfileById(profileId) : undefined;
  const suffix = profile ? ` (${profile.name})` : '';
  return {
    id: profile ? `com.cinestream.addon.${profile.id}` : 'com.cinestream.addon',
    version: '1.0.0',
    name: `CineStream ⚡${suffix}`,
    description:
      'Local NAS Cache first + 8-Thread Accelerated Stream Proxy over HTTPS + Intelligent Series & Movie Caching',
    resources: ['catalog', 'stream'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [
      {
        type: 'movie',
        id: 'cinestream-nas-movies',
        name: '⚡ Local NAS Cache',
      },
      {
        type: 'movie',
        id: 'cinestream-liked-movies',
        name: '❤️ Liked & Cached Movies',
      },
      {
        type: 'series',
        id: 'cinestream-nas-series',
        name: '⚡ Local NAS Series',
      },
    ],
    behaviorHints: {
      configurable: false,
      adult: false,
    },
  };
}

function handleCatalogRequest(catalogId: string, profileId?: string) {
  if (catalogId === 'cinestream-liked-movies') {
    const rows = profileId
      ? (db
          .prepare("SELECT * FROM media_likes WHERE profile_id = ? AND media_type = 'movie' ORDER BY created_at DESC LIMIT 100")
          .all(profileId) as MediaLikeRow[])
      : (db
          .prepare("SELECT * FROM media_likes WHERE media_type = 'movie' GROUP BY imdb_id ORDER BY MAX(created_at) DESC LIMIT 100")
          .all() as MediaLikeRow[]);

    return {
      metas: rows
        .filter((r) => r.imdb_id.startsWith('tt'))
        .map((r) => ({
          id: r.imdb_id,
          type: 'movie',
          name: r.title || r.imdb_id,
          poster: r.poster_url || undefined,
          background: r.backdrop_url || undefined,
        })),
    };
  }

  const mediaType = catalogId === 'cinestream-nas-series' ? 'tv' : 'movie';
  const rows = db
    .prepare(`
      SELECT imdb_id, title, MAX(poster_url) as poster_url, MAX(backdrop_url) as backdrop_url
      FROM nas_cache_items
      WHERE status = 'completed' AND media_type = ?
      GROUP BY imdb_id
      ORDER BY MAX(updated_at) DESC
      LIMIT 100
    `)
    .all(mediaType) as { imdb_id: string; title: string; poster_url: string | null; backdrop_url: string | null }[];

  return {
    metas: rows
      .filter((r) => r.imdb_id.startsWith('tt'))
      .map((r) => ({
        id: r.imdb_id,
        type: mediaType === 'tv' ? 'series' : 'movie',
        name: r.title || r.imdb_id,
        poster: r.poster_url || undefined,
        background: r.backdrop_url || undefined,
      })),
  };
}

async function handleStreamRequest(
  req: FastifyRequest,
  type: 'movie' | 'series',
  rawId: string,
  profileId?: string
) {
  const cleanId = decodeURIComponent(rawId).replace(/\.json$/i, '');
  const parts = cleanId.split(':');
  const imdbId = parts[0];
  const isSeries = type === 'series';
  const season = isSeries ? parseInt(parts[1] || '1', 10) || 1 : 0;
  const episode = isSeries ? parseInt(parts[2] || '1', 10) || 1 : 0;

  if (!imdbId || !imdbId.startsWith('tt')) {
    return { streams: [] };
  }

  const origin = resolveOrigin(req);
  const resolvedProfileId = profileId || 'default';
  const profile = profileId ? getProfileById(profileId) : undefined;
  const stremioStreams: any[] = [];

  // 1. Check local NAS Cache FIRST for instant zero-buffering playback
  const nasItem = db
    .prepare(`
      SELECT * FROM nas_cache_items
      WHERE imdb_id = ? AND season = ? AND episode = ? AND status = 'completed'
    `)
    .get(imdbId, season, episode) as NasCacheItemRow | undefined;

  if (nasItem && fs.existsSync(nasItem.file_path)) {
    const sizeGb =
      nasItem.file_size_bytes > 0
        ? `${(nasItem.file_size_bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
        : '';
    const filename = path.basename(nasItem.file_path);

    stremioStreams.push({
      name: `⚡ CineStream NAS\n${nasItem.quality_badge || 'Local Cache'}`,
      title: `⚡ Local Gigabit NAS Storage${sizeGb ? ` • ${sizeGb}` : ''}\n${filename}`,
      url: `${origin}/api/nas/stream/${encodeURIComponent(nasItem.id)}?profileId=${encodeURIComponent(resolvedProfileId)}`,
      behaviorHints: {
        bingeGroup: nasItem.binge_group || 'cinestream-nas',
        filename,
      },
    });
  }

  // 2. Fetch AIOStreams / Debrid / Easynews streams and wrap DIRECT video streams through multi-thread proxy.
  // Raw uncached NZBs (isDirectStream === false) are intentionally excluded from Stremio streaming
  // unless TorBox or Premiumize already cached them into a direct HTTP video URL.
  const lookupId = isSeries ? `${imdbId}:${season}:${episode}` : imdbId;
  const externalStreams = await aioStreams.resolveStreams(
    isSeries ? 'series' : 'movie',
    lookupId,
    profile?.aiostreams_config_override
  );

  const directPlayableStreams = externalStreams.filter((s) => s.isDirectStream !== false);

  for (const s of directPlayableStreams) {
    const qualityTag = formatStreamQualityBadge(s);
    const trackingParams = new URLSearchParams({
      imdbId,
      mediaType: isSeries ? 'tv' : 'movie',
      profileId: resolvedProfileId,
    });
    if (isSeries) {
      trackingParams.set('season', String(season));
      trackingParams.set('episode', String(episode));
    }

    const proxiedUrl = `${origin}${s.url}&${trackingParams.toString()}`;
    const sourceLabel = s.badges.source || 'Proxy';

    stremioStreams.push({
      name: `🚀 CineStream (${sourceLabel})\n${s.badges.resolution}`,
      title: `${qualityTag}${s.badges.sizeText ? ` • 💾 ${s.badges.sizeText}` : ''}\n${s.title}`,
      url: proxiedUrl,
      behaviorHints: {
        bingeGroup: s.bingeGroup || `cinestream-${sourceLabel.toLowerCase()}`,
        filename: s.rawReleaseTitle || undefined,
      },
    });
  }

  // 3. Include a one-tap Like & Cache action at the bottom if not already cached/downloading
  const existingNas = nasDownloader.getJob(`${imdbId}:${season}:${episode}`);
  if (!existingNas || (existingNas.status !== 'completed' && existingNas.status !== 'downloading')) {
    const cacheQuery = new URLSearchParams({
      imdbId,
      mediaType: isSeries ? 'tv' : 'movie',
      profileId: resolvedProfileId,
    });
    if (isSeries) {
      cacheQuery.set('season', String(season));
      cacheQuery.set('episode', String(episode));
    }
    stremioStreams.push({
      name: isSeries ? '💾 Cache Ep to NAS\n(Best Quality)' : '❤️ Like & Cache\n(Best Quality)',
      title: isSeries
        ? 'Tap to cache best quality (Debrid / NZB) of this episode to local NAS'
        : 'Tap to like this movie & cache the best available quality (Debrid / NZB) to local NAS',
      externalUrl: `${origin}/api/likes/quick-cache?${cacheQuery.toString()}`,
    });
  }

  return { streams: stremioStreams };
}

export async function stremioRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  // Default manifest
  fastify.get('/cs-stremio/manifest.json', async (_req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    return reply.send(buildManifest());
  });

  // Profile-scoped manifest
  fastify.get('/cs-stremio/:profileId/manifest.json', async (req, reply) => {
    const { profileId } = req.params as { profileId: string };
    reply.header('Access-Control-Allow-Origin', '*');
    return reply.send(buildManifest(profileId));
  });

  // Catalogs (default & profile-scoped)
  fastify.get('/cs-stremio/catalog/:type/:catalogId', async (req, reply) => {
    const { catalogId } = req.params as { type: string; catalogId: string };
    reply.header('Access-Control-Allow-Origin', '*');
    return reply.send(handleCatalogRequest(catalogId.replace(/\.json$/i, '')));
  });

  fastify.get('/cs-stremio/:profileId/catalog/:type/:catalogId', async (req, reply) => {
    const { profileId, catalogId } = req.params as { profileId: string; type: string; catalogId: string };
    reply.header('Access-Control-Allow-Origin', '*');
    return reply.send(handleCatalogRequest(catalogId.replace(/\.json$/i, ''), profileId));
  });

  // Streams (default & profile-scoped)
  fastify.get('/cs-stremio/stream/:type/:id', async (req, reply) => {
    const { type, id } = req.params as { type: 'movie' | 'series'; id: string };
    reply.header('Access-Control-Allow-Origin', '*');
    return reply.send(await handleStreamRequest(req, type, id));
  });

  fastify.get('/cs-stremio/:profileId/stream/:type/:id', async (req, reply) => {
    const { profileId, type, id } = req.params as { profileId: string; type: 'movie' | 'series'; id: string };
    reply.header('Access-Control-Allow-Origin', '*');
    return reply.send(await handleStreamRequest(req, type, id, profileId));
  });
}
