export interface Profile {
  id: string;
  name: string;
  avatarId: string;
  isKids: boolean;
  maxMaturityRating: string;
  hasPin: boolean;
  preferredAudioLang: string;
  preferredSubtitleLang: string;
  preferredNasQuality: '2160p' | '1080p';
  autoPlayNext: boolean;
  autoCacheSeasonOnWatch: boolean;
  aiostreamsConfigOverride: string | null;
  createdAt: number;
}

export interface AvatarPreset {
  id: string;
  name: string;
  gradient: string;
}

export interface CatalogItem {
  id: number;
  imdbId: string;
  tmdbId: number;
  type: 'movie' | 'tv';
  title: string;
  overview: string;
  releaseDate?: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  clearLogoUrl: string | null;
  voteAverage: number;
  rank?: number;
  isNasCached: boolean;
  qualityBadge?: string | null;
  genres: string[];
}

export interface TvSeasonEpisode {
  episodeNumber: number;
  seasonNumber: number;
  title: string;
  overview: string;
  airDate: string;
  stillUrl: string | null;
  isAired: boolean;
  isNasCached: boolean;
}

export interface StreamBadges {
  resolution: '4K' | '1080p' | '720p' | 'SD';
  dolbyVision: boolean;
  hdr10Plus: boolean;
  hdr: boolean;
  atmos: boolean;
  trueHd: boolean;
  dtsHd: boolean;
  remux: boolean;
  source: string;
  sizeText: string;
  isNasCached: boolean;
}

export interface ResolvedStream {
  id: string;
  name: string;
  title: string;
  url: string;
  rawUrl: string;
  headers?: Record<string, string>;
  bingeGroup?: string;
  badges: StreamBadges;
  qualityScore: number;
}

export interface WatchProgress {
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

export interface MyListItem {
  profile_id: string;
  imdb_id: string;
  tmdb_id: number;
  media_type: 'movie' | 'tv';
  title: string;
  poster_url: string | null;
  backdrop_url: string | null;
  added_at: number;
}

export interface NasCacheItem {
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

export interface DiskSpaceInfo {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
}

export interface OfflineMediaItem {
  id: string; // downloadId or imdbId:season:ep
  imdbId: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  season: number;
  episode: number;
  title: string;
  episodeTitle?: string;
  posterUrl?: string;
  backdropUrl?: string;
  posterBase64?: string;
  backdropBase64?: string;
  localFileUri: string;
  fileSizeBytes: number;
  downloadedBytes: number;
  speedBytesPerSec: number;
  status: 'downloading' | 'paused' | 'completed' | 'failed';
  error?: string;
  downloadedAt: number;
}

export interface ProviderQuota {
  provider: 'torbox' | 'premiumize' | 'easynews' | 'realdebrid' | 'alldebrid';
  name: string;
  shortName: string;
  status: 'active' | 'warning' | 'expired' | 'error';
  plan?: string;
  usedBytes?: number;
  totalBytes?: number;
  remainingBytes?: number;
  remainingGbText: string;
  percentUsed?: number;
  daysRemaining?: number;
  expiresAt?: string;
}

