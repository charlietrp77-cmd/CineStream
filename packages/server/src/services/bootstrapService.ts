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
        let content = fs.readFileSync(configXmlPath, 'utf8');
        const match = content.match(/<ApiKey>([^<]+)<\/ApiKey>/i);
        if (match && match[1]) {
          const key = match[1].trim();
          appSettings.set('radarr_api_key', key);
          if (!appSettings.get('radarr_url')) {
            appSettings.set('radarr_url', 'http://radarr:7878');
          }
          console.log(`[Bootstrap] Discovered existing Radarr API key from ${configXmlPath}`);

          // Prevent Radarr v4/v5 mandatory auth modal on LAN/Docker bridge
          if (content.includes('<AuthenticationMethod>None</AuthenticationMethod>')) {
            content = content.replace(
              /<AuthenticationMethod>None<\/AuthenticationMethod>/i,
              '<AuthenticationMethod>External</AuthenticationMethod>\n  <AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>'
            );
            fs.writeFileSync(configXmlPath, content, 'utf8');
            console.log(`[Bootstrap] Updated Radarr auth to External/DisabledForLocalAddresses at ${configXmlPath}`);
          }
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
  <AuthenticationMethod>External</AuthenticationMethod>
  <AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>
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
        let content = fs.readFileSync(configXmlPath, 'utf8');
        const match = content.match(/<ApiKey>([^<]+)<\/ApiKey>/i);
        if (match && match[1]) {
          const key = match[1].trim();
          appSettings.set('sonarr_api_key', key);
          if (!appSettings.get('sonarr_url')) {
            appSettings.set('sonarr_url', 'http://sonarr:8989');
          }
          console.log(`[Bootstrap] Discovered existing Sonarr API key from ${configXmlPath}`);

          // Prevent Sonarr v4 mandatory auth modal on LAN/Docker bridge
          if (content.includes('<AuthenticationMethod>None</AuthenticationMethod>')) {
            content = content.replace(
              /<AuthenticationMethod>None<\/AuthenticationMethod>/i,
              '<AuthenticationMethod>External</AuthenticationMethod>\n  <AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>'
            );
            fs.writeFileSync(configXmlPath, content, 'utf8');
            console.log(`[Bootstrap] Updated Sonarr auth to External/DisabledForLocalAddresses at ${configXmlPath}`);
          }
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
  <AuthenticationMethod>External</AuthenticationMethod>
  <AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>
</Config>
`;
        fs.writeFileSync(configXmlPath, xml, 'utf8');
        console.log(`[Bootstrap] Pre-seeded Sonarr config.xml with zero-touch API key at ${configXmlPath}`);
      }
    } catch (err: any) {
      console.warn('[Bootstrap] Sonarr pre-seed skipped:', err.message);
    }
  }

  public syncSabnzbdApiKey(): string | null {
    try {
      const iniPath = path.join(this.sabnzbdConfigDir, 'sabnzbd.ini');
      if (fs.existsSync(iniPath)) {
        const content = fs.readFileSync(iniPath, 'utf8');
        const match = content.match(/^api_key\s*=\s*["']?([a-zA-Z0-9_-]+)["']?/mi);
        if (match && match[1]) {
          const key = match[1].trim();
          if (key) {
            const current = appSettings.get('sabnzbd_api_key');
            if (current !== key) {
              appSettings.set('sabnzbd_api_key', key);
              console.log(`[Bootstrap] Auto-discovered & synced current SABnzbd API key from ${iniPath}: ${key.substring(0, 4)}...`);
            }
            return key;
          }
        }
      }
    } catch (err: any) {
      console.warn('[Bootstrap] Error reading sabnzbd.ini:', err.message);
    }
    return appSettings.get('sabnzbd_api_key') || process.env.SABNZBD_API_KEY || null;
  }

  private bootstrapSabnzbd(): void {
    try {
      const iniPath = path.join(this.sabnzbdConfigDir, 'sabnzbd.ini');
      if (fs.existsSync(iniPath)) {
        let content = fs.readFileSync(iniPath, 'utf8');
        const key = this.syncSabnzbdApiKey();
        if (key) {
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
        // SABnzbd strictly requires a 32-character hexadecimal API key
        if (!sabKey || !/^[a-fA-F0-9]{32}$/.test(sabKey)) {
          sabKey = crypto.randomBytes(16).toString('hex');
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

  public async syncSabnzbdClients(overrideKey?: string): Promise<{ radarr: boolean; sonarr: boolean }> {
    const sabKey = overrideKey || this.syncSabnzbdApiKey() || appSettings.get('sabnzbd_api_key') || process.env.SABNZBD_API_KEY || '';
    if (!sabKey) {
      return { radarr: false, sonarr: false };
    }

    const radarrKey = appSettings.get('radarr_api_key') || config.radarrApiKey;
    const sonarrKey = appSettings.get('sonarr_api_key') || config.sonarrApiKey;
    const radarrUrl = appSettings.get('radarr_url') || 'http://radarr:7878';
    const sonarrUrl = appSettings.get('sonarr_url') || 'http://sonarr:8989';

    let radarrSynced = false;
    let sonarrSynced = false;

    if (radarrKey) {
      try {
        const headers = { 'X-Api-Key': radarrKey, 'Content-Type': 'application/json' };
        const dcRes = await undiciFetch(`${radarrUrl}/api/v3/downloadclient`, {
          headers,
          signal: AbortSignal.timeout(4000),
        });
        if (dcRes.ok) {
          const clients: any = await dcRes.json();
          const existingSab = Array.isArray(clients) && clients.find((c: any) =>
            c.name?.toLowerCase().includes('sabnzbd') || c.implementation?.toLowerCase().includes('sabnzbd')
          );

          if (!existingSab) {
            await undiciFetch(`${radarrUrl}/api/v3/downloadclient`, {
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
            radarrSynced = true;
            console.log('[Bootstrap] Registered new SABnzbd client in Radarr');
          } else {
            const apiKeyField = existingSab.fields?.find((f: any) => f.name === 'apiKey');
            if (apiKeyField && apiKeyField.value !== sabKey) {
              apiKeyField.value = sabKey;
              const updateRes = await undiciFetch(`${radarrUrl}/api/v3/downloadclient/${existingSab.id}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify(existingSab),
              });
              if (updateRes.ok) {
                radarrSynced = true;
                console.log('[Bootstrap] Successfully updated Radarr SABnzbd client with current API key');
              }
            } else {
              radarrSynced = true;
            }
          }
        }
      } catch (err: any) {
        console.warn('[Bootstrap] Error syncing Radarr SABnzbd client:', err.message);
      }
    }

    if (sonarrKey) {
      try {
        const headers = { 'X-Api-Key': sonarrKey, 'Content-Type': 'application/json' };
        const dcRes = await undiciFetch(`${sonarrUrl}/api/v3/downloadclient`, {
          headers,
          signal: AbortSignal.timeout(4000),
        });
        if (dcRes.ok) {
          const clients: any = await dcRes.json();
          const existingSab = Array.isArray(clients) && clients.find((c: any) =>
            c.name?.toLowerCase().includes('sabnzbd') || c.implementation?.toLowerCase().includes('sabnzbd')
          );

          if (!existingSab) {
            await undiciFetch(`${sonarrUrl}/api/v3/downloadclient`, {
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
            sonarrSynced = true;
            console.log('[Bootstrap] Registered new SABnzbd client in Sonarr');
          } else {
            const apiKeyField = existingSab.fields?.find((f: any) => f.name === 'apiKey');
            if (apiKeyField && apiKeyField.value !== sabKey) {
              apiKeyField.value = sabKey;
              const updateRes = await undiciFetch(`${sonarrUrl}/api/v3/downloadclient/${existingSab.id}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify(existingSab),
              });
              if (updateRes.ok) {
                sonarrSynced = true;
                console.log('[Bootstrap] Successfully updated Sonarr SABnzbd client with current API key');
              }
            } else {
              sonarrSynced = true;
            }
          }
        }
      } catch (err: any) {
        console.warn('[Bootstrap] Error syncing Sonarr SABnzbd client:', err.message);
      }
    }

    return { radarr: radarrSynced, sonarr: sonarrSynced };
  }

  private async configureRadarr(apiKey: string, sabKey: string): Promise<void> {
    const radarrUrl = appSettings.get('radarr_url') || 'http://radarr:7878';
    const headers = { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' };

    // A. Root folder /mnt/nas/movies
    try {
      const rfRes = await undiciFetch(`${radarrUrl}/api/v3/rootfolder`, { headers });
      if (rfRes.ok) {
        const rootFolders: any = await rfRes.json();
        const hasMovieRoot = Array.isArray(rootFolders) && rootFolders.some((f: any) => f.path === '/mnt/nas/movies');
        if (!hasMovieRoot) {
          await undiciFetch(`${radarrUrl}/api/v3/rootfolder`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ path: '/mnt/nas/movies' }),
          });
        }
      }
    } catch (_) {}

    // B. Download client SABnzbd
    await this.syncSabnzbdClients(sabKey);

    // C. Automated daily backup configuration
    try {
      const bRes = await undiciFetch(`${radarrUrl}/api/v3/config/backup`, { headers });
      if (bRes.ok) {
        const backupCfg: any = await bRes.json();
        if (backupCfg && backupCfg.folder !== '/mnt/backups/radarr') {
          backupCfg.folder = '/mnt/backups/radarr';
          backupCfg.interval = 1;
          backupCfg.retention = 14;
          await undiciFetch(`${radarrUrl}/api/v3/config/backup`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(backupCfg),
          });
          console.log('[Bootstrap] Configured Radarr automated backup folder to /mnt/backups/radarr');
        }
      }
    } catch (_) {}

    // D. Auto-register Newznab Indexers (AltHub, NZBGeek, DrunkenSlug) in Radarr
    await this.registerNewznabIndexers('radarr', radarrUrl, apiKey, [2000, 2030, 2040, 2045, 2050, 2060]);
  }

  private async configureSonarr(apiKey: string, sabKey: string): Promise<void> {
    const sonarrUrl = appSettings.get('sonarr_url') || 'http://sonarr:8989';
    const headers = { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' };

    // A. Root folder /mnt/nas/tv
    try {
      const rfRes = await undiciFetch(`${sonarrUrl}/api/v3/rootfolder`, { headers });
      if (rfRes.ok) {
        const rootFolders: any = await rfRes.json();
        const hasTvRoot = Array.isArray(rootFolders) && rootFolders.some((f: any) => f.path === '/mnt/nas/tv');
        if (!hasTvRoot) {
          await undiciFetch(`${sonarrUrl}/api/v3/rootfolder`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ path: '/mnt/nas/tv' }),
          });
        }
      }
    } catch (_) {}

    // B. Download client SABnzbd
    await this.syncSabnzbdClients(sabKey);

    // C. Automated daily backup configuration
    try {
      const bRes = await undiciFetch(`${sonarrUrl}/api/v3/config/backup`, { headers });
      if (bRes.ok) {
        const backupCfg: any = await bRes.json();
        if (backupCfg && backupCfg.folder !== '/mnt/backups/sonarr') {
          backupCfg.folder = '/mnt/backups/sonarr';
          backupCfg.interval = 1;
          backupCfg.retention = 14;
          await undiciFetch(`${sonarrUrl}/api/v3/config/backup`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(backupCfg),
          });
          console.log('[Bootstrap] Configured Sonarr automated backup folder to /mnt/backups/sonarr');
        }
      }
    } catch (_) {}

    // D. Auto-register Newznab Indexers (AltHub, NZBGeek, DrunkenSlug) in Sonarr
    await this.registerNewznabIndexers('sonarr', sonarrUrl, apiKey, [5000, 5020, 5030, 5040, 5045]);
  }

  public async registerNewznabIndexers(
    target: 'radarr' | 'sonarr',
    serviceUrl: string,
    apiKey: string,
    categories: number[]
  ): Promise<{ registered: string[]; skipped: string[]; errors: string[] }> {
    const result = { registered: [] as string[], skipped: [] as string[], errors: [] as string[] };
    const althubKey = config.althubApiKey || appSettings.get('althub_api_key');
    const nzbgeekKey = config.nzbgeekApiKey || appSettings.get('nzbgeek_api_key');
    const drunkenslugKey = config.drunkenslugApiKey || appSettings.get('drunkenslug_api_key');

    const indexersToRegister = [
      { name: 'altHUB', baseUrl: 'https://api.althub.co.za', key: althubKey },
      { name: 'NZBGeek', baseUrl: 'https://api.nzbgeek.info', key: nzbgeekKey },
      { name: 'DrunkenSlug', baseUrl: 'https://api.drunkenslug.com', key: drunkenslugKey },
    ].filter((i) => Boolean(i.key));

    if (indexersToRegister.length === 0) return result;

    const headers = {
      'X-Api-Key': apiKey,
      'Content-Type': 'application/json',
    };

    try {
      const idxRes = await undiciFetch(`${serviceUrl}/api/v3/indexer`, { headers });
      if (!idxRes.ok) {
        console.warn(`[Bootstrap] Unable to fetch ${target} indexers: HTTP ${idxRes.status}`);
        return result;
      }
      const existing: any = await idxRes.json();
      const existingList = Array.isArray(existing) ? existing : [];

      // Query Newznab schema from target to mirror exact field formats
      let newznabSchema: any = null;
      try {
        const schemaRes = await undiciFetch(`${serviceUrl}/api/v3/indexer/schema`, { headers });
        if (schemaRes.ok) {
          const schemas: any = await schemaRes.json();
          if (Array.isArray(schemas)) {
            newznabSchema = schemas.find(
              (s: any) =>
                s.implementation?.toLowerCase() === 'newznab' ||
                s.configContract?.toLowerCase() === 'newznabsettings'
            );
          }
        }
      } catch (_) {}

      for (const idx of indexersToRegister) {
        const hostname = new URL(idx.baseUrl).hostname.toLowerCase();
        const alreadyRegistered = existingList.some(
          (e: any) =>
            e.name?.toLowerCase().includes(idx.name.toLowerCase()) ||
            e.fields?.some(
              (f: any) =>
                (f.name === 'url' || f.name === 'baseUrl' || f.name === 'base_url') &&
                String(f.value || '').toLowerCase().includes(hostname)
            )
        );

        if (alreadyRegistered) {
          result.skipped.push(idx.name);
          continue;
        }

        // Standard Newznab fields expected by Sonarr/Radarr (url, apiPath, apiKey, categories)
        let fields: Array<{ name: string; value: any }> = [];
        if (newznabSchema && Array.isArray(newznabSchema.fields)) {
          fields = newznabSchema.fields.map((f: any) => {
            const fieldName = f.name;
            if (fieldName === 'url' || fieldName === 'baseUrl' || fieldName === 'base_url') {
              return { ...f, value: idx.baseUrl };
            }
            if (fieldName === 'apiPath' || fieldName === 'api_path') {
              return { ...f, value: '/api' };
            }
            if (fieldName === 'apiKey' || fieldName === 'apikey') {
              return { ...f, value: idx.key };
            }
            if (fieldName === 'categories') {
              return { ...f, value: categories };
            }
            if (fieldName === 'additionalParameters') {
              return { ...f, value: '' };
            }
            return f;
          });
        } else {
          fields = [
            { name: 'url', value: idx.baseUrl },
            { name: 'apiPath', value: '/api' },
            { name: 'apiKey', value: idx.key },
            { name: 'categories', value: categories },
            { name: 'additionalParameters', value: '' },
          ];
        }

        const payload: any = {
          ...(newznabSchema || {}),
          name: idx.name,
          enableRss: true,
          enableAutomaticSearch: true,
          enableInteractiveSearch: true,
          supportsRss: true,
          supportsSearch: true,
          protocol: 'usenet',
          priority: 25,
          implementation: 'Newznab',
          configContract: 'NewznabSettings',
          fields,
        };
        delete payload.id;

        const res = await undiciFetch(`${serviceUrl}/api/v3/indexer`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          result.registered.push(idx.name);
          console.log(`✅ [Bootstrap] Registered ${idx.name} as Newznab indexer in ${target === 'radarr' ? 'Radarr' : 'Sonarr'}!`);
        } else {
          const errText = await res.text().catch(() => '');
          result.errors.push(`${idx.name}: HTTP ${res.status} ${errText}`);
          console.warn(`[Bootstrap] Failed to register ${idx.name} in ${target}: HTTP ${res.status} ${errText}`);
        }
      }
    } catch (err: any) {
      console.warn(`[Bootstrap] Newznab indexer registration in ${target} error:`, err.message);
    }

    return result;
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

