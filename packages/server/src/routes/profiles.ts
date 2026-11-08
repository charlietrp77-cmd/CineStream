import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { db } from '../db';
import { ProfileRow } from '../db/schema';

export const AVATAR_PRESETS = [
  { id: 'crimson-nebula', name: 'Crimson Nebula', gradient: 'from-red-600 to-rose-950' },
  { id: 'emerald-aurora', name: 'Emerald Aurora', gradient: 'from-emerald-500 to-teal-950' },
  { id: 'sapphire-depths', name: 'Sapphire Depths', gradient: 'from-blue-600 to-indigo-950' },
  { id: 'amber-flare', name: 'Amber Flare', gradient: 'from-amber-500 to-orange-950' },
  { id: 'amethyst-glow', name: 'Amethyst Glow', gradient: 'from-purple-600 to-violet-950' },
  { id: 'cyber-citrus', name: 'Cyber Citrus', gradient: 'from-lime-500 to-emerald-900' },
];

function hashPin(pin: string): string {
  return crypto.createHash('sha256').update(pin).digest('hex');
}

export function getProfileById(profileId: string): ProfileRow | undefined {
  const stmt = db.prepare('SELECT * FROM profiles WHERE id = ?');
  return stmt.get(profileId) as ProfileRow | undefined;
}

