import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fetch as undiciFetch } from 'undici';
import { config } from '../config';
import { appSettings } from './appSettings';

export class BootstrapService {
  private radarrConfigDir = process.env.RADARR_CONFIG_DIR || '/arr_configs/radarr';
  private sonarrConfigDir = process.env.SONARR_CONFIG_DIR || '/arr_configs/sonarr';
  private sabnzbdConfigDir = process.env.SABNZBD_CONFIG_DIR || '/arr_configs/sabnzbd';
  private aiostreamsDataDir = process.env.AIOSTREAMS_DATA_DIR || '/aiostreams_data';

  public async run(): Promise<void> {
    console.log('[Bootstrap] Initializing zero-touch auto-configuration...');

    // 1. Auto-discover or auto-generate Radarr API Key
    this.bootstrapRadarr();

    // 2. Auto-discover or auto-generate Sonarr API Key
    this.bootstrapSonarr();

    // 3. Auto-configure SABnzbd with Easynews NNTP & API Key
    this.bootstrapSabnzbd();

    // 4. Ensure NAS Media Folders exist (/mnt/nas/movies, /mnt/nas/tv, etc.)
    this.ensureNasFolders();

    // 5. Auto-discover AIOStreams user configuration if available
    this.bootstrapAioStreams();

    // 6. Asynchronously probe Radarr & Sonarr to register root folders & download clients
    this.autoLinkServarrAsync().catch((err) => {
      console.warn('[Bootstrap] Background Servarr auto-link notice:', err?.message || err);
    });
  }

  private bootstrapRadarr(): void {
    try {
      const configXmlPath = path.join(this.radarrConfigDir, 'config.xml');
      if (fs.existsSync(configXmlPath)) {
        const content = fs.readFileSync(configXmlPath, 'utf8');
        const match = content.match(/<ApiKey>([^<]+)<\/ApiKey>/i);
        if (match && match[1]) {
          const key = match[1].trim();
          appSettings.set('radarr_api_key', key);
          if (!appSettings.get('radarr_url')) {
            appSettings.set('radarr_url', 'http://radarr:7878');
          }
          console.log(`[Bootstrap] Discovered existing Radarr API key from ${configXmlPath}`);
          return;
        }
      }

      // If directory is mountable, pre-seed config.xml
      if (fs.existsSync(this.radarrConfigDir) || this.tryCreateDir(this.radarrConfigDir)) {
        let key = appSettings.get('radarr_api_key');
        if (!key) {
          key = 'cs_arr_' + crypto.randomBytes(12).toString('hex');
          appSettings.set('radarr_api_key', key);
        }
        if (!appSettings.get('radarr_url')) {
          appSettings.set('radarr_url', 'http://radarr:7878');
        }

        const xml = `<Config>
  <LogLevel>info</LogLevel>
  <UrlBase></UrlBase>
  <UpdateMechanism>BuiltIn</UpdateMechanism>
  <BindAddress>*</BindAddress>
  <Port>7878</Port>
  <ApiKey>${key}</ApiKey>
  <AuthenticationMethod>None</AuthenticationMethod>
</Config>
`;
        fs.writeFileSync(configXmlPath, xml, 'utf8');
        console.log(`[Bootstrap] Pre-seeded Radarr config.xml with zero-touch API key at ${configXmlPath}`);
      }
    } catch (err: any) {
      console.warn('[Bootstrap] Radarr pre-seed skipped:', err.message);
    }
  }

