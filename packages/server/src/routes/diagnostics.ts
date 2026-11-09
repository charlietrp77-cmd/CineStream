import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';
import { fetch as undiciFetch } from 'undici';
import { config } from '../config';
import { db } from '../db';
import { ProfileRow } from '../db/schema';
import { aioStreams, buildStreamUrls } from '../services/aiostreams';
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
  totalBytes?: number;
  freeBytes?: number;
  usedBytes?: number;
  percentUsed?: number;
  freeText?: string;
  error?: string;
}> {
  const result: any = { path: dirPath, exists: false, writable: false };
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
          result.totalBytes = total;
          result.freeBytes = free;
          result.usedBytes = used;
          result.percentUsed = total > 0 ? Math.round((used / total) * 100) : 0;
          result.freeText = formatBytes(free);
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
  version?: string;
  serversCount?: number;
  error?: string;
}> {
  const sabKey = appSettings.get('sabnzbd_api_key');
  const url = 'http://sabnzbd:8080';
  if (!sabKey) {
    return { online: false, url, error: 'No SABnzbd API key configured yet' };
  }
  try {
    const res = await undiciFetch(`${url}/api?mode=version&output=json&apikey=${sabKey}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const json: any = await res.json();
      return { online: true, url, version: json.version || 'Active' };
    }
    return { online: false, url, error: `HTTP ${res.status}` };
  } catch (err: any) {
    return { online: false, url, error: err.message || 'Connection failed' };
  }
}

export async function diagnosticsRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  const getFullDiagnosticReport = async () => {
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
    let aiostreamsHealth: any = null;
    try {
      const healthUrl = `${config.aiostreamsInternalUrl}/api/v1/health`;
      const res = await undiciFetch(healthUrl, { signal: AbortSignal.timeout(3000) });
      aiostreamsHealth = { url: healthUrl, statusCode: res.status, ok: res.ok };
    } catch (err: any) {
      try {
        const rootRes = await undiciFetch(config.aiostreamsInternalUrl, { signal: AbortSignal.timeout(3000) });
        aiostreamsHealth = { url: config.aiostreamsInternalUrl, statusCode: rootRes.status, ok: rootRes.ok };
      } catch (rootErr: any) {
        aiostreamsHealth = { url: config.aiostreamsInternalUrl, ok: false, error: rootErr.message };
      }
    }

    // 6. Test Stream Resolution (Dune 2 / tt15239678)
    const profileOverride = profiles.find((p) => p.rawConfigOverride)?.rawConfigOverride;
    const testConfigInput = profileOverride || rawEnvConfig || appSettings.get('aiostreams_user_config') || '';
    let testStreamResult: any = null;

    if (!testConfigInput) {
      testStreamResult = {
        status: 'skipped',
        message: 'No AIOStreams config token found yet. Configure AIOStreams at http://your-ip:3001 or provide in .env.',
      };
    } else {
      try {
        const resolvedStreams = await aioStreams.resolveStreams('movie', 'tt15239678', testConfigInput);
        testStreamResult = {
          status: resolvedStreams.length > 0 ? 'success' : 'no_streams',
          count: resolvedStreams.length,
          bestStream: resolvedStreams.length > 0 ? {
            name: resolvedStreams[0].name,
            title: resolvedStreams[0].title,
            badges: resolvedStreams[0].badges,
          } : null,
        };
      } catch (err: any) {
        testStreamResult = { status: 'error', error: err.message };
      }
    }

    // 7. Synthesize Actionable Warnings & Recommendations
    const warnings: string[] = [];
    const successes: string[] = [];

    if (!nasHealth.exists) {
      warnings.push(`NAS Path (${config.nasCachePath}) does not exist. Verify NAS_HOST_PATH in your .env file.`);
    } else if (!nasHealth.writable) {
      warnings.push(`NAS Path (${config.nasCachePath}) is read-only. Fix permissions by running: sudo chown -R 1000:1000 ${config.nasCachePath}`);
    } else {
      successes.push(`NAS media storage mounted and writable (${nasHealth.freeText || 'Healthy'} available).`);
    }

    if (!backupHealth.writable) {
      warnings.push(`Backups folder (${config.backupPath}) is not writable. Automated daily snapshots may fail.`);
    } else {
      successes.push(`Automated config backup storage mounted and active at ${config.backupPath}.`);
    }

    if (arrStatus.radarr.online) {
      successes.push(`Radarr (v${arrStatus.radarr.version || '3'}) connected and healthy on internal network.`);
    } else if (arrStatus.radarr.configured) {
      warnings.push(`Radarr is configured but currently unreachable at ${arrStatus.radarr.url}. (If container just booted, allow 30s).`);
    }

    if (arrStatus.sonarr.online) {
      successes.push(`Sonarr (v${arrStatus.sonarr.version || '3'}) connected and healthy on internal network.`);
    } else if (arrStatus.sonarr.configured) {
      warnings.push(`Sonarr is configured but currently unreachable at ${arrStatus.sonarr.url}. (If container just booted, allow 30s).`);
    }

    if (sabnzbdStatus.online) {
      successes.push(`SABnzbd (v${sabnzbdStatus.version}) online for zero-touch Usenet handling.`);
    }

    if (aiostreamsHealth?.ok) {
      successes.push(`AIOStreams scraping engine online at ${config.aiostreamsInternalUrl}.`);
    } else {
      warnings.push(`AIOStreams is unreachable at ${config.aiostreamsInternalUrl}. Verify container status in Portainer.`);
    }

    if (activeQuotas.length > 0) {
      successes.push(`Active stream providers detected: ${activeQuotas.map((q) => `${q.name} (${q.remainingGbText})`).join(', ')}.`);
    } else {
      warnings.push('No active debrid or Usenet stream providers detected. Enter credentials in .env.');
    }

    return {
      timestamp: now.toISOString(),
      overallStatus: warnings.length === 0 ? 'healthy' : 'action_required',
      summary: {
        totalChecks: successes.length + warnings.length,
        warningsCount: warnings.length,
        successesCount: successes.length,
      },
      actionableFeedback: {
        warnings,
        successes,
      },
      system: {
        nodeVersion: process.version,
        uptimeSeconds: Math.floor(process.uptime()),
        publicServerUrl: config.publicServerUrl,
        duckdnsConfigured: Boolean(config.duckdnsSubdomain && config.duckdnsToken),
        duckdnsDomain: config.duckdnsSubdomain ? `${config.duckdnsSubdomain}.duckdns.org` : null,
      },
      storage: {
        nas: nasHealth,
        backups: {
          ...backupHealth,
          lastGlobalBackupTime: backupStatus.lastGlobalBackupTime,
          retentionDays: backupStatus.retentionDays,
          snapshots: backupStatus.services,
        },
      },
      servarr: {
        radarr: arrStatus.radarr,
        sonarr: arrStatus.sonarr,
        sabnzbd: sabnzbdStatus,
      },
      streamProviders: {
        configuredProviders: activeQuotas,
        tmdbConfigured: Boolean(config.tmdbApiKey),
        aiostreamsHealth,
        testStreamResult,
      },
    };
  };

  // Human-readable visual HTML dashboard
  const renderHtmlDashboard = (report: any) => {
    const isHealthy = report.overallStatus === 'healthy';
    const statusColor = isHealthy ? '#10b981' : '#f59e0b';
    const statusBg = isHealthy ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)';
    const statusTitle = isHealthy ? 'All Systems Operational' : `${report.summary.warningsCount} Action Item(s) Detected`;

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
    .badge-success { background: rgba(16, 185, 129, 0.2); color: var(--accent); }
    .badge-warning { background: rgba(245, 158, 11, 0.2); color: var(--warning); }
    .badge-danger { background: rgba(239, 68, 68, 0.2); color: var(--danger); }
    .badge-info { background: rgba(59, 130, 246, 0.2); color: var(--info); }
    
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
        <span class="badge badge-info">v1.0.0</span>
        <span style="font-size: 0.8rem; color: var(--text-muted); margin-left: 8px;">Checked: ${new Date(report.timestamp).toLocaleTimeString()}</span>
      </div>
    </header>

    <div class="status-banner">
      <div class="status-icon">${isHealthy ? '✅' : '⚠️'}</div>
      <div class="status-content">
        <h2>${statusTitle}</h2>
        <p>${isHealthy 
          ? 'All internal services, unified NAS mounts, and scraper scrapers are connected and functioning properly.' 
          : 'Some items require attention. Check the action items below to complete your setup.'}</p>
      </div>
    </div>

    <!-- Actionable Summary -->
    <div class="action-box">
      <h3>Stack Diagnosis & Health Checks</h3>
      <ul class="action-list">
        ${report.actionableFeedback.warnings.map((w: string) => `<li class="action-warning">⚠️ ${w}</li>`).join('')}
        ${report.actionableFeedback.successes.map((s: string) => `<li class="action-success">✓ ${s}</li>`).join('')}
      </ul>
      <div class="btn-group">
        <button onclick="window.location.reload()">🔄 Refresh Checks</button>
        <button class="secondary" onclick="triggerBackup()">💾 Run Full Backup Snapshot</button>
        <button class="secondary" onclick="toggleJson()">🔍 View Raw JSON</button>
      </div>
      <pre id="jsonDump">${JSON.stringify(report, null, 2)}</pre>
    </div>

    <div class="grid">
      <!-- Storage Card -->
      <div class="card">
        <h3>Storage & Mounts <span class="badge ${report.storage.nas.writable ? 'badge-success' : 'badge-danger'}">${report.storage.nas.writable ? 'Writable' : 'Error'}</span></h3>
        <div class="item-row"><span class="label">NAS Mount Path</span><span class="value"><code>${report.storage.nas.path}</code></span></div>
        <div class="item-row"><span class="label">NAS Free Space</span><span class="value">${report.storage.nas.freeText || 'N/A'}</span></div>
        <div class="item-row"><span class="label">Backups Path</span><span class="value"><code>${report.storage.backups.path}</code></span></div>
        <div class="item-row"><span class="label">Backup Retention</span><span class="value">${report.storage.backups.retentionDays} Days</span></div>
        <div class="item-row"><span class="label">Last Backup Snapshot</span><span class="value">${report.storage.backups.lastGlobalBackupTime ? new Date(report.storage.backups.lastGlobalBackupTime).toLocaleDateString() : 'Pending'}</span></div>
      </div>

      <!-- Servarr Ecosystem -->
      <div class="card">
        <h3>Servarr Stack <span class="badge ${report.servarr.radarr.online && report.servarr.sonarr.online ? 'badge-success' : 'badge-warning'}">Ecosystem</span></h3>
        <div class="item-row"><span class="label">Radarr (Movies)</span><span class="value">${report.servarr.radarr.online ? `🟢 Online (v${report.servarr.radarr.version})` : '⚪ Not Connected'}</span></div>
        <div class="item-row"><span class="label">Sonarr (TV Shows)</span><span class="value">${report.servarr.sonarr.online ? `🟢 Online (v${report.servarr.sonarr.version})` : '⚪ Not Connected'}</span></div>
        <div class="item-row"><span class="label">SABnzbd (Usenet)</span><span class="value">${report.servarr.sabnzbd.online ? `🟢 Online (v${report.servarr.sabnzbd.version})` : '⚪ Not Connected'}</span></div>
        <div class="item-row"><span class="label">Radarr URL</span><span class="value"><code>${report.servarr.radarr.url}</code></span></div>
        <div class="item-row"><span class="label">Sonarr URL</span><span class="value"><code>${report.servarr.sonarr.url}</code></span></div>
      </div>

      <!-- Cloud Providers -->
      <div class="card">
        <h3>Active Stream Providers <span class="badge badge-info">${report.streamProviders.configuredProviders.length} Configured</span></h3>
        ${report.streamProviders.configuredProviders.length === 0 ? '<div class="item-row"><span class="label">Status</span><span class="value">None configured in .env</span></div>' : ''}
        ${report.streamProviders.configuredProviders.map((q: any) => `
          <div class="item-row"><span class="label">${q.name}</span><span class="value">🟢 ${q.remainingGbText} (${q.plan || 'Active'})</span></div>
        `).join('')}
        <div class="item-row"><span class="label">TMDB Metadata</span><span class="value">${report.streamProviders.tmdbConfigured ? '🟢 Connected' : '⚪ Unconfigured'}</span></div>
      </div>

      <!-- Network & AIOStreams -->
      <div class="card">
        <h3>Network & Scraper Engine</h3>
        <div class="item-row"><span class="label">Public Access URL</span><span class="value"><a href="${report.system.publicServerUrl}" target="_blank" style="color:#60a5fa">${report.system.publicServerUrl}</a></span></div>
        <div class="item-row"><span class="label">DuckDNS Domain</span><span class="value">${report.system.duckdnsDomain || 'Not Configured (LAN mode)'}</span></div>
        <div class="item-row"><span class="label">AIOStreams Internal</span><span class="value">${report.streamProviders.aiostreamsHealth?.ok ? '🟢 Reachable (:3000)' : '🔴 Unreachable'}</span></div>
        <div class="item-row"><span class="label">Test Scrape (Dune 2)</span><span class="value">${report.streamProviders.testStreamResult?.status === 'success' ? `🟢 ${report.streamProviders.testStreamResult.count} Streams Found` : '⚪ ' + (report.streamProviders.testStreamResult?.message || 'No streams')}</span></div>
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

  // 1. JSON API endpoint
  fastify.get('/api/diagnostics', async (req: FastifyRequest, reply: FastifyReply) => {
    const report = await getFullDiagnosticReport();
    if (req.headers.accept?.includes('text/html')) {
      reply.type('text/html');
      return reply.send(renderHtmlDashboard(report));
    }
    return reply.send(report);
  });

  // 2. Direct Web Visual Dashboard at /diagnostics
  fastify.get('/diagnostics', async (_req: FastifyRequest, reply: FastifyReply) => {
    const report = await getFullDiagnosticReport();
    reply.type('text/html');
    return reply.send(renderHtmlDashboard(report));
  });
}
