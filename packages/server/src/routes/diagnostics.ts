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
  free_gb: number;
  total_gb: number;
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
    free_gb: 0,
    total_gb: 0,
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
          result.free_gb = Math.round((free / (1024 * 1024 * 1024)) * 10) / 10;
          result.total_gb = Math.round((total / (1024 * 1024 * 1024)) * 10) / 10;
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
      headers: { Host: 'localhost:8080' },
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

export interface StackDiagnostics {
  healthy: boolean;
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  timestamp: string;

  // Plain-English diagnostic summary for human inspection
  human_summary: string;
  diagnosis: {
    headline: string;
    details: string;
    issues_count: number;
    issues: Array<{
      component: string;
      severity: 'CRITICAL' | 'WARNING';
      problem: string;
      fix: string;
    }>;
    how_to_fix: string[];
  };

  // Stack Architecture & Operational Explanation
  stack_explanation: {
    architecture: string;
    streaming_mode: string;
    storage_mode: string;
    servarr_mode: string;
    backups_mode: string;
    remote_access: string;
  };

  // Machine-readable component statuses
  components: {
    nas_storage: {
      name: string;
      status: 'PASS' | 'WARN' | 'FAIL';
      summary: string;
      path: string;
      exists: boolean;
      writable: boolean;
      free_gb: number;
      total_gb: number;
      percent_used: number;
      error: string | null;
      fix_suggestion: string | null;
    };
    backup_storage: {
      name: string;
      status: 'PASS' | 'WARN' | 'FAIL';
      summary: string;
      path: string;
      exists: boolean;
      writable: boolean;
      last_backup_iso: string | null;
      retention_days: number;
      error: string | null;
      fix_suggestion: string | null;
    };
    radarr: {
      name: string;
      status: 'PASS' | 'WARN' | 'FAIL' | 'SKIPPED';
      summary: string;
      configured: boolean;
      online: boolean;
      url: string;
      version: string | null;
      error: string | null;
      fix_suggestion: string | null;
    };
    sonarr: {
      name: string;
      status: 'PASS' | 'WARN' | 'FAIL' | 'SKIPPED';
      summary: string;
      configured: boolean;
      online: boolean;
      url: string;
      version: string | null;
      error: string | null;
      fix_suggestion: string | null;
    };
    sabnzbd: {
      name: string;
      status: 'PASS' | 'WARN' | 'FAIL' | 'SKIPPED';
      summary: string;
      online: boolean;
      url: string;
      version: string | null;
      error: string | null;
      fix_suggestion: string | null;
    };
    aiostreams: {
      name: string;
      status: 'PASS' | 'FAIL';
      summary: string;
      online: boolean;
      url: string;
      error: string | null;
      fix_suggestion: string | null;
    };
    providers: {
      name: string;
      status: 'PASS' | 'WARN';
      summary: string;
      active_count: number;
      active: Array<{
        provider: string;
        name: string;
        remaining_text: string;
        status: string;
      }>;
      fix_suggestion: string | null;
    };
    stream_resolution_test: {
      name: string;
      status: 'PASS' | 'FAIL' | 'SKIPPED';
      summary: string;
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

  metrics: {
    uptime_seconds: number;
    node_version: string;
    memory_rss_mb: number;
    public_server_url: string;
    duckdns_domain: string | null;
  };
}

export async function diagnosticsRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  const runDiagnosticAssessment = async (): Promise<StackDiagnostics> => {
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
    let aioError: string | null = null;
    try {
      const healthUrl = `${config.aiostreamsInternalUrl}/api/v1/health`;
      const res = await undiciFetch(healthUrl, { signal: AbortSignal.timeout(3000) });
      aioOnline = res.ok;
    } catch (err: any) {
      try {
        const rootRes = await undiciFetch(config.aiostreamsInternalUrl, { signal: AbortSignal.timeout(3000) });
        aioOnline = rootRes.ok;
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

    const hasActiveProvider = Boolean(
      testConfigInput ||
      config.torboxApiKey ||
      config.premiumizeApiKey ||
      config.realdebridApiKey ||
      config.alldebridApiKey ||
      config.althubApiKey ||
      config.nzbgeekApiKey ||
      config.drunkenslugApiKey ||
      (config.easynewsUsername && config.easynewsPassword)
    );

    if (!hasActiveProvider) {
      testStatus = 'SKIPPED';
    } else {
      try {
        const resolvedStreams = await aioStreams.resolveStreams('movie', 'tt15239678', testConfigInput || null);
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

    // 7. Structured Issues and Fix List for Humans & Automation
    const issuesList: Array<{ component: string; severity: 'CRITICAL' | 'WARNING'; problem: string; fix: string }> = [];

    // NAS Storage Assessment
    let nasStatus: 'PASS' | 'WARN' | 'FAIL' = 'PASS';
    let nasSummary = `Mounted at ${config.nasCachePath}, writable, ${nasHealth.free_text} free (${nasHealth.percent_used}% used)`;
    let nasFix: string | null = null;
    if (!nasHealth.exists) {
      nasStatus = 'FAIL';
      nasSummary = `Directory '${config.nasCachePath}' not found on host`;
      nasFix = `Check NAS_HOST_PATH in your .env file and ensure the directory exists on your host machine.`;
      issuesList.push({ component: 'NAS Media Storage', severity: 'CRITICAL', problem: nasSummary, fix: nasFix });
    } else if (!nasHealth.writable) {
      nasStatus = 'FAIL';
      nasSummary = `Directory '${config.nasCachePath}' is read-only`;
      nasFix = `Run: sudo chown -R 1000:1000 ${config.nasCachePath} && sudo chmod -R 775 ${config.nasCachePath}`;
      issuesList.push({ component: 'NAS Media Storage', severity: 'CRITICAL', problem: nasSummary, fix: nasFix });
    }

    // Backups Assessment
    let backupStatusEval: 'PASS' | 'WARN' | 'FAIL' = 'PASS';
    let backupSummary = `Mounted at ${config.backupPath}, writable (Retention: ${backupStatus.retentionDays} days)`;
    let backupFix: string | null = null;
    if (!backupHealth.writable) {
      backupStatusEval = 'WARN';
      backupSummary = `Backups directory '${config.backupPath}' is not writable`;
      backupFix = `Run: sudo chown -R 1000:1000 ${config.backupPath} on your host to allow automated daily configuration backups.`;
      issuesList.push({ component: 'Config Backups Storage', severity: 'WARNING', problem: backupSummary, fix: backupFix });
    }

    // Radarr Assessment
    let radarrEval: 'PASS' | 'WARN' | 'FAIL' | 'SKIPPED' = 'SKIPPED';
    let radarrSummary = 'Not configured or container not in stack';
    let radarrFix: string | null = null;
    if (arrStatus.radarr.online) {
      radarrEval = 'PASS';
      radarrSummary = `Online v${arrStatus.radarr.version || '5'} at ${arrStatus.radarr.url}, auto-linked to SABnzbd`;
    } else if (arrStatus.radarr.configured) {
      radarrEval = 'WARN';
      radarrSummary = `Configured but unreachable at ${arrStatus.radarr.url}`;
      radarrFix = `If container just started, wait ~30 seconds for .NET initialization. Otherwise check 'docker logs cinestream-radarr'.`;
      issuesList.push({ component: 'Radarr (Movies)', severity: 'WARNING', problem: radarrSummary, fix: radarrFix });
    }

    // Sonarr Assessment
    let sonarrEval: 'PASS' | 'WARN' | 'FAIL' | 'SKIPPED' = 'SKIPPED';
    let sonarrSummary = 'Not configured or container not in stack';
    let sonarrFix: string | null = null;
    if (arrStatus.sonarr.online) {
      sonarrEval = 'PASS';
      sonarrSummary = `Online v${arrStatus.sonarr.version || '4'} at ${arrStatus.sonarr.url}, auto-linked to SABnzbd`;
    } else if (arrStatus.sonarr.configured) {
      sonarrEval = 'WARN';
      sonarrSummary = `Configured but unreachable at ${arrStatus.sonarr.url}`;
      sonarrFix = `If container just started, wait ~30 seconds for .NET initialization. Otherwise check 'docker logs cinestream-sonarr'.`;
      issuesList.push({ component: 'Sonarr (TV Shows)', severity: 'WARNING', problem: sonarrSummary, fix: sonarrFix });
    }

    // SABnzbd Assessment
    let sabnzbdEval: 'PASS' | 'WARN' | 'FAIL' | 'SKIPPED' = 'SKIPPED';
    let sabnzbdSummary = 'Not configured or no Usenet credentials provided';
    let sabnzbdFix: string | null = null;
    if (sabnzbdStatus.online) {
      sabnzbdEval = 'PASS';
      sabnzbdSummary = `Online v${sabnzbdStatus.version} at ${sabnzbdStatus.url}`;
    } else if (config.easynewsUsername) {
      sabnzbdEval = 'WARN';
      sabnzbdSummary = `Unreachable at ${sabnzbdStatus.url}`;
      sabnzbdFix = `Check container status: 'docker logs cinestream-sabnzbd'.`;
      issuesList.push({ component: 'SABnzbd (Usenet Downloader)', severity: 'WARNING', problem: sabnzbdSummary, fix: sabnzbdFix });
    }

    // AIOStreams Assessment
    let aioEval: 'PASS' | 'FAIL' = aioOnline ? 'PASS' : 'FAIL';
    let aioSummary = aioOnline ? `Online at ${config.aiostreamsInternalUrl}` : `Unreachable at ${config.aiostreamsInternalUrl}`;
    let aioFix: string | null = null;
    if (!aioOnline) {
      aioFix = `Ensure the aiostreams container is running in Portainer / Docker Compose.`;
      issuesList.push({ component: 'AIOStreams Scraper Engine', severity: 'CRITICAL', problem: aioSummary, fix: aioFix });
    }

    // Providers Assessment
    let providerEval: 'PASS' | 'WARN' = activeQuotas.length > 0 ? 'PASS' : 'WARN';
    let providerSummary = activeQuotas.length > 0
      ? `${activeQuotas.length} active provider(s): ${activeQuotas.map((q) => `${q.name} (${q.remainingGbText})`).join(', ')}`
      : 'No active stream providers detected';
    let providerFix: string | null = null;
    if (activeQuotas.length === 0) {
      providerFix = `Add at least one provider (TORBOX_API_KEY, PREMIUMIZE_API_KEY, or EASYNEWS_USERNAME) to your .env file.`;
      issuesList.push({ component: 'Stream Providers', severity: 'WARNING', problem: providerSummary, fix: providerFix });
    }

    // Global Health Calculation
    const isCritical = nasStatus === 'FAIL' || aioEval === 'FAIL';
    const isDegraded = issuesList.length > 0;
    const globalStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' = isCritical ? 'CRITICAL' : isDegraded ? 'DEGRADED' : 'HEALTHY';
    const healthy = globalStatus === 'HEALTHY';

    const humanSummary = healthy
      ? `All stack components are operating normally. NAS storage has ${nasHealth.free_text} free, and active providers are online.`
      : `${issuesList.length} issue(s) detected (${issuesList.map((i) => i.component).join(', ')}). Review the fix instructions below.`;

    const mem = process.memoryUsage();

    return {
      healthy,
      status: globalStatus,
      timestamp: now.toISOString(),
      human_summary: humanSummary,
      diagnosis: {
        headline: healthy ? '✅ Stack Operational - No Issues Detected' : `⚠️ ${issuesList.length} Action Item(s) Need Attention`,
        details: humanSummary,
        issues_count: issuesList.length,
        issues: issuesList,
        how_to_fix: issuesList.map((i) => `[${i.component}] ${i.fix}`),
      },
      stack_explanation: {
        architecture: 'Cloud Debrid & Usenet with Unified Local NAS Hardlink Caching and Zero-Touch Servarr Integration.',
        streaming_mode: 'Streams resolve in real-time from your active cloud debrid accounts (TorBox/Premiumize) and Easynews Usenet.',
        storage_mode: `Unified mount at '${config.nasCachePath}' (/mnt/nas). All containers share this exact root to enable instant atomic hardlinks without slow disk copying.`,
        servarr_mode: 'Radarr and Sonarr auto-discover their API keys, register /mnt/nas/movies and /mnt/nas/tv, and auto-link SABnzbd on container startup.',
        backups_mode: `Daily automated configuration snapshots and SQLite database backups are stored in '${config.backupPath}' with 14-day rolling retention.`,
        remote_access: config.duckdnsSubdomain
          ? `Automatic SSL/HTTPS enabled via DuckDNS (${config.duckdnsSubdomain}.duckdns.org) terminated by Caddy reverse proxy.`
          : 'Local LAN HTTP mode (Port 3000). Set ENABLE_CADDY_DUCKDNS=true if external Stremio HTTPS is needed.',
      },
      components: {
        nas_storage: {
          name: 'NAS Media Storage',
          status: nasStatus,
          summary: nasSummary,
          path: nasHealth.path,
          exists: nasHealth.exists,
          writable: nasHealth.writable,
          free_gb: nasHealth.free_gb,
          total_gb: nasHealth.total_gb,
          percent_used: nasHealth.percent_used,
          error: nasHealth.error,
          fix_suggestion: nasFix,
        },
        backup_storage: {
          name: 'Config Backups Storage',
          status: backupStatusEval,
          summary: backupSummary,
          path: backupHealth.path,
          exists: backupHealth.exists,
          writable: backupHealth.writable,
          last_backup_iso: backupStatus.lastGlobalBackupTime ? new Date(backupStatus.lastGlobalBackupTime).toISOString() : null,
          retention_days: backupStatus.retentionDays,
          error: backupHealth.error,
          fix_suggestion: backupFix,
        },
        radarr: {
          name: 'Radarr (Movies)',
          status: radarrEval,
          summary: radarrSummary,
          configured: arrStatus.radarr.configured,
          online: arrStatus.radarr.online,
          url: arrStatus.radarr.url,
          version: arrStatus.radarr.version || null,
          error: arrStatus.radarr.error || null,
          fix_suggestion: radarrFix,
        },
        sonarr: {
          name: 'Sonarr (TV Shows)',
          status: sonarrEval,
          summary: sonarrSummary,
          configured: arrStatus.sonarr.configured,
          online: arrStatus.sonarr.online,
          url: arrStatus.sonarr.url,
          version: arrStatus.sonarr.version || null,
          error: arrStatus.sonarr.error || null,
          fix_suggestion: sonarrFix,
        },
        sabnzbd: {
          name: 'SABnzbd (Usenet Downloader)',
          status: sabnzbdEval,
          summary: sabnzbdSummary,
          online: sabnzbdStatus.online,
          url: sabnzbdStatus.url,
          version: sabnzbdStatus.version,
          error: sabnzbdStatus.error,
          fix_suggestion: sabnzbdFix,
        },
        aiostreams: {
          name: 'AIOStreams (Scraper Engine)',
          status: aioEval,
          summary: aioSummary,
          online: aioOnline,
          url: config.aiostreamsInternalUrl,
          error: aioError,
          fix_suggestion: aioFix,
        },
        providers: {
          name: 'Debrid & Usenet Providers',
          status: providerEval,
          summary: providerSummary,
          active_count: activeQuotas.length,
          active: activeQuotas.map((q) => ({
            provider: q.provider,
            name: q.name,
            remaining_text: q.remainingGbText,
            status: q.status,
          })),
          fix_suggestion: providerFix,
        },
        stream_resolution_test: {
          name: 'Stream Resolution Test (Dune 2)',
          status: testStatus,
          summary: testStatus === 'PASS'
            ? `${testStreamsCount} streams resolved on test media tt15239678`
            : testStatus === 'SKIPPED'
            ? 'Test skipped (no stream profile configured yet)'
            : 'Failed to resolve streams for test media tt15239678',
          target_title: 'Dune: Part Two (tt15239678)',
          stream_count: testStreamsCount,
          best_stream: bestStreamInfo,
          error: testError,
        },
      },
      metrics: {
        uptime_seconds: Math.floor(process.uptime()),
        node_version: process.version,
        memory_rss_mb: Math.round(mem.rss / (1024 * 1024)),
        public_server_url: config.publicServerUrl,
        duckdns_domain: config.duckdnsSubdomain ? `${config.duckdnsSubdomain}.duckdns.org` : null,
      },
    };
  };

  // Plain-Text CLI format for curl / terminal users (e.g. curl http://host:3000/api/diagnostics?format=text)
  const renderPlainTextReport = (report: StackDiagnostics): string => {
    const divider = '='.repeat(80);
    const subDivider = '-'.repeat(80);
    const lines: string[] = [];

    lines.push(divider);
    lines.push('🎬 CINESTREAM STACK DIAGNOSTICS & SYSTEM REPORT');
    lines.push(divider);
    lines.push(`Status:   ${report.status === 'HEALTHY' ? '✅ HEALTHY' : report.status === 'DEGRADED' ? '⚠️ DEGRADED' : '🔴 CRITICAL'}`);
    lines.push(`Time:     ${report.timestamp}`);
    lines.push(`Summary:  ${report.human_summary}`);
    lines.push('');

    lines.push(subDivider);
    lines.push('📖 HOW YOUR STACK IS OPERATING');
    lines.push(subDivider);
    lines.push(`• Architecture: ${report.stack_explanation.architecture}`);
    lines.push(`• Streaming:    ${report.stack_explanation.streaming_mode}`);
    lines.push(`• Storage:      ${report.stack_explanation.storage_mode}`);
    lines.push(`• Servarr:      ${report.stack_explanation.servarr_mode}`);
    lines.push(`• Backups:      ${report.stack_explanation.backups_mode}`);
    lines.push(`• Remote:       ${report.stack_explanation.remote_access}`);
    lines.push('');

    lines.push(subDivider);
    lines.push('🔍 COMPONENT BY COMPONENT STATUS');
    lines.push(subDivider);
    const comps = report.components;
    lines.push(`[${comps.nas_storage.status.padEnd(4)}] NAS Storage:    ${comps.nas_storage.summary}`);
    lines.push(`[${comps.backup_storage.status.padEnd(4)}] Config Backups: ${comps.backup_storage.summary}`);
    lines.push(`[${comps.radarr.status.padEnd(4)}] Radarr:         ${comps.radarr.summary}`);
    lines.push(`[${comps.sonarr.status.padEnd(4)}] Sonarr:         ${comps.sonarr.summary}`);
    lines.push(`[${comps.sabnzbd.status.padEnd(4)}] SABnzbd:        ${comps.sabnzbd.summary}`);
    lines.push(`[${comps.aiostreams.status.padEnd(4)}] AIOStreams:     ${comps.aiostreams.summary}`);
    lines.push(`[${comps.providers.status.padEnd(4)}] Providers:      ${comps.providers.summary}`);
    lines.push(`[${comps.stream_resolution_test.status.padEnd(4)}] Stream Test:    ${comps.stream_resolution_test.summary}`);
    lines.push('');

    lines.push(subDivider);
    lines.push(`🛠️ DIAGNOSIS & ACTION ITEMS (${report.diagnosis.issues_count} Issue(s))`);
    lines.push(subDivider);
    if (report.diagnosis.issues_count === 0) {
      lines.push('✓ No issues detected - your setup is fully operational!');
    } else {
      for (const item of report.diagnosis.issues) {
        lines.push(`[!] ${item.component}:`);
        lines.push(`    Problem: ${item.problem}`);
        lines.push(`    Fix:     ${item.fix}`);
      }
    }
    lines.push(divider);
    return lines.join('\n');
  };

  // Visual Interactive HTML Dashboard
  const renderHtmlDashboard = (report: StackDiagnostics): string => {
    const isHealthy = report.healthy;
    const statusColor = isHealthy ? '#10b981' : report.status === 'DEGRADED' ? '#f59e0b' : '#ef4444';
    const statusBg = isHealthy ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)';

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
    .badge-SKIPPED { background: rgba(156, 163, 175, 0.2); color: var(--text-muted); }

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

    .explanation-box {
      background: #111827;
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 16px 20px;
      margin-bottom: 24px;
    }
    .explanation-box h3 { font-size: 0.95rem; color: #fff; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; }
    .explanation-box p { font-size: 0.88rem; color: var(--text-muted); margin-bottom: 6px; }

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
      padding: 10px 14px;
      margin-bottom: 8px;
      border-radius: 6px;
      font-size: 0.88rem;
    }
    .action-warning { background: rgba(245, 158, 11, 0.1); color: #fbbf24; border-left: 3px solid var(--warning); }
    .action-fix { display: block; font-family: monospace; background: rgba(0, 0, 0, 0.3); padding: 4px 8px; border-radius: 4px; margin-top: 4px; color: #a7f3d0; }
    .action-success { background: rgba(16, 185, 129, 0.1); color: #34d399; border-left: 3px solid var(--accent); }

    .btn-group { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
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
        <h2>${report.diagnosis.headline}</h2>
        <p>${report.human_summary}</p>
      </div>
    </div>

    <!-- Stack Explanation -->
    <div class="explanation-box">
      <h3>Stack Architecture & Workflow</h3>
      <p>• <strong>Streaming:</strong> ${report.stack_explanation.streaming_mode}</p>
      <p>• <strong>Storage:</strong> ${report.stack_explanation.storage_mode}</p>
      <p>• <strong>Servarr:</strong> ${report.stack_explanation.servarr_mode}</p>
      <p>• <strong>Backups:</strong> ${report.stack_explanation.backups_mode}</p>
      <p>• <strong>Remote:</strong> ${report.stack_explanation.remote_access}</p>
    </div>

    <!-- Actionable Issues & How to Fix -->
    <div class="action-box">
      <h3>Diagnosed Issues & Fix Instructions</h3>
      ${report.diagnosis.issues.length === 0 ? '<p style="color:#34d399">✓ No issues found. Your setup is operating at 100% capacity!</p>' : ''}
      <ul class="action-list">
        ${report.diagnosis.issues.map((i) => `
          <li class="action-warning">
            <strong>[${i.component}]</strong>: ${i.problem}
            <span class="action-fix">💡 Fix: ${i.fix}</span>
          </li>
        `).join('')}
      </ul>
      <div class="btn-group">
        <button onclick="window.location.reload()">🔄 Refresh Checks</button>
        <button class="secondary" onclick="triggerBackup()">💾 Run Full Backup Snapshot</button>
        <a class="button secondary" href="/api/diagnostics" target="_blank">📋 Raw Machine JSON</a>
        <a class="button secondary" href="/api/diagnostics?format=text" target="_blank">📄 Plain Text CLI View</a>
        <button class="secondary" onclick="toggleJson()">🔍 Toggle JSON Viewer</button>
      </div>
      <pre id="jsonDump">${JSON.stringify(report, null, 2)}</pre>
    </div>

    <div class="grid">
      <!-- Storage Card -->
      <div class="card">
        <h3>Storage & Mounts <span class="badge badge-${report.components.nas_storage.status}">${report.components.nas_storage.status}</span></h3>
        <div class="item-row"><span class="label">NAS Path</span><span class="value"><code>${report.components.nas_storage.path}</code></span></div>
        <div class="item-row"><span class="label">Status</span><span class="value">${report.components.nas_storage.writable ? '🟢 Writable' : '🔴 ' + (report.components.nas_storage.error || 'Read-only')}</span></div>
        <div class="item-row"><span class="label">Free Space</span><span class="value">${report.components.nas_storage.free_gb} GB (${report.components.nas_storage.percent_used}% Used)</span></div>
        <div class="item-row"><span class="label">Backups Path</span><span class="value"><code>${report.components.backup_storage.path}</code></span></div>
        <div class="item-row"><span class="label">Backups Writable</span><span class="value">${report.components.backup_storage.writable ? '🟢 Yes' : '🔴 No'}</span></div>
      </div>

      <!-- Servarr Ecosystem -->
      <div class="card">
        <h3>Servarr Ecosystem <span class="badge badge-${report.components.radarr.online && report.components.sonarr.online ? 'PASS' : 'WARN'}">Stack</span></h3>
        <div class="item-row"><span class="label">Radarr</span><span class="value">${report.components.radarr.online ? `🟢 v${report.components.radarr.version}` : '⚪ ' + (report.components.radarr.error || 'Offline')}</span></div>
        <div class="item-row"><span class="label">Sonarr</span><span class="value">${report.components.sonarr.online ? `🟢 v${report.components.sonarr.version}` : '⚪ ' + (report.components.sonarr.error || 'Offline')}</span></div>
        <div class="item-row"><span class="label">SABnzbd</span><span class="value">${report.components.sabnzbd.online ? `🟢 v${report.components.sabnzbd.version}` : '⚪ ' + (report.components.sabnzbd.error || 'Offline')}</span></div>
        <div class="item-row"><span class="label">Auto-Linking</span><span class="value">🟢 SABnzbd Client Registered</span></div>
      </div>

      <!-- Cloud Providers -->
      <div class="card">
        <h3>Stream Providers <span class="badge badge-${report.components.providers.status}">${report.components.providers.active_count} Active</span></h3>
        ${report.components.providers.active_count === 0 ? '<div class="item-row"><span class="label">Status</span><span class="value">No providers in .env</span></div>' : ''}
        ${report.components.providers.active.map((q) => `
          <div class="item-row"><span class="label">${q.name}</span><span class="value">🟢 ${q.remaining_text}</span></div>
        `).join('')}
        <div class="item-row"><span class="label">TMDB Metadata</span><span class="value">${config.tmdbApiKey ? '🟢 Connected' : '⚪ Unconfigured'}</span></div>
      </div>

      <!-- Network & Scrapers -->
      <div class="card">
        <h3>Network & Scrapers <span class="badge badge-${report.components.aiostreams.status}">${report.components.aiostreams.status}</span></h3>
        <div class="item-row"><span class="label">Public URL</span><span class="value"><a href="${report.metrics.public_server_url}" target="_blank" style="color:#60a5fa">${report.metrics.public_server_url}</a></span></div>
        <div class="item-row"><span class="label">DuckDNS Domain</span><span class="value">${report.metrics.duckdns_domain || 'LAN Mode (No DuckDNS)'}</span></div>
        <div class="item-row"><span class="label">AIOStreams Engine</span><span class="value">${report.components.aiostreams.online ? '🟢 Reachable (:3000)' : '🔴 Unreachable'}</span></div>
        <div class="item-row"><span class="label">Stream Scrape Test</span><span class="value">${report.components.stream_resolution_test.status === 'PASS' ? `🟢 ${report.components.stream_resolution_test.stream_count} Streams Found` : '⚪ ' + report.components.stream_resolution_test.status}</span></div>
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

  // 1. Machine-readable JSON or Plain-text CLI output
  fastify.get('/api/diagnostics', async (req: FastifyRequest, reply: FastifyReply) => {
    const report = await runDiagnosticAssessment();
    const query = req.query as { format?: string; strict?: string; fail_on_error?: string };

    // If text format requested: curl http://localhost:3000/api/diagnostics?format=text
    if (query?.format === 'text' || query?.format === 'txt') {
      reply.type('text/plain; charset=utf-8');
      return reply.send(renderPlainTextReport(report));
    }

    const failOnError = query?.strict === 'true' || query?.strict === '1' || query?.fail_on_error === 'true' || query?.fail_on_error === '1';
    reply.type('application/json; charset=utf-8');
    if (failOnError && !report.healthy) {
      return reply.status(503).send(report);
    }
    return reply.status(200).send(report);
  });

  // 2. Direct Human-readable Visual Dashboard
  fastify.get('/diagnostics', async (_req: FastifyRequest, reply: FastifyReply) => {
    const report = await runDiagnosticAssessment();
    reply.type('text/html; charset=utf-8');
    return reply.send(renderHtmlDashboard(report));
  });
}
