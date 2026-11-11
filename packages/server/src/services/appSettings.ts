import { db } from '../db';
import { config } from '../config';

export class AppSettingsService {
  public get(key: string, fallback: string = ''): string {
    try {
      const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
      if (row && row.value !== undefined && row.value !== '') {
        return row.value;
      }
    } catch (_) {}

    // Fallbacks from environment / config
    if (key === 'radarr_url') return config.radarrUrl || fallback;
    if (key === 'radarr_api_key') return config.radarrApiKey || fallback;
    if (key === 'sonarr_url') return config.sonarrUrl || fallback;
    if (key === 'sonarr_api_key') return config.sonarrApiKey || fallback;
    if (key === 'auto_cache_episodes_ahead') return String(config.autoCacheEpisodesAhead || 0);
    if (key === 'althub_api_key') return config.althubApiKey || fallback;
    if (key === 'nzbgeek_api_key') return config.nzbgeekApiKey || fallback;
    if (key === 'drunkenslug_api_key') return config.drunkenslugApiKey || fallback;
    if (key === 'sabnzbd_api_key') return fallback;

    return fallback;
  }

  public set(key: string, value: string): void {
    const now = Date.now();
    db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value.trim(), now);
  }

  public getAll(): Record<string, string> {
    const result: Record<string, string> = {
      radarr_url: this.get('radarr_url'),
      radarr_api_key: this.get('radarr_api_key'),
      sonarr_url: this.get('sonarr_url'),
      sonarr_api_key: this.get('sonarr_api_key'),
      auto_cache_episodes_ahead: this.get('auto_cache_episodes_ahead'),
      althub_api_key: this.get('althub_api_key'),
      nzbgeek_api_key: this.get('nzbgeek_api_key'),
      drunkenslug_api_key: this.get('drunkenslug_api_key'),
    };
    return result;
  }
}

export const appSettings = new AppSettingsService();