  private bootstrapSonarr(): void {
    try {
      const configXmlPath = path.join(this.sonarrConfigDir, 'config.xml');
      if (fs.existsSync(configXmlPath)) {
        const content = fs.readFileSync(configXmlPath, 'utf8');
        const match = content.match(/<ApiKey>([^<]+)<\/ApiKey>/i);
        if (match && match[1]) {
          const key = match[1].trim();
          appSettings.set('sonarr_api_key', key);
          if (!appSettings.get('sonarr_url')) {
            appSettings.set('sonarr_url', 'http://sonarr:8989');
          }
          console.log(`[Bootstrap] Discovered existing Sonarr API key from ${configXmlPath}`);
          return;
        }
      }

      // If directory is mountable, pre-seed config.xml
      if (fs.existsSync(this.sonarrConfigDir) || this.tryCreateDir(this.sonarrConfigDir)) {
        let key = appSettings.get('sonarr_api_key');
        if (!key) {
          key = 'cs_arr_' + crypto.randomBytes(12).toString('hex');
          appSettings.set('sonarr_api_key', key);
        }
        if (!appSettings.get('sonarr_url')) {
          appSettings.set('sonarr_url', 'http://sonarr:8989');
        }

        const xml = `<Config>
  <LogLevel>info</LogLevel>
  <UrlBase></UrlBase>
  <UpdateMechanism>BuiltIn</UpdateMechanism>
  <BindAddress>*</BindAddress>
  <Port>8989</Port>
  <ApiKey>${key}</ApiKey>
  <AuthenticationMethod>None</AuthenticationMethod>
</Config>
`;
        fs.writeFileSync(configXmlPath, xml, 'utf8');
        console.log(`[Bootstrap] Pre-seeded Sonarr config.xml with zero-touch API key at ${configXmlPath}`);
      }
    } catch (err: any) {
      console.warn('[Bootstrap] Sonarr pre-seed skipped:', err.message);
    }
  }

  private bootstrapSabnzbd(): void {
    try {
      const iniPath = path.join(this.sabnzbdConfigDir, 'sabnzbd.ini');
      if (fs.existsSync(iniPath)) {
        let content = fs.readFileSync(iniPath, 'utf8');
        const match = content.match(/^api_key\s*=\s*([a-f0-9_]+)/m);
        if (match && match[1]) {
          const key = match[1].trim();
          appSettings.set('sabnzbd_api_key', key);
          console.log(`[Bootstrap] Discovered existing SABnzbd API key from ${iniPath}`);
        }

        // Automatically patch host_whitelist in existing sabnzbd.ini to permit container hostname routing
        let updated = false;
        if (/^host_whitelist\s*=/m.test(content)) {
          const wlLine = content.match(/^host_whitelist\s*=.*$/m)?.[0] || '';
          if (!/sabnzbd/i.test(wlLine)) {
            content = content.replace(/^host_whitelist\s*=\s*(.*)$/m, 'host_whitelist = $1, sabnzbd, cinestream-sabnzbd, localhost, 127.0.0.1');
            updated = true;
          }
        } else if (/\[misc\]/i.test(content)) {
          content = content.replace(/\[misc\]/i, '[misc]\nhost_whitelist = sabnzbd, cinestream-sabnzbd, localhost, 127.0.0.1');
          updated = true;
        }

        if (updated) {
          fs.writeFileSync(iniPath, content, 'utf8');
          console.log('[Bootstrap] Automatically added container hostnames to SABnzbd host_whitelist in sabnzbd.ini');
        }
        return;
      }

      if (fs.existsSync(this.sabnzbdConfigDir) || this.tryCreateDir(this.sabnzbdConfigDir)) {
        let sabKey = appSettings.get('sabnzbd_api_key');
        if (!sabKey) {
          sabKey = 'cs_sab_' + crypto.randomBytes(12).toString('hex');
          appSettings.set('sabnzbd_api_key', sabKey);
        }

        let iniContent = `__version__ = 19
[misc]
api_key = ${sabKey}
nzb_key = ${sabKey}
host_whitelist = sabnzbd, cinestream-sabnzbd, localhost, 127.0.0.1
enable_https = 0
port = 8080
host = 0.0.0.0
download_dir = /mnt/nas/downloads/incomplete
complete_dir = /mnt/nas/downloads/complete
backup_dir = /mnt/backups/sabnzbd
auto_browser = 0
`;

        if (config.easynewsUsername && config.easynewsPassword) {
          iniContent += `
[servers]
[[news.easynews.com]]
name = news.easynews.com
displayname = news.easynews.com
host = news.easynews.com
port = 563
timeout = 60
username = ${config.easynewsUsername}
password = ${config.easynewsPassword}
connections = 20
ssl = 1
ssl_verify = 2
enable = 1
priority = 0
`;
          console.log('[Bootstrap] Pre-configured SABnzbd with Easynews NNTP (SSL port 563)');
        }

        fs.writeFileSync(iniPath, iniContent, 'utf8');
        console.log(`[Bootstrap] Pre-seeded SABnzbd configuration with API key at ${iniPath}`);
      }
    } catch (err: any) {
      console.warn('[Bootstrap] SABnzbd pre-seed skipped:', err.message);
    }
  }

