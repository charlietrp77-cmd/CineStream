import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { DDL_STATEMENTS } from './schema';

let dbInstance: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const dbDir = path.dirname(config.databasePath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(config.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Execute DDL
  db.exec(DDL_STATEMENTS);

  // Seed default profiles if none exist
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM profiles');
  const result = countStmt.get() as { count: number };

  if (result.count === 0) {
    const insertStmt = db.prepare(`
      INSERT INTO profiles (
        id, name, avatar_id, is_kids, max_maturity_rating, pin_hash,
        preferred_audio_lang, preferred_subtitle_lang, preferred_nas_quality,
        auto_play_next, auto_cache_season_on_watch, aiostreams_config_override, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    insertStmt.run(
      'profile_main',
      'Main',
      'crimson-nebula',
      0,
      'R',
      null,
      'eng',
      'eng',
      '2160p',
      1,
      0,
      null,
      now
    );

    insertStmt.run(
      'profile_kids',
      'Kids',
      'emerald-aurora',
      1,
      'PG',
      null,
      'eng',
      'eng',
      '1080p',
      1,
      0,
      null,
      now + 1
    );
  }

  dbInstance = db;
  return db;
}

export const db = getDatabase();

