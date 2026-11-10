export interface ProfileRow {
  id: string;
  name: string;
  avatar_id: string;
  is_kids: number;
  max_maturity_rating: string | null;
  pin_hash: string | null;
  preferred_audio_lang: string | null;
  preferred_subtitle_lang: string | null;
  preferred_nas_quality: string | null;
  auto_play_next: number;
  auto_cache_season_on_watch: number;
  aiostreams_config_override: string | null;
  created_at: number;
}

export interface WatchProgressRow {
  profile_id: string;
  imdb_id: string;
  tmdb_id: number;
  media_type: 'movie' | 'tv';
  season: number;
  episode: number;
  title: string;
  episode_title: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  clear_logo_url: string | null;
  position_ms: number;
  duration_ms: number;
  binge_group: string | null;
  last_stream_url: string | null;
  is_completed: number;
  updated_at: number;
}

export interface MyListRow {
  profile_id: string;
  imdb_id: string;
  tmdb_id: number;
  media_type: 'movie' | 'tv';
  title: string;
  poster_url: string | null;
  backdrop_url: string | null;
  added_at: number;
}

export interface NasCacheItemRow {
  id: string;
  imdb_id: string;
  tmdb_id: number;
  media_type: 'movie' | 'tv';
  title: string;
  episode_title: string | null;
  season: number;
  episode: number;
  poster_url: string | null;
  backdrop_url: string | null;
  source_url: string;
  source_headers_json: string;
  binge_group: string | null;
  quality_badge: string | null;
  file_path: string;
  file_size_bytes: number;
  downloaded_bytes: number;
  speed_bytes_per_sec: number;
  status: 'queued' | 'downloading' | 'completed' | 'paused' | 'failed';
  error_message: string | null;
  requested_by_profile_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface VerifiedReleaseRow {
  imdb_id: string;
  tmdb_id: number;
  has_non_cam_stream: number;
  best_quality_badge: string | null;
  checked_at: number;
}

export interface TmdbCacheRow {
  cache_key: string;
  payload_json: string;
  expires_at: number;
}

export interface StreamCacheRow {
  id: string;
  imdb_id: string;
  season: number;
  episode: number;
  best_stream_json: string;
  all_streams_json: string;
  expires_at: number;
}

export const DDL_STATEMENTS = `
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_id TEXT NOT NULL DEFAULT 'crimson-nebula',
  is_kids INTEGER NOT NULL DEFAULT 0,
  max_maturity_rating TEXT DEFAULT 'R',
  pin_hash TEXT DEFAULT NULL,
  preferred_audio_lang TEXT DEFAULT 'eng',
  preferred_subtitle_lang TEXT DEFAULT 'eng',
  preferred_nas_quality TEXT DEFAULT '2160p',
  auto_play_next INTEGER NOT NULL DEFAULT 1,
  auto_cache_season_on_watch INTEGER NOT NULL DEFAULT 0,
  aiostreams_config_override TEXT DEFAULT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS watch_progress (
  profile_id TEXT NOT NULL,
  imdb_id TEXT NOT NULL,
  tmdb_id INTEGER NOT NULL,
  media_type TEXT NOT NULL,
  season INTEGER DEFAULT 0,
  episode INTEGER DEFAULT 0,
  title TEXT NOT NULL,
  episode_title TEXT DEFAULT NULL,
  poster_url TEXT,
  backdrop_url TEXT,
  clear_logo_url TEXT,
  position_ms INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  binge_group TEXT DEFAULT NULL,
  last_stream_url TEXT DEFAULT NULL,
  is_completed INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, imdb_id, season, episode),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS my_list (
  profile_id TEXT NOT NULL,
  imdb_id TEXT NOT NULL,
  tmdb_id INTEGER NOT NULL,
  media_type TEXT NOT NULL,
  title TEXT NOT NULL,
  poster_url TEXT,
  backdrop_url TEXT,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, imdb_id),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS nas_cache_items (
  id TEXT PRIMARY KEY,
  imdb_id TEXT NOT NULL,
  tmdb_id INTEGER NOT NULL,
  media_type TEXT NOT NULL,
  title TEXT NOT NULL,
  episode_title TEXT DEFAULT NULL,
  season INTEGER DEFAULT 0,
  episode INTEGER DEFAULT 0,
  poster_url TEXT,
  backdrop_url TEXT,
  source_url TEXT NOT NULL,
  source_headers_json TEXT DEFAULT '{}',
  binge_group TEXT DEFAULT NULL,
  quality_badge TEXT DEFAULT NULL,
  file_path TEXT NOT NULL,
  file_size_bytes INTEGER DEFAULT 0,
  downloaded_bytes INTEGER DEFAULT 0,
  speed_bytes_per_sec INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  error_message TEXT DEFAULT NULL,
  requested_by_profile_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS verified_releases (
  imdb_id TEXT PRIMARY KEY,
  tmdb_id INTEGER NOT NULL,
  has_non_cam_stream INTEGER NOT NULL DEFAULT 0,
  best_quality_badge TEXT DEFAULT NULL,
  checked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tmdb_cache (
  cache_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stream_cache (
  id TEXT PRIMARY KEY,
  imdb_id TEXT NOT NULL,
  season INTEGER NOT NULL DEFAULT 0,
  episode INTEGER NOT NULL DEFAULT 0,
  best_stream_json TEXT NOT NULL,
  all_streams_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_watch_progress_profile ON watch_progress(profile_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_my_list_profile ON my_list(profile_id, added_at DESC);
CREATE INDEX IF NOT EXISTS idx_nas_cache_status ON nas_cache_items(status);
CREATE INDEX IF NOT EXISTS idx_nas_cache_lookup ON nas_cache_items(imdb_id, season, episode);
CREATE INDEX IF NOT EXISTS idx_stream_cache_expires ON stream_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_stream_cache_lookup ON stream_cache(imdb_id, season, episode);
`;