export async function profileRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  // List all profiles
  fastify.get('/api/profiles', async (_req: FastifyRequest, reply: FastifyReply) => {
    const stmt = db.prepare('SELECT * FROM profiles ORDER BY created_at ASC');
    const rows = stmt.all() as ProfileRow[];

    const sanitized = rows.map((r) => ({
      id: r.id,
      name: r.name,
      avatarId: r.avatar_id,
      isKids: r.is_kids === 1,
      maxMaturityRating: r.max_maturity_rating,
      hasPin: Boolean(r.pin_hash),
      preferredAudioLang: r.preferred_audio_lang,
      preferredSubtitleLang: r.preferred_subtitle_lang,
      preferredNasQuality: r.preferred_nas_quality,
      autoPlayNext: r.auto_play_next === 1,
      autoCacheSeasonOnWatch: r.auto_cache_season_on_watch === 1,
      aiostreamsConfigOverride: r.aiostreams_config_override,
      createdAt: r.created_at,
    }));

    return reply.send(sanitized);
  });

  // Get avatar presets
  fastify.get('/api/profiles/avatars', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send(AVATAR_PRESETS);
  });

  // Create new profile
  fastify.post('/api/profiles', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      name: string;
      avatarId?: string;
      isKids?: boolean;
      maxMaturityRating?: string;
      pin?: string;
      preferredAudioLang?: string;
      preferredSubtitleLang?: string;
      preferredNasQuality?: '2160p' | '1080p';
      autoPlayNext?: boolean;
      autoCacheSeasonOnWatch?: boolean;
      aiostreamsConfigOverride?: string;
    };

    if (!body.name || !body.name.trim()) {
      return reply.status(400).send({ error: 'Profile name is required' });
    }

    const id = `profile_${crypto.randomUUID()}`;
    const pinHash = body.pin && /^\d{4}$/.test(body.pin) ? hashPin(body.pin) : null;
    const now = Date.now();

    const insert = db.prepare(`
      INSERT INTO profiles (
        id, name, avatar_id, is_kids, max_maturity_rating, pin_hash,
        preferred_audio_lang, preferred_subtitle_lang, preferred_nas_quality,
        auto_play_next, auto_cache_season_on_watch, aiostreams_config_override, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      id,
      body.name.trim(),
      body.avatarId || 'crimson-nebula',
      body.isKids ? 1 : 0,
      body.maxMaturityRating || (body.isKids ? 'PG' : 'R'),
      pinHash,
      body.preferredAudioLang || 'eng',
      body.preferredSubtitleLang || 'eng',
      body.preferredNasQuality || (body.isKids ? '1080p' : '2160p'),
      body.autoPlayNext === false ? 0 : 1,
      body.autoCacheSeasonOnWatch ? 1 : 0,
      body.aiostreamsConfigOverride || null,
      now
    );

    const created = getProfileById(id);
    return reply.status(201).send({
      id: created!.id,
      name: created!.name,
      avatarId: created!.avatar_id,
      isKids: created!.is_kids === 1,
      maxMaturityRating: created!.max_maturity_rating,
      hasPin: Boolean(created!.pin_hash),
      preferredAudioLang: created!.preferred_audio_lang,
      preferredSubtitleLang: created!.preferred_subtitle_lang,
      preferredNasQuality: created!.preferred_nas_quality,
      autoPlayNext: created!.auto_play_next === 1,
      autoCacheSeasonOnWatch: created!.auto_cache_season_on_watch === 1,
      aiostreamsConfigOverride: created!.aiostreams_config_override,
      createdAt: created!.created_at,
    });
  });

  // Update profile
  fastify.put('/api/profiles/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const existing = getProfileById(id);
    if (!existing) {
      return reply.status(404).send({ error: 'Profile not found' });
    }

    const body = req.body as {
      name?: string;
      avatarId?: string;
      isKids?: boolean;
      maxMaturityRating?: string;
      pin?: string | null;
      preferredAudioLang?: string;
      preferredSubtitleLang?: string;
      preferredNasQuality?: '2160p' | '1080p';
      autoPlayNext?: boolean;
      autoCacheSeasonOnWatch?: boolean;
      aiostreamsConfigOverride?: string | null;
    };

    let pinHash = existing.pin_hash;
    if (body.pin !== undefined) {
      if (body.pin === null || body.pin === '') {
        pinHash = null;
      } else if (/^\d{4}$/.test(body.pin)) {
        pinHash = hashPin(body.pin);
      }
    }

    const update = db.prepare(`
      UPDATE profiles SET
        name = ?,
        avatar_id = ?,
        is_kids = ?,
        max_maturity_rating = ?,
        pin_hash = ?,
        preferred_audio_lang = ?,
        preferred_subtitle_lang = ?,
        preferred_nas_quality = ?,
        auto_play_next = ?,
        auto_cache_season_on_watch = ?,
        aiostreams_config_override = ?
      WHERE id = ?
    `);

    update.run(
      body.name !== undefined ? body.name.trim() : existing.name,
      body.avatarId !== undefined ? body.avatarId : existing.avatar_id,
      body.isKids !== undefined ? (body.isKids ? 1 : 0) : existing.is_kids,
      body.maxMaturityRating !== undefined ? body.maxMaturityRating : existing.max_maturity_rating,
      pinHash,
      body.preferredAudioLang !== undefined ? body.preferredAudioLang : existing.preferred_audio_lang,
      body.preferredSubtitleLang !== undefined ? body.preferredSubtitleLang : existing.preferred_subtitle_lang,
      body.preferredNasQuality !== undefined ? body.preferredNasQuality : existing.preferred_nas_quality,
      body.autoPlayNext !== undefined ? (body.autoPlayNext ? 1 : 0) : existing.auto_play_next,
      body.autoCacheSeasonOnWatch !== undefined ? (body.autoCacheSeasonOnWatch ? 1 : 0) : existing.auto_cache_season_on_watch,
      body.aiostreamsConfigOverride !== undefined ? body.aiostreamsConfigOverride : existing.aiostreams_config_override,
      id
    );

    const updated = getProfileById(id);
    return reply.send({
      id: updated!.id,
      name: updated!.name,
      avatarId: updated!.avatar_id,
      isKids: updated!.is_kids === 1,
      maxMaturityRating: updated!.max_maturity_rating,
      hasPin: Boolean(updated!.pin_hash),
      preferredAudioLang: updated!.preferred_audio_lang,
      preferredSubtitleLang: updated!.preferred_subtitle_lang,
      preferredNasQuality: updated!.preferred_nas_quality,
      autoPlayNext: updated!.auto_play_next === 1,
      autoCacheSeasonOnWatch: updated!.auto_cache_season_on_watch === 1,
      aiostreamsConfigOverride: updated!.aiostreams_config_override,
      createdAt: updated!.created_at,
    });
  });

  // Delete profile
  fastify.delete('/api/profiles/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const countRes = db.prepare('SELECT COUNT(*) as count FROM profiles').get() as { count: number };
    if (countRes.count <= 1) {
      return reply.status(400).send({ error: 'Cannot delete the only remaining profile' });
    }

    const del = db.prepare('DELETE FROM profiles WHERE id = ?');
    const res = del.run(id);

    if (res.changes === 0) {
      return reply.status(404).send({ error: 'Profile not found' });
    }

    return reply.send({ success: true });
  });

  // Verify PIN
  fastify.post('/api/profiles/:id/verify-pin', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { pin: string };

    const profile = getProfileById(id);
    if (!profile) {
      return reply.status(404).send({ error: 'Profile not found' });
    }

    if (!profile.pin_hash) {
      return reply.send({ valid: true });
    }

    const inputHash = hashPin(body.pin || '');
    const valid = inputHash === profile.pin_hash;
    return reply.send({ valid });
  });
}

