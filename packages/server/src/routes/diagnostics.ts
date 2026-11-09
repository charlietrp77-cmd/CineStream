import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';
import { fetch as undiciFetch } from 'undici';
import { config } from '../config';
import { db } from '../db';
import { ProfileRow } from '../db/schema';
import { aioStreams } from '../services/aiostreams';
import { arrService } from '../services/arrService';
import { providerQuotas } from '../services/providerQuotas';
import { backupService } from '../services/backupService';
import { appSettings } from '../services/appSettings';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

async function checkStorageHealth(dirPath: string): Promise<{
  path: string;
  exists: boolean;
  writable: boolean;
  total_bytes: number;
  free_bytes: number;
  used_bytes: number;
  percent_used: number;
  free_text: string;
  error: string | null;
}> {
  const result: any = {
    path: dirPath,
    exists: false,
    writable: false,
    total_bytes: 0,
    free_bytes: 0,
    used_bytes: 0,
    percent_used: 0,
    free_text: '0 B',
    error: null,
  };

  try {
    if (fs.existsSync(dirPath)) {
      result.exists = true;
      const testFile = path.join(dirPath, `.cs_diag_${Date.now()}`);
      try {
        fs.writeFileSync(testFile, 'ok', 'utf8');
        fs.unlinkSync(testFile);
        result.writable = true;
      } catch (wErr: any) {
        result.writable = false;
        result.error = `Write permission denied: ${wErr.message}`;
      }

      if (typeof (fs.promises as any).statfs === 'function') {
        try {
          const stats = await (fs.promises as any).statfs(dirPath);
          const total = stats.bsize * stats.blocks;
          const free = stats.bsize * stats.bfree;
          const used = total - free;
          result.total_bytes = total;
          result.free_bytes = free;
          result.used_bytes = used;
          result.percent_used = total > 0 ? Math.round((used / total) * 100) : 0;
          result.free_text = formatBytes(free);
        } catch (_) {}
      }
    } else {
      result.error = 'Path does not exist on host or volume not mounted';
    }
  } catch (err: any) {
    result.error = err.message;
  }
  return result;
}

