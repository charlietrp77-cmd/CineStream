import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db';
import { MyListRow, WatchProgressRow } from '../db/schema';
import { getProfileById } from './profiles';

export async function progressRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  // Get in-progress items for active profile ("Continue Watching")
  fastify.get('/api/progress', async (req: FastifyRequest, reply: FastifyReply) => {
    const profileId =
      (req.headers['x-profile-id'] as string) ||
      (req.query as { profile_id?: string }).profile_id ||
      '';

    if (!profileId) {
      return reply.status(400).send({ error: 'Profile ID required' });
    }

    const stmt = db.prepare(`
      SELECT * FROM watch_progress
      WHERE profile_id = ? AND is_completed = 0 AND position_ms > 0
      ORDER BY updated_at DESC
      LIMIT 20
    `);

    const rows = stmt.all(profileId) as WatchProgressRow[];
    return reply.send(rows);
  });

  // Record / update playback progress
  fastify.post('/api/progress', async (req: FastifyRequest, reply: FastifyReply) => {
    const profileId =
      (req.headers['x-profile-id'] as string) ||
      (req.body as any)?.profile_id ||
      '';

    if (!profileId) {
      return reply.status(400).send({ error: 'Profile ID required' });
    }

    const body = req.body as {
      imdb_id: string;
      tmdb_id: number;
      media_type: 'movie' | 'tv';
      season?: number;
      episode?: number;
      title: string;
      episode_title?: string;
      poster_url?: string;
      backdrop_url?: string;
      clear_logo_url?: string;
      position_ms: number;
      duration_ms: number;
      binge_group?: string;
      last_stream_url?: string;
      is_completed?: boolean;
    };

    const season = body.season || 0;
    const episode = body.episode || 0;
    const isCompleted = body.is_completed || (body.duration_ms > 0 && body.position_ms >= body.duration_ms * 0.92);
    const now = Date.now();

    const upsertStmt = db.prepare(`
      INSERT INTO watch_progress (
        profile_id, imdb_id, tmdb_id, media_type, season, episode,
        title, episode_title, poster_url, backdrop_url, clear_logo_url,
        position_ms, duration_ms, binge_group, last_stream_url,
        is_completed, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, imdb_id, season, episode) DO UPDATE SET
        title = excluded.title,
        episode_title = excluded.episode_title,
        poster_url = coalesce(excluded.poster_url, watch_progress.poster_url),
        backdrop_url = coalesce(excluded.backdrop_url, watch_progress.backdrop_url),
        clear_logo_url = coalesce(excluded.clear_logo_url, watch_progress.clear_logo_url),
        position_ms = excluded.position_ms,
        duration_ms = excluded.duration_ms,
        binge_group = coalesce(excluded.binge_group, watch_progress.binge_group),
        last_stream_url = coalesce(excluded.last_stream_url, watch_progress.last_stream_url),
        is_completed = excluded.is_completed,
        updated_at = excluded.updated_at
    `);

    upsertStmt.run(
      profileId,
      body.imdb_id,
      body.tmdb_id,
      body.media_type,
      season,
      episode,
      body.title,
      body.episode_title || null,
      body.poster_url || null,
      body.backdrop_url || null,
      body.clear_logo_url || null,
      body.position_ms,
      body.duration_ms,
      body.binge_group || null,
      body.last_stream_url || null,
      isCompleted ? 1 : 0,
      now
    );

    return reply.send({ success: true, isCompleted });
  });

  // Get My List
  fastify.get('/api/mylist', async (req: FastifyRequest, reply: FastifyReply) => {
    const profileId =
      (req.headers['x-profile-id'] as string) ||
      (req.query as { profile_id?: string }).profile_id ||
      '';

    if (!profileId) {
      return reply.status(400).send({ error: 'Profile ID required' });
    }

    const stmt = db.prepare(`
      SELECT * FROM my_list
      WHERE profile_id = ?
      ORDER BY added_at DESC
    `);

    const rows = stmt.all(profileId) as MyListRow[];
    return reply.send(rows);
  });

  // Add / Toggle My List
  fastify.post('/api/mylist', async (req: FastifyRequest, reply: FastifyReply) => {
    const profileId =
      (req.headers['x-profile-id'] as string) ||
      (req.body as any)?.profile_id ||
      '';

    if (!profileId) {
      return reply.status(400).send({ error: 'Profile ID required' });
    }

    const body = req.body as {
      imdb_id: string;
      tmdb_id: number;
      media_type: 'movie' | 'tv';
      title: string;
      poster_url?: string;
      backdrop_url?: string;
    };

    const checkStmt = db.prepare('SELECT COUNT(*) as count FROM my_list WHERE profile_id = ? AND imdb_id = ?');
    const existing = checkStmt.get(profileId, body.imdb_id) as { count: number };

    if (existing.count > 0) {
      // Toggle off: remove
      const delStmt = db.prepare('DELETE FROM my_list WHERE profile_id = ? AND imdb_id = ?');
      delStmt.run(profileId, body.imdb_id);
      return reply.send({ inList: false });
    } else {
      // Toggle on: add
      const addStmt = db.prepare(`
        INSERT INTO my_list (profile_id, imdb_id, tmdb_id, media_type, title, poster_url, backdrop_url, added_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      addStmt.run(
        profileId,
        body.imdb_id,
        body.tmdb_id,
        body.media_type,
        body.title,
        body.poster_url || null,
        body.backdrop_url || null,
        Date.now()
      );
      return reply.send({ inList: true });
    }
  });

  // Remove from My List
  fastify.delete('/api/mylist/:imdbId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { imdbId } = req.params as { imdbId: string };
    const profileId =
      (req.headers['x-profile-id'] as string) ||
      (req.query as { profile_id?: string }).profile_id ||
      '';

    if (!profileId) {
      return reply.status(400).send({ error: 'Profile ID required' });
    }

    const delStmt = db.prepare('DELETE FROM my_list WHERE profile_id = ? AND imdb_id = ?');
    delStmt.run(profileId, imdbId);
    return reply.send({ success: true, inList: false });
  });
}