  private ensureNasFolders(): void {
    try {
      const nasRoot = config.nasCachePath;
      const folders = [
        path.join(nasRoot, 'movies'),
        path.join(nasRoot, 'tv'),
        path.join(nasRoot, 'downloads', 'complete'),
        path.join(nasRoot, 'downloads', 'incomplete'),
      ];

      for (const f of folders) {
        if (!fs.existsSync(f)) {
          fs.mkdirSync(f, { recursive: true });
        }
      }
      console.log(`[Bootstrap] Verified NAS media directories at ${nasRoot}`);
    } catch (err: any) {
      console.warn('[Bootstrap] NAS directory creation notice:', err.message);
    }
  }

  private bootstrapAioStreams(): void {
    // If AIOStreams has saved database in mounted volume, inspect for existing user config
    try {
      const dbPath = path.join(this.aiostreamsDataDir, 'db.sqlite');
      if (fs.existsSync(dbPath) && !config.aiostreamsUserConfig && !appSettings.get('aiostreams_user_config')) {
        // Read file contents or inspect strings for stremio user token
        const buffer = fs.readFileSync(dbPath);
        const str = buffer.toString('utf8');
        // Match 32 or 36 char UUID or token
        const tokenMatch = str.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        if (tokenMatch) {
          appSettings.set('aiostreams_user_config', tokenMatch[0]);
          console.log(`[Bootstrap] Auto-discovered AIOStreams configuration UUID: ${tokenMatch[0]}`);
        }
      }
    } catch (_) {}
  }

