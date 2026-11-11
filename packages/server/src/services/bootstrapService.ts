import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fetch as undiciFetch } from 'undici';
import { config } from '../config';
import { appSettings } from './appSettings';

export function sanitizeArrConfigXml(rawContent: string, defaultKey: string, port: number): string {
  const content = (rawContent || '').trim();

  // Extract ApiKey
  const keyMatch = content.match(/<ApiKey>([^<]+)<\/ApiKey>/i);
  const apiKey = keyMatch ? keyMatch[1].trim() : defaultKey;

  // Extract Port
  const portMatch = content.match(/<Port>([^<]+)<\/Port>/i);
  const currentPort = portMatch ? portMatch[1].trim() : String(port);

  // Extract UrlBase
  const urlBaseMatch = content.match(/<UrlBase>([^<]*)<\/UrlBase>/i);
  const urlBase = urlBaseMatch ? urlBaseMatch[1].trim() : '';

  // Extract BindAddress
  const bindMatch = content.match(/<BindAddress>([^<]+)<\/BindAddress>/i);
  const bindAddress = bindMatch ? bindMatch[1].trim() : '*';

  // Extract LogLevel
  const logMatch = content.match(/<LogLevel>([^<]+)<\/LogLevel>/i);
  const logLevel = logMatch ? logMatch[1].trim() : 'info';

  // Extract AllowedHosts if present
  const allowedMatch = content.match(/<AllowedHosts>([^<]*)<\/AllowedHosts>/i);
  const allowedHosts = allowedMatch ? allowedMatch[1].trim() : '';

  // Construct guaranteed clean, non-duplicated valid XML
  return `<Config>
  <LogLevel>${logLevel}</LogLevel>
  <UrlBase>${urlBase}</UrlBase>
  <UpdateMechanism>BuiltIn</UpdateMechanism>
  <BindAddress>${bindAddress}</BindAddress>
  <Port>${currentPort}</Port>
  <ApiKey>${apiKey}</ApiKey>
  <AuthenticationMethod>External</AuthenticationMethod>
  <AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>
${allowedHosts ? `  <AllowedHosts>${allowedHosts}</AllowedHosts>\n` : ''}</Config>
`;
}

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

  private ensureFilePermissions(targetPath: string): void {
    try {
      if (fs.existsSync(targetPath)) {
        fs.chmodSync(targetPath, 0o666);
        try {
          fs.chownSync(targetPath, 1000, 1000);
        } catch (_) {}
      }
    } catch (_) {}
  }

  private writeConfigFile(filePath: string, content: string): void {
    try {
      fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o666 });
      this.ensureFilePermissions(filePath);
    } catch (err: any) {
      console.warn(`[Bootstrap] Error writing config file to ${filePath}:`, err.message);
    }
  }

  private bootstrapRadarr(): void {
    try {
      this.tryCreateDir(this.radarrConfigDir);
      const configXmlPath = path.join(this.radarrConfigDir, 'config.xml');
      this.ensureFilePermissions(configXmlPath);
      let key = appSettings.get('radarr_api_key');
      if (!key) {
        key = 'cs_arr_' + crypto.randomBytes(12).toString('hex');
      }

      if (fs.existsSync(configXmlPath)) {
        const rawContent = fs.readFileSync(configXmlPath, 'utf8');
        const sanitized = sanitizeArrConfigXml(rawContent, key, 7878);
        const match = sanitized.match(/<ApiKey>([^<]+)<\/ApiKey>/i);
        if (match && match[1]) {
          key = match[1].trim();
        }
        appSettings.set('radarr_api_key', key);
        if (!appSettings.get('radarr_url')) {
          appSettings.set('radarr_url', 'http://radarr:7878');
        }

        if (rawContent.trim() !== sanitized.trim()) {
          this.writeConfigFile(configXmlPath, sanitized);
          console.log(`[Bootstrap] Sanitized & repaired Radarr config.xml at ${configXmlPath}`);
        }
        return;
      }

      if (fs.existsSync(this.radarrConfigDir) || this.tryCreateDir(this.radarrConfigDir)) {
        appSettings.set('radarr_api_key', key);
        if (!appSettings.get('radarr_url')) {
          appSettings.set('radarr_url', 'http://radarr:7878');
        }
        const xml = sanitizeArrConfigXml('', key, 7878);
        this.writeConfigFile(configXmlPath, xml);
        console.log(`[Bootstrap] Pre-seeded Radarr config.xml with zero-touch API key at ${configXmlPath}`);
      }
    } catch (err: any) {
      console.warn('[Bootstrap] Radarr pre-seed skipped:', err.message);
    }
  }

  private bootstrapSonarr(): void {
    try {
      this.tryCreateDir(this.sonarrConfigDir);
      const configXmlPath = path.join(this.sonarrConfigDir, 'config.xml');
      this.ensureFilePermissions(configXmlPath);
      let key = appSettings.get('sonarr_api_key');
      if (!key) {
        key = 'cs_arr_' + crypto.randomBytes(12).toString('hex');
      }

      if (fs.existsSync(configXmlPath)) {
        const rawContent = fs.readFileSync(configXmlPath, 'utf8');
        const sanitized = sanitizeArrConfigXml(rawContent, key, 8989);
        const match = sanitized.match(/<ApiKey>([^<]+)<\/ApiKey>/i);
        if (match && match[1]) {
          key = match[1].trim();
        }
        appSettings.set('sonarr_api_key', key);
        if (!appSettings.get('sonarr_url')) {
          appSettings.set('sonarr_url', 'http://sonarr:8989');
        }

        if (rawContent.trim() !== sanitized.trim()) {
          this.writeConfigFile(configXmlPath, sanitized);
          console.log(`[Bootstrap] Sanitized & repaired Sonarr config.xml at ${configXmlPath}`);
        }
        return;
      }

      if (fs.existsSync(this.sonarrConfigDir) || this.tryCreateDir(this.sonarrConfigDir)) {
        appSettings.set('sonarr_api_key', key);
        if (!appSettings.get('sonarr_url')) {
          appSettings.set('sonarr_url', 'http://sonarr:8989');
        }
        const xml = sanitizeArrConfigXml('', key, 8989);
        this.writeConfigFile(configXmlPath, xml);
        console.log(`[Bootstrap] Pre-seeded Sonarr config.xml with zero-touch API key at ${configXmlPath}`);
      }
    } catch (err: any) {
      console.warn('[Bootstrap] Sonarr pre-seed skipped:', err.message);
    }
  }

  public syncSabnzbdApiKey(): string | null {
    try {
      const iniPath = path.join(this.sabnzbdConfigDir, 'sabnzbd.ini');
      this.ensureFilePermissions(iniPath);
      if (fs.existsSync(iniPath)) {
        const content = fs.readFileSync(iniPath, 'utf8');
        const match = content.match(/(?:^|\n)[ \t]*api_key[ \t]*=[ \t]*["']?([a-zA-Z0-9]+)["']?/i);
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

  public async getVerifiedSabnzbdApiKey(candidate?: string): Promise<string | null> {
    const list: string[] = [];
    if (candidate) list.push(candidate.trim());

    // 1. Check sabnzbd.ini directly for both api_key and nzb_key
    try {
      const iniPath = path.join(this.sabnzbdConfigDir, 'sabnzbd.ini');
      this.ensureFilePermissions(iniPath);
      if (fs.existsSync(iniPath)) {
        const content = fs.readFileSync(iniPath, 'utf8');
        const m = content.match(/(?:^|\n)[ \t]*api_key[ \t]*=[ \t]*["']?([a-zA-Z0-9]+)["']?/i);
        if (m && m[1]) list.push(m[1].trim());
        const n = content.match(/(?:^|\n)[ \t]*nzb_key[ \t]*=[ \t]*["']?([a-zA-Z0-9]+)["']?/i);
        if (n && n[1]) list.push(n[1].trim());
      }
    } catch (_) {}

    // 2. Check appSettings
    const saved = appSettings.get('sabnzbd_api_key');
    if (saved) list.push(saved.trim());

    // 3. Check env
    if (process.env.SABNZBD_API_KEY) list.push(process.env.SABNZBD_API_KEY.trim());

    const uniqueKeys = Array.from(new Set(list.filter(Boolean)));

    for (const key of uniqueKeys) {
      try {
        const res = await undiciFetch(`http://sabnzbd:8080/api?mode=version&output=json&apikey=${key}`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
          const json: any = await res.json();
          if (json && json.version && json.status !== false) {
            if (appSettings.get('sabnzbd_api_key') !== key) {
              appSettings.set('sabnzbd_api_key', key);
              console.log(`[Bootstrap] Successfully verified live SABnzbd API key (${key.substring(0, 4)}...)`);
            }
            return key;
          }
        }
      } catch (_) {}
    }

    return uniqueKeys[0] || null;
  }

  public syncArrApiKey(target: 'radarr' | 'sonarr'): string | null {
    try {
      const configDir = target === 'radarr' ? this.radarrConfigDir : this.sonarrConfigDir;
      const configXmlPath = path.join(configDir, 'config.xml');
      this.ensureFilePermissions(configXmlPath);
      if (fs.existsSync(configXmlPath)) {
        const content = fs.readFileSync(configXmlPath, 'utf8');
        const match = content.match(/<ApiKey>([^<]+)<\/ApiKey>/i);
        if (match && match[1]) {
          const key = match[1].trim();
          const settingKey = `${target}_api_key`;
          if (appSettings.get(settingKey) !== key) {
            appSettings.set(settingKey, key);
            console.log(`[Bootstrap] Auto-discovered & synced current ${target} API key from ${configXmlPath}`);
          }
          return key;
        }
      }
    } catch (err: any) {
      console.warn(`[Bootstrap] Error reading ${target} config.xml:`, err.message);
    }
    return appSettings.get(`${target}_api_key`) || null;
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
          this.writeConfigFile(iniPath, content);
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

        this.writeConfigFile(iniPath, iniContent);
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
    let radarrLinked = false;
    let sonarrLinked = false;
    let attempts = 0;

    const checkAndLink = async () => {
      attempts++;
      const radarrKey = this.syncArrApiKey('radarr') || config.radarrApiKey;
      const sonarrKey = this.syncArrApiKey('sonarr') || config.sonarrApiKey;
      const sabKey = this.syncSabnzbdApiKey();

      // 1. Link Radarr
      if (!radarrLinked && radarrKey) {
        try {
          const res = await undiciFetch('http://radarr:7878/api/v3/system/status', {
            headers: { 'X-Api-Key': radarrKey },
            signal: AbortSignal.timeout(3000),
          });
          if (res.ok) {
            await this.configureRadarr(radarrKey, sabKey || '');
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
            await this.configureSonarr(sonarrKey, sabKey || '');
            sonarrLinked = true;
            console.log('✅ [Bootstrap] Sonarr successfully linked (Root folder /mnt/nas/tv + SABnzbd client registered)!');
          }
        } catch (_) {}
      }

      if (radarrLinked && sonarrLinked) {
        return;
      }

      // First 20 attempts check every 5s, thereafter continuously every 30s so late-starting or restarted containers link
      const nextDelay = attempts < 20 ? 5000 : 30000;
      setTimeout(checkAndLink, nextDelay);
    };

    setTimeout(checkAndLink, 3000);
  }

  public async syncSabnzbdToTarget(
    target: 'radarr' | 'sonarr',
    serviceUrl: string,
    apiKey: string,
    sabKey: string
  ): Promise<boolean> {
    const headers = { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' };
    const targetCategory = target === 'sonarr' ? 'tv' : 'movies';
    try {
      const dcRes = await undiciFetch(`${serviceUrl}/api/v3/downloadclient`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!dcRes.ok) {
        console.warn(`[Bootstrap] Unable to fetch ${target} download clients: HTTP ${dcRes.status}`);
        return false;
      }

      const clients: any = await dcRes.json();
      const existingSab = Array.isArray(clients) && clients.find((c: any) =>
        c.name?.toLowerCase().includes('sabnzbd') || c.implementation?.toLowerCase().includes('sabnzbd')
      );

      if (existingSab) {
        let needsUpdate = false;
        if (!existingSab.enable) {
          existingSab.enable = true;
          needsUpdate = true;
        }

        const apiKeyField = existingSab.fields?.find((f: any) => f.name?.toLowerCase() === 'apikey');
        if (apiKeyField && apiKeyField.value !== sabKey) {
          apiKeyField.value = sabKey;
          needsUpdate = true;
        }

        const hostField = existingSab.fields?.find((f: any) => f.name?.toLowerCase() === 'host');
        if (hostField && hostField.value !== 'sabnzbd') {
          hostField.value = 'sabnzbd';
          needsUpdate = true;
        }

        const portField = existingSab.fields?.find((f: any) => f.name?.toLowerCase() === 'port');
        if (portField && Number(portField.value) !== 8080) {
          portField.value = 8080;
          needsUpdate = true;
        }

        const catField = existingSab.fields?.find((f: any) =>
          ['category', 'tvcategory', 'moviecategory'].includes(f.name?.toLowerCase())
        );
        if (catField && catField.value !== targetCategory) {
          catField.value = targetCategory;
          needsUpdate = true;
        }

        if (needsUpdate) {
          const updateRes = await undiciFetch(`${serviceUrl}/api/v3/downloadclient/${existingSab.id}?forceSave=true`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(existingSab),
          });
          if (updateRes.ok) {
            console.log(`[Bootstrap] Successfully updated ${target} SABnzbd client with verified API key`);
            return true;
          } else {
            const errText = await updateRes.text();
            console.warn(`[Bootstrap] Failed to update ${target} SABnzbd client: HTTP ${updateRes.status}`, errText);
            return false;
          }
        }
        return true;
      }

      // Query downloadclient schema to dynamically mirror exact field formats for Sonarr/Radarr version
      let sabSchema: any = null;
      try {
        const schemaRes = await undiciFetch(`${serviceUrl}/api/v3/downloadclient/schema`, {
          headers,
          signal: AbortSignal.timeout(4000),
        });
        if (schemaRes.ok) {
          const schemas: any = await schemaRes.json();
          if (Array.isArray(schemas)) {
            sabSchema = schemas.find(
              (s: any) =>
                s.implementation?.toLowerCase() === 'sabnzbd' ||
                s.configContract?.toLowerCase() === 'sabnzbdsettings'
            );
          }
        }
      } catch (err: any) {
        console.warn(`[Bootstrap] Schema fetch for ${target} downloadclient skipped:`, err.message);
      }

      let fields: Array<{ name: string; value: any }> = [];
      if (sabSchema && Array.isArray(sabSchema.fields)) {
        fields = sabSchema.fields.map((f: any) => {
          const n = (f.name || '').toLowerCase();
          if (n === 'host') return { ...f, value: 'sabnzbd' };
          if (n === 'port') return { ...f, value: 8080 };
          if (n === 'apikey') return { ...f, value: sabKey };
          if (n === 'usessl') return { ...f, value: false };
          if (n === 'urlbase') return { ...f, value: '' };
          if (n === 'category' || n === 'tvcategory' || n === 'moviecategory') return { ...f, value: targetCategory };
          if (n === 'recentpriority' || n === 'recenttvpriority' || n === 'recentmoviepriority') return { ...f, value: 0 };
          if (n === 'olderpriority') return { ...f, value: 0 };
          return f;
        });
      } else {
        fields = [
          { name: 'host', value: 'sabnzbd' },
          { name: 'port', value: 8080 },
          { name: 'apiKey', value: sabKey },
          { name: 'useSsl', value: false },
          { name: 'urlBase', value: '' },
          { name: 'category', value: targetCategory },
          { name: target === 'sonarr' ? 'tvCategory' : 'movieCategory', value: targetCategory },
          { name: 'recentPriority', value: 0 },
          { name: 'olderPriority', value: 0 },
        ];
      }

      const payload = {
        ...(sabSchema || {}),
        name: 'SABnzbd',
        enable: true,
        protocol: 'usenet',
        priority: 1,
        implementation: 'Sabnzbd',
        configContract: 'SabnzbdSettings',
        fields,
      };

      const addRes = await undiciFetch(`${serviceUrl}/api/v3/downloadclient?forceSave=true`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (addRes.ok) {
        console.log(`[Bootstrap] Successfully registered new SABnzbd client in ${target}`);
        return true;
      } else {
        const errText = await addRes.text();
        console.warn(`[Bootstrap] Failed to register SABnzbd client in ${target}: HTTP ${addRes.status}`, errText);
        return false;
      }
    } catch (err: any) {
      console.warn(`[Bootstrap] Error syncing ${target} SABnzbd client:`, err.message);
      return false;
    }
  }

  public async syncSabnzbdClients(overrideKey?: string): Promise<{ radarr: boolean; sonarr: boolean }> {
    const sabKey = await this.getVerifiedSabnzbdApiKey(overrideKey);
    if (!sabKey) {
      console.warn('[Bootstrap] No valid SABnzbd API key could be discovered or verified');
      return { radarr: false, sonarr: false };
    }

    const radarrKey = this.syncArrApiKey('radarr') || config.radarrApiKey;
    const sonarrKey = this.syncArrApiKey('sonarr') || config.sonarrApiKey;
    const radarrUrl = appSettings.get('radarr_url') || 'http://radarr:7878';
    const sonarrUrl = appSettings.get('sonarr_url') || 'http://sonarr:8989';

    let radarrSynced = false;
    let sonarrSynced = false;

    if (radarrKey) {
      radarrSynced = await this.syncSabnzbdToTarget('radarr', radarrUrl, radarrKey, sabKey);
    }

    if (sonarrKey) {
      sonarrSynced = await this.syncSabnzbdToTarget('sonarr', sonarrUrl, sonarrKey, sabKey);
    }

    return { radarr: radarrSynced, sonarr: sonarrSynced };
  }

  public async ensureRootFolder(target: 'radarr' | 'sonarr', url: string, apiKey: string): Promise<void> {
    const defaultPath = target === 'radarr' ? '/mnt/nas/movies' : '/mnt/nas/tv';
    const headers = { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' };
    try {
      const rfRes = await undiciFetch(`${url}/api/v3/rootfolder`, { headers, signal: AbortSignal.timeout(3000) });
      if (rfRes.ok) {
        const rootFolders: any = await rfRes.json();
        const hasRoot = Array.isArray(rootFolders) && rootFolders.some((f: any) => f.path === defaultPath);
        if (!hasRoot) {
          const createRes = await undiciFetch(`${url}/api/v3/rootfolder`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ path: defaultPath }),
          });
          if (createRes.ok) {
            console.log(`[Bootstrap] Registered root folder ${defaultPath} in ${target}`);
          }
        }
      }
    } catch (_) {}
  }

  public async configureRadarr(apiKey: string, sabKey: string): Promise<void> {
    const radarrUrl = appSettings.get('radarr_url') || 'http://radarr:7878';
    const headers = { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' };

    // A. Root folder /mnt/nas/movies
    await this.ensureRootFolder('radarr', radarrUrl, apiKey);

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

  public async configureSonarr(apiKey: string, sabKey: string): Promise<void> {
    const sonarrUrl = appSettings.get('sonarr_url') || 'http://sonarr:8989';
    const headers = { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' };

    // A. Root folder /mnt/nas/tv
    await this.ensureRootFolder('sonarr', sonarrUrl, apiKey);

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
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      try {
        fs.chmodSync(dir, 0o777);
        fs.chownSync(dir, 1000, 1000);
      } catch (_) {}
      return true;
    } catch (_) {
      return false;
    }
  }
}

export const bootstrapService = new BootstrapService();