async function checkSabnzbdHealth(): Promise<{
  online: boolean;
  url: string;
  version: string | null;
  error: string | null;
}> {
  const sabKey = appSettings.get('sabnzbd_api_key');
  const url = 'http://sabnzbd:8080';
  if (!sabKey) {
    return { online: false, url, version: null, error: 'No SABnzbd API key configured yet' };
  }
  try {
    const res = await undiciFetch(`${url}/api?mode=version&output=json&apikey=${sabKey}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const json: any = await res.json();
      return { online: true, url, version: json.version || 'Active', error: null };
    }
    return { online: false, url, version: null, error: `HTTP ${res.status}` };
  } catch (err: any) {
    return { online: false, url, version: null, error: err.message || 'Connection failed' };
  }
}

export interface MachineReadableDiagnostics {
  healthy: boolean;
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  timestamp: string;
  checks: {
    nas_storage: {
      status: 'PASS' | 'WARN' | 'FAIL';
      path: string;
      exists: boolean;
      writable: boolean;
      free_bytes: number;
      total_bytes: number;
      used_bytes: number;
      percent_used: number;
      free_text: string;
      error: string | null;
    };
    backup_storage: {
      status: 'PASS' | 'WARN' | 'FAIL';
      path: string;
      exists: boolean;
      writable: boolean;
      last_backup_timestamp: number | null;
      retention_days: number;
      error: string | null;
    };
    radarr: {
      status: 'PASS' | 'WARN' | 'FAIL' | 'UNCONFIGURED';
      configured: boolean;
      online: boolean;
      url: string;
      version: string | null;
      error: string | null;
    };
    sonarr: {
      status: 'PASS' | 'WARN' | 'FAIL' | 'UNCONFIGURED';
      configured: boolean;
      online: boolean;
      url: string;
      version: string | null;
      error: string | null;
    };
    sabnzbd: {
      status: 'PASS' | 'WARN' | 'FAIL' | 'UNCONFIGURED';
      online: boolean;
      url: string;
      version: string | null;
      error: string | null;
    };
    aiostreams: {
      status: 'PASS' | 'FAIL';
      online: boolean;
      url: string;
      status_code: number | null;
      error: string | null;
    };
    providers: {
      status: 'PASS' | 'WARN';
      count: number;
      active: Array<{
        provider: string;
        name: string;
        remaining_bytes: number | null;
        remaining_text: string;
        days_remaining: number | null;
        status: string;
      }>;
    };
    stream_resolution_test: {
      status: 'PASS' | 'FAIL' | 'SKIPPED';
      target_title: string;
      stream_count: number;
      best_stream: {
        name: string;
        title: string;
        resolution?: string;
      } | null;
      error: string | null;
    };
  };
  issues: string[];
  successes: string[];
  metrics: {
    uptime_seconds: number;
    node_version: string;
    memory_rss_bytes: number;
    memory_heap_used_bytes: number;
    public_server_url: string;
    duckdns_configured: boolean;
    duckdns_domain: string | null;
  };
}

export async function diagnosticsRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  const getMachineReadableDiagnostics = async (): Promise<MachineReadableDiagnostics> => {
    const rawEnvConfig = config.aiostreamsUserConfig || '';
    const now = new Date();

    // 1. Storage Checks
    const nasHealth = await checkStorageHealth(config.nasCachePath);
    const backupHealth = await checkStorageHealth(config.backupPath);
    const backupStatus = backupService.getStatus();

    // 2. Servarr & Downloaders Checks
    const arrStatus = await arrService.getStatus();
    const sabnzbdStatus = await checkSabnzbdHealth();

    // 3. Provider Quotas Check
    const activeQuotas = await providerQuotas.getQuotas();

    // 4. Profiles
    let profiles: any[] = [];
    try {
      const pRows = db.prepare('SELECT id, name, aiostreams_config_override FROM profiles').all() as Partial<ProfileRow>[];
      profiles = pRows.map((p) => ({
        id: p.id,
        name: p.name,
        hasConfigOverride: Boolean(p.aiostreams_config_override),
        rawConfigOverride: p.aiostreams_config_override || null,
      }));
    } catch (_) {}

    // 5. AIOStreams Scraper Health
    let aioOnline = false;
    let aioStatusCode: number | null = null;
    let aioError: string | null = null;
    try {
      const healthUrl = `${config.aiostreamsInternalUrl}/api/v1/health`;
      const res = await undiciFetch(healthUrl, { signal: AbortSignal.timeout(3000) });
      aioOnline = res.ok;
      aioStatusCode = res.status;
    } catch (err: any) {
      try {
        const rootRes = await undiciFetch(config.aiostreamsInternalUrl, { signal: AbortSignal.timeout(3000) });
        aioOnline = rootRes.ok;
        aioStatusCode = rootRes.status;
      } catch (rootErr: any) {
        aioOnline = false;
        aioError = rootErr.message;
      }
    }

    // 6. Test Stream Resolution (Dune 2 / tt15239678)
    const profileOverride = profiles.find((p) => p.rawConfigOverride)?.rawConfigOverride;
    const testConfigInput = profileOverride || rawEnvConfig || appSettings.get('aiostreams_user_config') || '';
    let testStatus: 'PASS' | 'FAIL' | 'SKIPPED' = 'SKIPPED';
    let testStreamsCount = 0;
    let bestStreamInfo: any = null;
    let testError: string | null = null;

    if (!testConfigInput) {
      testStatus = 'SKIPPED';
    } else {
      try {
        const resolvedStreams = await aioStreams.resolveStreams('movie', 'tt15239678', testConfigInput);
        testStreamsCount = resolvedStreams.length;
        if (resolvedStreams.length > 0) {
          testStatus = 'PASS';
          bestStreamInfo = {
            name: resolvedStreams[0].name,
            title: resolvedStreams[0].title,
            resolution: resolvedStreams[0].badges?.resolution,
          };
        } else {
          testStatus = 'FAIL';
          testError = 'No streams returned for test media ID tt15239678';
        }
      } catch (err: any) {
        testStatus = 'FAIL';
        testError = err.message;
      }
    }

    // 7. Synthesize Machine-Readable Statuses & Issues
    const issues: string[] = [];
    const successes: string[] = [];

    // Storage Status Evaluation
    let nasStatus: 'PASS' | 'WARN' | 'FAIL' = 'PASS';
    if (!nasHealth.exists) {
      nasStatus = 'FAIL';
      issues.push(`NAS mount path '${config.nasCachePath}' does not exist on host.`);
    } else if (!nasHealth.writable) {
      nasStatus = 'FAIL';
      issues.push(`NAS mount path '${config.nasCachePath}' is read-only. Writable permissions required.`);
    } else {
      successes.push(`NAS storage accessible and writable (${nasHealth.free_text} free).`);
    }

    let backupStatusEval: 'PASS' | 'WARN' | 'FAIL' = 'PASS';
    if (!backupHealth.writable) {
      backupStatusEval = 'WARN';
      issues.push(`Backups path '${config.backupPath}' is not writable. Automated snapshots disabled.`);
    } else {
      successes.push(`Backup engine active at '${config.backupPath}' (Retention: ${backupStatus.retentionDays}d).`);
    }

    // Servarr Status Evaluation
    let radarrEval: 'PASS' | 'WARN' | 'FAIL' | 'UNCONFIGURED' = 'UNCONFIGURED';
    if (arrStatus.radarr.online) {
      radarrEval = 'PASS';
      successes.push(`Radarr online (v${arrStatus.radarr.version || '3'}).`);
    } else if (arrStatus.radarr.configured) {
      radarrEval = 'WARN';
      issues.push(`Radarr is configured but unreachable at '${arrStatus.radarr.url}'.`);
    }

    let sonarrEval: 'PASS' | 'WARN' | 'FAIL' | 'UNCONFIGURED' = 'UNCONFIGURED';
    if (arrStatus.sonarr.online) {
      sonarrEval = 'PASS';
      successes.push(`Sonarr online (v${arrStatus.sonarr.version || '3'}).`);
    } else if (arrStatus.sonarr.configured) {
      sonarrEval = 'WARN';
      issues.push(`Sonarr is configured but unreachable at '${arrStatus.sonarr.url}'.`);
    }

    let sabnzbdEval: 'PASS' | 'WARN' | 'FAIL' | 'UNCONFIGURED' = 'UNCONFIGURED';
    if (sabnzbdStatus.online) {
      sabnzbdEval = 'PASS';
      successes.push(`SABnzbd online (v${sabnzbdStatus.version}).`);
    } else if (config.easynewsUsername) {
      sabnzbdEval = 'WARN';
      issues.push(`SABnzbd unreachable at '${sabnzbdStatus.url}'.`);
    }

    let aioEval: 'PASS' | 'FAIL' = aioOnline ? 'PASS' : 'FAIL';
    if (aioOnline) {
      successes.push(`AIOStreams scraper engine reachable at '${config.aiostreamsInternalUrl}'.`);
    } else {
      issues.push(`AIOStreams scraper engine unreachable at '${config.aiostreamsInternalUrl}'.`);
    }

    const providerEval: 'PASS' | 'WARN' = activeQuotas.length > 0 ? 'PASS' : 'WARN';
    if (activeQuotas.length > 0) {
      successes.push(`Providers active: ${activeQuotas.map((q) => q.name).join(', ')}.`);
    } else {
      issues.push('No active stream providers (TorBox, Premiumize, Easynews, RealDebrid) detected in .env.');
    }

    // Global Health Calculation
    const isCritical = nasStatus === 'FAIL' || aioEval === 'FAIL';
    const isDegraded = issues.length > 0;
    const globalStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' = isCritical ? 'CRITICAL' : isDegraded ? 'DEGRADED' : 'HEALTHY';
    const healthy = globalStatus === 'HEALTHY';

    const mem = process.memoryUsage();

    return {
      healthy,
      status: globalStatus,
      timestamp: now.toISOString(),
      checks: {
        nas_storage: {
          status: nasStatus,
          path: nasHealth.path,
          exists: nasHealth.exists,
          writable: nasHealth.writable,
          free_bytes: nasHealth.free_bytes,
          total_bytes: nasHealth.total_bytes,
          used_bytes: nasHealth.used_bytes,
          percent_used: nasHealth.percent_used,
          free_text: nasHealth.free_text,
          error: nasHealth.error,
        },
        backup_storage: {
          status: backupStatusEval,
          path: backupHealth.path,
          exists: backupHealth.exists,
          writable: backupHealth.writable,
          last_backup_timestamp: backupStatus.lastGlobalBackupTime,
          retention_days: backupStatus.retentionDays,
          error: backupHealth.error,
        },
        radarr: {
          status: radarrEval,
          configured: arrStatus.radarr.configured,
          online: arrStatus.radarr.online,
          url: arrStatus.radarr.url,
          version: arrStatus.radarr.version || null,
          error: arrStatus.radarr.error || null,
        },
        sonarr: {
          status: sonarrEval,
          configured: arrStatus.sonarr.configured,
          online: arrStatus.sonarr.online,
          url: arrStatus.sonarr.url,
          version: arrStatus.sonarr.version || null,
          error: arrStatus.sonarr.error || null,
        },
        sabnzbd: {
          status: sabnzbdEval,
          online: sabnzbdStatus.online,
          url: sabnzbdStatus.url,
          version: sabnzbdStatus.version,
          error: sabnzbdStatus.error,
        },
        aiostreams: {
          status: aioEval,
          online: aioOnline,
          url: config.aiostreamsInternalUrl,
          status_code: aioStatusCode,
          error: aioError,
        },
        providers: {
          status: providerEval,
          count: activeQuotas.length,
          active: activeQuotas.map((q) => ({
            provider: q.provider,
            name: q.name,
            remaining_bytes: q.remainingBytes ?? null,
            remaining_text: q.remainingGbText,
            days_remaining: q.daysRemaining ?? null,
            status: q.status,
          })),
        },
        stream_resolution_test: {
          status: testStatus,
          target_title: 'Dune: Part Two (tt15239678)',
          stream_count: testStreamsCount,
          best_stream: bestStreamInfo,
          error: testError,
        },
      },
      issues,
      successes,
      metrics: {
        uptime_seconds: Math.floor(process.uptime()),
        node_version: process.version,
        memory_rss_bytes: mem.rss,
        memory_heap_used_bytes: mem.heapUsed,
        public_server_url: config.publicServerUrl,
        duckdns_configured: Boolean(config.duckdnsSubdomain && config.duckdnsToken),
        duckdns_domain: config.duckdnsSubdomain ? `${config.duckdnsSubdomain}.duckdns.org` : null,
      },
    };
  };

  // Render HTML visual dashboard
  const renderHtmlDashboard = (report: MachineReadableDiagnostics) => {
    const isHealthy = report.healthy;
    const statusColor = isHealthy ? '#10b981' : report.status === 'DEGRADED' ? '#f59e0b' : '#ef4444';
    const statusBg = isHealthy ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)';
    const statusTitle = isHealthy ? 'All Systems Operational' : `Status: ${report.status} (${report.issues.length} Issues)`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CineStream Stack Diagnostics</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f2937;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --accent: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --info: #3b82f6;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 24px;
    }
    .container { max-width: 1040px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--card-border);
    }
    h1 { font-size: 1.5rem; display: flex; align-items: center; gap: 8px; }
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-PASS { background: rgba(16, 185, 129, 0.2); color: var(--accent); }
    .badge-WARN { background: rgba(245, 158, 11, 0.2); color: var(--warning); }
    .badge-FAIL { background: rgba(239, 68, 68, 0.2); color: var(--danger); }
    .badge-UNCONFIGURED, .badge-SKIPPED { background: rgba(156, 163, 175, 0.2); color: var(--text-muted); }

    .status-banner {
      background: ${statusBg};
      border: 1px solid ${statusColor};
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 24px;
      display: flex;
      align-items: flex-start;
      gap: 16px;
    }
    .status-icon { font-size: 2rem; line-height: 1; }
    .status-content h2 { font-size: 1.15rem; color: ${statusColor}; margin-bottom: 4px; }
    .status-content p { color: var(--text-muted); font-size: 0.9rem; }

    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 18px;
    }
    .card h3 {
      font-size: 0.95rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .item-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      font-size: 0.88rem;
    }
    .item-row:last-child { border-bottom: none; }
    .label { color: var(--text-muted); }
    .value { font-weight: 500; text-align: right; word-break: break-all; }

    .action-box {
      background: #1e1e2d;
      border: 1px solid #2d2d3f;
      border-radius: 10px;
      padding: 18px;
      margin-bottom: 24px;
    }
    .action-box h3 { margin-bottom: 12px; font-size: 1rem; color: #fff; }
    .action-list { list-style: none; }
    .action-list li {
      padding: 8px 12px;
      margin-bottom: 6px;
      border-radius: 6px;
      font-size: 0.88rem;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .action-warning { background: rgba(245, 158, 11, 0.1); color: #fbbf24; border-left: 3px solid var(--warning); }
    .action-success { background: rgba(16, 185, 129, 0.1); color: #34d399; border-left: 3px solid var(--accent); }

    .btn-group { display: flex; gap: 10px; margin-top: 16px; }
    button, a.button {
      background: #2563eb;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    button.secondary, a.secondary { background: #374151; }
    button:hover, a.button:hover { opacity: 0.9; }
    pre {
      background: #000;
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 0.8rem;
      color: #a7f3d0;
      margin-top: 16px;
      display: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🎬 CineStream Diagnostics</h1>
      <div>
        <span class="badge ${report.healthy ? 'badge-PASS' : 'badge-WARN'}">${report.status}</span>
        <span style="font-size: 0.8rem; color: var(--text-muted); margin-left: 8px;">Checked: ${new Date(report.timestamp).toLocaleTimeString()}</span>
      </div>
    </header>

    <div class="status-banner">
      <div class="status-icon">${isHealthy ? '✅' : '⚠️'}</div>
      <div class="status-content">
        <h2>${statusTitle}</h2>
        <p>${isHealthy 
          ? 'All internal services, storage mounts, and scraper engines are connected and functioning properly.' 
          : 'Some items require attention. Check the issues list below.'}</p>
      </div>
    </div>

    <!-- Actionable Summary -->
    <div class="action-box">
      <h3>Stack Diagnosis & Health Checks</h3>
      <ul class="action-list">
        ${report.issues.map((w: string) => `<li class="action-warning">⚠️ ${w}</li>`).join('')}
        ${report.successes.map((s: string) => `<li class="action-success">✓ ${s}</li>`).join('')}
      </ul>
      <div class="btn-group">
        <button onclick="window.location.reload()">🔄 Refresh Checks</button>
        <button class="secondary" onclick="triggerBackup()">💾 Run Full Backup Snapshot</button>
        <a class="button secondary" href="/api/diagnostics" target="_blank">📋 Raw Machine JSON</a>
        <button class="secondary" onclick="toggleJson()">🔍 View In-Page JSON</button>
      </div>
      <pre id="jsonDump">${JSON.stringify(report, null, 2)}</pre>
    </div>

    <div class="grid">
      <!-- Storage Card -->
      <div class="card">
        <h3>Storage & Mounts <span class="badge badge-${report.checks.nas_storage.status}">${report.checks.nas_storage.status}</span></h3>
        <div class="item-row"><span class="label">NAS Mount Path</span><span class="value"><code>${report.checks.nas_storage.path}</code></span></div>
        <div class="item-row"><span class="label">NAS Free Space</span><span class="value">${report.checks.nas_storage.free_text} (${report.checks.nas_storage.percent_used}% Used)</span></div>
        <div class="item-row"><span class="label">Backups Path</span><span class="value"><code>${report.checks.backup_storage.path}</code></span></div>
        <div class="item-row"><span class="label">Backup Retention</span><span class="value">${report.checks.backup_storage.retention_days} Days</span></div>
        <div class="item-row"><span class="label">Last Backup Snapshot</span><span class="value">${report.checks.backup_storage.last_backup_timestamp ? new Date(report.checks.backup_storage.last_backup_timestamp).toLocaleDateString() : 'Pending'}</span></div>
      </div>

      <!-- Servarr Ecosystem -->
      <div class="card">
        <h3>Servarr Stack <span class="badge badge-${report.checks.radarr.online && report.checks.sonarr.online ? 'PASS' : 'WARN'}">Ecosystem</span></h3>
        <div class="item-row"><span class="label">Radarr (Movies)</span><span class="value">${report.checks.radarr.online ? `🟢 Online (v${report.checks.radarr.version})` : '⚪ ' + (report.checks.radarr.error || 'Unconfigured')}</span></div>
        <div class="item-row"><span class="label">Sonarr (TV Shows)</span><span class="value">${report.checks.sonarr.online ? `🟢 Online (v${report.checks.sonarr.version})` : '⚪ ' + (report.checks.sonarr.error || 'Unconfigured')}</span></div>
        <div class="item-row"><span class="label">SABnzbd (Usenet)</span><span class="value">${report.checks.sabnzbd.online ? `🟢 Online (v${report.checks.sabnzbd.version})` : '⚪ ' + (report.checks.sabnzbd.error || 'Unconfigured')}</span></div>
        <div class="item-row"><span class="label">Radarr URL</span><span class="value"><code>${report.checks.radarr.url}</code></span></div>
        <div class="item-row"><span class="label">Sonarr URL</span><span class="value"><code>${report.checks.sonarr.url}</code></span></div>
      </div>

      <!-- Cloud Providers -->
      <div class="card">
        <h3>Active Stream Providers <span class="badge badge-${report.checks.providers.status}">${report.checks.providers.count} Active</span></h3>
        ${report.checks.providers.count === 0 ? '<div class="item-row"><span class="label">Status</span><span class="value">None configured in .env</span></div>' : ''}
        ${report.checks.providers.active.map((q: any) => `
          <div class="item-row"><span class="label">${q.name}</span><span class="value">🟢 ${q.remaining_text}</span></div>
        `).join('')}
        <div class="item-row"><span class="label">TMDB Metadata</span><span class="value">${config.tmdbApiKey ? '🟢 Connected' : '⚪ Unconfigured'}</span></div>
      </div>

      <!-- Network & AIOStreams -->
      <div class="card">
        <h3>Network & Scrapers <span class="badge badge-${report.checks.aiostreams.status}">${report.checks.aiostreams.status}</span></h3>
        <div class="item-row"><span class="label">Public Access URL</span><span class="value"><a href="${report.metrics.public_server_url}" target="_blank" style="color:#60a5fa">${report.metrics.public_server_url}</a></span></div>
        <div class="item-row"><span class="label">DuckDNS Domain</span><span class="value">${report.metrics.duckdns_domain || 'Not Configured (LAN mode)'}</span></div>
        <div class="item-row"><span class="label">AIOStreams Internal</span><span class="value">${report.checks.aiostreams.online ? `🟢 Reachable (${report.checks.aiostreams.url})` : '🔴 Unreachable'}</span></div>
        <div class="item-row"><span class="label">Test Scrape (Dune 2)</span><span class="value">${report.checks.stream_resolution_test.status === 'PASS' ? `🟢 ${report.checks.stream_resolution_test.stream_count} Streams Found` : '⚪ ' + report.checks.stream_resolution_test.status}</span></div>
      </div>
    </div>
  </div>

  <script>
    function toggleJson() {
      const el = document.getElementById('jsonDump');
      el.style.display = el.style.display === 'block' ? 'none' : 'block';
    }
    async function triggerBackup() {
      if (!confirm('Run an immediate full stack configuration backup snapshot?')) return;
      try {
        const res = await fetch('/api/backup/run', { method: 'POST' });
        const json = await res.json();
        alert(json.message || 'Backup executed!');
        window.location.reload();
      } catch (e) {
        alert('Backup failed: ' + e.message);
      }
    }
  </script>
</body>
</html>`;
  };

  // 1. Strictly machine-readable JSON endpoint (RFC health check compatible)
  fastify.get('/api/diagnostics', async (req: FastifyRequest, reply: FastifyReply) => {
    const report = await getMachineReadableDiagnostics();
    const query = req.query as { strict?: string; fail_on_error?: string };
    const failOnError = query?.strict === 'true' || query?.strict === '1' || query?.fail_on_error === 'true' || query?.fail_on_error === '1';

    reply.type('application/json; charset=utf-8');
    if (failOnError && !report.healthy) {
      return reply.status(503).send(report);
    }
    return reply.status(200).send(report);
  });

  // 2. Direct Human-readable Visual Dashboard
  fastify.get('/diagnostics', async (_req: FastifyRequest, reply: FastifyReply) => {
    const report = await getMachineReadableDiagnostics();
    reply.type('text/html; charset=utf-8');
    return reply.send(renderHtmlDashboard(report));
  });
}
