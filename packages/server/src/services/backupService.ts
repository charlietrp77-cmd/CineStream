import fs from 'fs';
import path from 'path';
import { fetch as undiciFetch } from 'undici';
import { config } from '../config';
import { getDatabase } from '../db';
import { appSettings } from './appSettings';

export interface ServiceBackupInfo {
  fileCount: number;
  lastBackupFile: string | null;
  lastBackupTime: number | null;
  totalSizeBytes: number;
  totalSizeText: string;
}

export interface BackupStatusReport {
  backupRoot: string;
  isWritable: boolean;
  retentionDays: number;
  lastGlobalBackupTime: number | null;
  services: {
    cinestream: ServiceBackupInfo;
    radarr: ServiceBackupInfo;
    sonarr: ServiceBackupInfo;
    sabnzbd: ServiceBackupInfo;
    aiostreams: ServiceBackupInfo;
  };
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = bytes / 1024;
  return `${kb.toFixed(0)} KB`;
}

function getServiceBackupInfo(serviceDir: string): ServiceBackupInfo {
  if (!fs.existsSync(serviceDir)) {
    return {
      fileCount: 0,
      lastBackupFile: null,
      lastBackupTime: null,
      totalSizeBytes: 0,
      totalSizeText: '0 B',
    };
  }

  try {
    const files = fs.readdirSync(serviceDir);
    let totalSize = 0;
    let latestTime: number | null = null;
    let latestFile: string | null = null;

    for (const f of files) {
      const fullPath = path.join(serviceDir, f);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          totalSize += stat.size;
          if (latestTime === null || stat.mtimeMs > latestTime) {
            latestTime = stat.mtimeMs;
            latestFile = f;
          }
        }
      } catch (_) {}
    }

    return {
      fileCount: files.length,
      lastBackupFile: latestFile,
      lastBackupTime: latestTime,
      totalSizeBytes: totalSize,
      totalSizeText: formatBytes(totalSize),
    };
  } catch (_) {
    return {
      fileCount: 0,
      lastBackupFile: null,
      lastBackupTime: null,
      totalSizeBytes: 0,
      totalSizeText: '0 B',
    };
  }
}

export class BackupService {
  private backupRoot = config.backupPath;
  private retentionLimit = 14; // Keep 14 daily snapshots
  private lastGlobalBackupTime: number | null = null;
  private timer: NodeJS.Timeout | null = null;

  private radarrConfigDir = process.env.RADARR_CONFIG_DIR || '/arr_configs/radarr';
  private sonarrConfigDir = process.env.SONARR_CONFIG_DIR || '/arr_configs/sonarr';
  private sabnzbdConfigDir = process.env.SABNZBD_CONFIG_DIR || '/arr_configs/sabnzbd';
  private aiostreamsDataDir = process.env.AIOSTREAMS_DATA_DIR || '/aiostreams_data';

  public init(): void {
    this.ensureDirs();

    // Trigger initial backup 45 seconds after launch (once containers have booted)
    setTimeout(() => {
      this.runFullBackup().catch((err) => {
        console.warn('[BackupService] Initial backup run error:', err?.message || err);
      });
    }, 45000);

    // Schedule periodic daily backup (every 24 hours)
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    this.timer = setInterval(() => {
      this.runFullBackup().catch((err) => {
        console.warn('[BackupService] Daily scheduled backup error:', err?.message || err);
      });
    }, twentyFourHoursMs);

    console.log(`[BackupService] Automated backup engine active at ${this.backupRoot} (Retention: ${this.retentionLimit} days)`);
  }

  public ensureDirs(): void {
    const subdirs = ['cinestream', 'radarr', 'sonarr', 'sabnzbd', 'aiostreams'];
    for (const sub of subdirs) {
      const full = path.join(this.backupRoot, sub);
      if (!fs.existsSync(full)) {
        try {
          fs.mkdirSync(full, { recursive: true });
        } catch (_) {}
      }
    }
  }

