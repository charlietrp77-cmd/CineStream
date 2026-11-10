import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load .env and stack.env from project root or current working dir if available
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), 'stack.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../stack.env') });

export interface AppConfig {
  nodeEnv: string;
  port: number;
  databasePath: string;
  nasCachePath: string;
  nasMaxConcurrentDownloads: number;
  nasThreadsPerDownload: number;
  publicServerUrl: string;
  aiostreamsInternalUrl: string;
  aiostreamsUserConfig: string;
  aiostreamsSecretKey: string;
  tmdbApiKey: string;
  defaultCountry: string;
  proxyConnections: number;
  proxyChunkSizeMb: number;
  proxyReadaheadMb: number;
  torboxApiKey: string;
  premiumizeApiKey: string;
  easynewsUsername: string;
  easynewsPassword: string;
  althubApiKey: string;
  realdebridApiKey: string;
  alldebridApiKey: string;
  radarrUrl: string;
  radarrApiKey: string;
  sonarrUrl: string;
  sonarrApiKey: string;
  duckdnsSubdomain: string;
  duckdnsToken: string;
  backupPath: string;
}

function sanitizeSecret(val?: string): string {
  if (!val) return '';
  const s = val.trim();
  if (!s) return '';
  if (/^(your[_-]|tb_live_your|sample|placeholder|default)/i.test(s)) {
    return '';
  }
  return s;
}

const rawDuckDns = (process.env.DUCKDNS_SUBDOMAIN || '').trim();
const isDuckDnsValid = rawDuckDns && !/^(your[_-]|sample|placeholder)/i.test(rawDuckDns);

const defaultPublicUrl = isDuckDnsValid
  ? `https://${rawDuckDns}.duckdns.org`
  : 'http://localhost:3000';

const defaultBackupPath = fs.existsSync('/mnt/backups')
  ? '/mnt/backups'
  : path.resolve(process.cwd(), 'backups');

export const config: AppConfig = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  databasePath: process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data/cinestream.sqlite'),
  nasCachePath: process.env.NAS_CACHE_PATH || path.resolve(process.cwd(), 'nas_media'),
  backupPath: process.env.BACKUP_PATH || defaultBackupPath,
  nasMaxConcurrentDownloads: parseInt(process.env.NAS_MAX_CONCURRENT_DOWNLOADS || '2', 10),
  nasThreadsPerDownload: parseInt(process.env.NAS_THREADS_PER_DOWNLOAD || '6', 10),
  publicServerUrl: (process.env.PUBLIC_SERVER_URL || defaultPublicUrl).replace(/\/$/, ''),
  aiostreamsInternalUrl: (process.env.AIOSTREAMS_INTERNAL_URL || 'http://localhost:3001').replace(/\/$/, ''),
  aiostreamsUserConfig: sanitizeSecret(process.env.AIOSTREAMS_USER_CONFIG),
  aiostreamsSecretKey: sanitizeSecret(process.env.AIOSTREAMS_SECRET_KEY),
  tmdbApiKey: sanitizeSecret(process.env.TMDB_API_KEY),
  defaultCountry: (process.env.DEFAULT_COUNTRY || 'ZA').toUpperCase(),
  proxyConnections: parseInt(process.env.PROXY_CONNECTIONS || '8', 10),
  proxyChunkSizeMb: parseInt(process.env.PROXY_CHUNK_SIZE_MB || '8', 10),
  proxyReadaheadMb: parseInt(process.env.PROXY_READAHEAD_MB || '64', 10),
  torboxApiKey: sanitizeSecret(process.env.TORBOX_API_KEY),
  premiumizeApiKey: sanitizeSecret(process.env.PREMIUMIZE_API_KEY),
  easynewsUsername: sanitizeSecret(process.env.EASYNEWS_USERNAME),
  easynewsPassword: sanitizeSecret(process.env.EASYNEWS_PASSWORD),
  althubApiKey: sanitizeSecret(process.env.ALTHUB_API_KEY),
  realdebridApiKey: sanitizeSecret(process.env.REALDEBRID_API_KEY || process.env.RD_API_KEY),
  alldebridApiKey: sanitizeSecret(process.env.ALLDEBRID_API_KEY),
  radarrUrl: (process.env.RADARR_URL || '').replace(/\/$/, ''),
  radarrApiKey: sanitizeSecret(process.env.RADARR_API_KEY),
  sonarrUrl: (process.env.SONARR_URL || '').replace(/\/$/, ''),
  sonarrApiKey: sanitizeSecret(process.env.SONARR_API_KEY),
  duckdnsSubdomain: isDuckDnsValid ? rawDuckDns : '',
  duckdnsToken: sanitizeSecret(process.env.DUCKDNS_TOKEN),
};