  private async autoLinkServarrAsync(): Promise<void> {
    // Retry loop for up to 25 attempts (approx 2 minutes while containers spin up)
    const maxAttempts = 25;
    let radarrLinked = false;
    let sonarrLinked = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, 5000));

      const radarrKey = appSettings.get('radarr_api_key') || config.radarrApiKey;
      const sonarrKey = appSettings.get('sonarr_api_key') || config.sonarrApiKey;
      const sabKey = appSettings.get('sabnzbd_api_key');

      // 1. Link Radarr
      if (!radarrLinked && radarrKey) {
        try {
          const res = await undiciFetch('http://radarr:7878/api/v3/system/status', {
            headers: { 'X-Api-Key': radarrKey },
            signal: AbortSignal.timeout(3000),
          });
          if (res.ok) {
            await this.configureRadarr(radarrKey, sabKey);
            radarrLinked = true;
            console.log('✅ [Bootstrap] Radarr successfully linked (Root folder /mnt/nas/movies + SABnzbd client registered)!');
          }
        } catch (_) {}
      }

      // 2. Link Sonarr
      if (!sonarrLinked && sonarrKey) {
        try {
          const res = await undiciFetch('http://sonarr:8989/api/v3/system/status', {
            headers: { 'X-Api-Key': sonarrKey },
            signal: AbortSignal.timeout(3000),
          });
          if (res.ok) {
            await this.configureSonarr(sonarrKey, sabKey);
            sonarrLinked = true;
            console.log('✅ [Bootstrap] Sonarr successfully linked (Root folder /mnt/nas/tv + SABnzbd client registered)!');
          }
        } catch (_) {}
      }

      if (radarrLinked && sonarrLinked) {
        break;
      }
    }
  }

  private async configureRadarr(apiKey: string, sabKey: string): Promise<void> {
    const headers = { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' };

    // A. Root folder /mnt/nas/movies
    try {
      const rfRes = await undiciFetch('http://radarr:7878/api/v3/rootfolder', { headers });
      if (rfRes.ok) {
        const rootFolders: any = await rfRes.json();
        const hasMovieRoot = Array.isArray(rootFolders) && rootFolders.some((f: any) => f.path === '/mnt/nas/movies');
        if (!hasMovieRoot) {
          await undiciFetch('http://radarr:7878/api/v3/rootfolder', {
            method: 'POST',
            headers,
            body: JSON.stringify({ path: '/mnt/nas/movies' }),
          });
        }
      }
    } catch (_) {}

    // B. Download client SABnzbd
    if (sabKey) {
      try {
        const dcRes = await undiciFetch('http://radarr:7878/api/v3/downloadclient', { headers });
        if (dcRes.ok) {
          const clients: any = await dcRes.json();
          const hasSab = Array.isArray(clients) && clients.some((c: any) => c.name?.toLowerCase().includes('sabnzbd'));
          if (!hasSab) {
            await undiciFetch('http://radarr:7878/api/v3/downloadclient', {
              method: 'POST',
              headers,
              body: JSON.stringify({
                enable: true,
                protocol: 'usenet',
                priority: 1,
                name: 'SABnzbd',
                implementation: 'Sabnzbd',
                configContract: 'SabnzbdSettings',
                fields: [
                  { name: 'host', value: 'sabnzbd' },
                  { name: 'port', value: 8080 },
                  { name: 'apiKey', value: sabKey },
                  { name: 'useSsl', value: false },
                  { name: 'movieCategory', value: 'movies' },
                  { name: 'recentMoviePriority', value: 0 },
                ],
              }),
            });
          }
        }
      } catch (_) {}
    }

    // C. Automated daily backup configuration
    try {
      const bRes = await undiciFetch('http://radarr:7878/api/v3/config/backup', { headers });
      if (bRes.ok) {
        const backupCfg: any = await bRes.json();
        if (backupCfg && backupCfg.folder !== '/mnt/backups/radarr') {
          backupCfg.folder = '/mnt/backups/radarr';
          backupCfg.interval = 1;
          backupCfg.retention = 14;
          await undiciFetch('http://radarr:7878/api/v3/config/backup', {
            method: 'PUT',
            headers,
            body: JSON.stringify(backupCfg),
          });
          console.log('[Bootstrap] Configured Radarr automated backup folder to /mnt/backups/radarr');
        }
      }
    } catch (_) {}

    // D. Auto-register AltHub Newznab Indexer in Radarr
    if (config.althubApiKey) {
      try {
        const idxRes = await undiciFetch('http://radarr:7878/api/v3/indexer', { headers });
        if (idxRes.ok) {
          const indexers: any = await idxRes.json();
          const hasAltHub = Array.isArray(indexers) && indexers.some((i: any) => i.name?.toLowerCase().includes('althub'));
          if (!hasAltHub) {
            await undiciFetch('http://radarr:7878/api/v3/indexer', {
              method: 'POST',
              headers,
              body: JSON.stringify({
                enableRss: true,
                enableAutomaticSearch: true,
                enableInteractiveSearch: true,
                supportsRss: true,
                supportsSearch: true,
                protocol: 'usenet',
                name: 'altHUB',
                fields: [
                  { name: 'base_url', value: 'https://api.althub.co.za' },
                  { name: 'api_path', value: '/api' },
                  { name: 'apikey', value: config.althubApiKey },
                  { name: 'categories', value: [2000, 2030, 2040, 2045, 2050, 2060] },
                  { name: 'additionalParameters', value: '' },
                ],
                implementation: 'Newznab',
                configContract: 'NewznabSettings',
                priority: 25,
              }),
            });
            console.log('✅ [Bootstrap] Registered AltHub as Newznab indexer in Radarr!');
          }
        }
      } catch (err: any) {
        console.warn('[Bootstrap] AltHub Radarr registration notice:', err.message);
      }
    }
  }

  private async configureSonarr(apiKey: string, sabKey: string): Promise<void> {
    const headers = { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' };

    // A. Root folder /mnt/nas/tv
    try {
      const rfRes = await undiciFetch('http://sonarr:8989/api/v3/rootfolder', { headers });
      if (rfRes.ok) {
        const rootFolders: any = await rfRes.json();
        const hasTvRoot = Array.isArray(rootFolders) && rootFolders.some((f: any) => f.path === '/mnt/nas/tv');
        if (!hasTvRoot) {
          await undiciFetch('http://sonarr:8989/api/v3/rootfolder', {
            method: 'POST',
            headers,
            body: JSON.stringify({ path: '/mnt/nas/tv' }),
          });
        }
      }
    } catch (_) {}

    // B. Download client SABnzbd
    if (sabKey) {
      try {
        const dcRes = await undiciFetch('http://sonarr:8989/api/v3/downloadclient', { headers });
        if (dcRes.ok) {
          const clients: any = await dcRes.json();
          const hasSab = Array.isArray(clients) && clients.some((c: any) => c.name?.toLowerCase().includes('sabnzbd'));
          if (!hasSab) {
            await undiciFetch('http://sonarr:8989/api/v3/downloadclient', {
              method: 'POST',
              headers,
              body: JSON.stringify({
                enable: true,
                protocol: 'usenet',
                priority: 1,
                name: 'SABnzbd',
                implementation: 'Sabnzbd',
                configContract: 'SabnzbdSettings',
                fields: [
                  { name: 'host', value: 'sabnzbd' },
                  { name: 'port', value: 8080 },
                  { name: 'apiKey', value: sabKey },
                  { name: 'useSsl', value: false },
                  { name: 'tvCategory', value: 'tv' },
                  { name: 'recentTvPriority', value: 0 },
                ],
              }),
            });
          }
        }
      } catch (_) {}
    }

    // C. Automated daily backup configuration
    try {
      const bRes = await undiciFetch('http://sonarr:8989/api/v3/config/backup', { headers });
      if (bRes.ok) {
        const backupCfg: any = await bRes.json();
        if (backupCfg && backupCfg.folder !== '/mnt/backups/sonarr') {
          backupCfg.folder = '/mnt/backups/sonarr';
          backupCfg.interval = 1;
          backupCfg.retention = 14;
          await undiciFetch('http://sonarr:8989/api/v3/config/backup', {
            method: 'PUT',
            headers,
            body: JSON.stringify(backupCfg),
          });
          console.log('[Bootstrap] Configured Sonarr automated backup folder to /mnt/backups/sonarr');
        }
      }
    } catch (_) {}

    // D. Auto-register AltHub Newznab Indexer in Sonarr
    if (config.althubApiKey) {
      try {
        const idxRes = await undiciFetch('http://sonarr:8989/api/v3/indexer', { headers });
        if (idxRes.ok) {
          const indexers: any = await idxRes.json();
          const hasAltHub = Array.isArray(indexers) && indexers.some((i: any) => i.name?.toLowerCase().includes('althub'));
          if (!hasAltHub) {
            await undiciFetch('http://sonarr:8989/api/v3/indexer', {
              method: 'POST',
              headers,
              body: JSON.stringify({
                enableRss: true,
                enableAutomaticSearch: true,
                enableInteractiveSearch: true,
                supportsRss: true,
                supportsSearch: true,
                protocol: 'usenet',
                name: 'altHUB',
                fields: [
                  { name: 'base_url', value: 'https://api.althub.co.za' },
                  { name: 'api_path', value: '/api' },
                  { name: 'apikey', value: config.althubApiKey },
                  { name: 'categories', value: [5000, 5020, 5030, 5040, 5045] },
                  { name: 'additionalParameters', value: '' },
                ],
                implementation: 'Newznab',
                configContract: 'NewznabSettings',
                priority: 25,
              }),
            });
            console.log('✅ [Bootstrap] Registered AltHub as Newznab indexer in Sonarr!');
          }
        }
      } catch (err: any) {
        console.warn('[Bootstrap] AltHub Sonarr registration notice:', err.message);
      }
    }
  }

  private tryCreateDir(dir: string): boolean {
    try {
      fs.mkdirSync(dir, { recursive: true });
      return true;
    } catch (_) {
      return false;
    }
  }
}

export const bootstrapService = new BootstrapService();