  public async runFullBackup(): Promise<BackupStatusReport> {
    this.ensureDirs();
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    console.log(`[BackupService] Starting full configuration backup snapshot (${timestamp})...`);

    // 1. CineStream Database Online Backup
    try {
      const cineDir = path.join(this.backupRoot, 'cinestream');
      const dbDest = path.join(cineDir, `cinestream_${timestamp}.sqlite`);
      const db = getDatabase();
      await db.backup(dbDest);

      // Also dump current appSettings as JSON
      const settingsDump = appSettings.getAll();
      fs.writeFileSync(
        path.join(cineDir, `app_settings_${timestamp}.json`),
        JSON.stringify(settingsDump, null, 2),
        'utf8'
      );
      this.pruneOldBackups(cineDir);
    } catch (err: any) {
      console.warn('[BackupService] CineStream DB backup notice:', err.message);
    }

    // 2. Radarr Configuration & Internal Native Backup
    try {
      const radarrDir = path.join(this.backupRoot, 'radarr');
      const configXml = path.join(this.radarrConfigDir, 'config.xml');
      if (fs.existsSync(configXml)) {
        fs.copyFileSync(configXml, path.join(radarrDir, `config_${timestamp}.xml`));
      }

      // Trigger Radarr internal Backup command via REST API
      const radarrKey = appSettings.get('radarr_api_key') || config.radarrApiKey;
      const radarrUrl = appSettings.get('radarr_url') || 'http://radarr:7878';
      if (radarrKey) {
        undiciFetch(`${radarrUrl}/api/v3/command`, {
          method: 'POST',
          headers: { 'X-Api-Key': radarrKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Backup' }),
          signal: AbortSignal.timeout(5000),
        }).catch(() => {});
      }
      this.pruneOldBackups(radarrDir);
    } catch (err: any) {
      console.warn('[BackupService] Radarr backup notice:', err.message);
    }

    // 3. Sonarr Configuration & Internal Native Backup
    try {
      const sonarrDir = path.join(this.backupRoot, 'sonarr');
      const configXml = path.join(this.sonarrConfigDir, 'config.xml');
      if (fs.existsSync(configXml)) {
        fs.copyFileSync(configXml, path.join(sonarrDir, `config_${timestamp}.xml`));
      }

      // Trigger Sonarr internal Backup command via REST API
      const sonarrKey = appSettings.get('sonarr_api_key') || config.sonarrApiKey;
      const sonarrUrl = appSettings.get('sonarr_url') || 'http://sonarr:8989';
      if (sonarrKey) {
        undiciFetch(`${sonarrUrl}/api/v3/command`, {
          method: 'POST',
          headers: { 'X-Api-Key': sonarrKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Backup' }),
          signal: AbortSignal.timeout(5000),
        }).catch(() => {});
      }
      this.pruneOldBackups(sonarrDir);
    } catch (err: any) {
      console.warn('[BackupService] Sonarr backup notice:', err.message);
    }

    // 4. SABnzbd Configuration Backup
    try {
      const sabDir = path.join(this.backupRoot, 'sabnzbd');
      const sabIni = path.join(this.sabnzbdConfigDir, 'sabnzbd.ini');
      if (fs.existsSync(sabIni)) {
        fs.copyFileSync(sabIni, path.join(sabDir, `sabnzbd_${timestamp}.ini`));
      }
      this.pruneOldBackups(sabDir);
    } catch (err: any) {
      console.warn('[BackupService] SABnzbd backup notice:', err.message);
    }

    // 5. AIOStreams Data Backup
    try {
      const aioDir = path.join(this.backupRoot, 'aiostreams');
      const aioDb = path.join(this.aiostreamsDataDir, 'db.sqlite');
      if (fs.existsSync(aioDb)) {
        fs.copyFileSync(aioDb, path.join(aioDir, `aiostreams_${timestamp}.sqlite`));
      }
      this.pruneOldBackups(aioDir);
    } catch (err: any) {
      console.warn('[BackupService] AIOStreams backup notice:', err.message);
    }

    this.lastGlobalBackupTime = Date.now();
    console.log(`✅ [BackupService] Configuration backup snapshot completed at ${this.backupRoot}`);
    return this.getStatus();
  }

  public getStatus(): BackupStatusReport {
    this.ensureDirs();
    let isWritable = false;
    try {
      const testFile = path.join(this.backupRoot, '.write_test');
      fs.writeFileSync(testFile, 'ok', 'utf8');
      fs.unlinkSync(testFile);
      isWritable = true;
    } catch (_) {}

    return {
      backupRoot: this.backupRoot,
      isWritable,
      retentionDays: this.retentionLimit,
      lastGlobalBackupTime: this.lastGlobalBackupTime,
      services: {
        cinestream: getServiceBackupInfo(path.join(this.backupRoot, 'cinestream')),
        radarr: getServiceBackupInfo(path.join(this.backupRoot, 'radarr')),
        sonarr: getServiceBackupInfo(path.join(this.backupRoot, 'sonarr')),
        sabnzbd: getServiceBackupInfo(path.join(this.backupRoot, 'sabnzbd')),
        aiostreams: getServiceBackupInfo(path.join(this.backupRoot, 'aiostreams')),
      },
    };
  }

  private pruneOldBackups(dir: string): void {
    try {
      const files = fs.readdirSync(dir).map((f) => {
        const full = path.join(dir, f);
        return { name: f, full, stat: fs.statSync(full) };
      });

      // Filter only files and sort newest to oldest
      const sorted = files.filter((item) => item.stat.isFile()).sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

      // Keep only up to retentionLimit files
      if (sorted.length > this.retentionLimit) {
        const toDelete = sorted.slice(this.retentionLimit);
        for (const item of toDelete) {
          try {
            fs.unlinkSync(item.full);
          } catch (_) {}
        }
      }
    } catch (_) {}
  }
}

export const backupService = new BackupService();

