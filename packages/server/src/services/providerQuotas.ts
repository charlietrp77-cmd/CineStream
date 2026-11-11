import { fetch as undiciFetch } from 'undici';
import { config } from '../config';

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

function extractCredentialsFromAioConfig(rawConfig: string): {
  torboxApiKey?: string;
  premiumizeApiKey?: string;
  easynewsUsername?: string;
  easynewsPassword?: string;
  realdebridApiKey?: string;
  alldebridApiKey?: string;
} {
  const creds: any = {};
  if (!rawConfig) return creds;

  const tryParseJson = (str: string) => {
    try {
      return JSON.parse(str);
    } catch (_) {
      return null;
    }
  };

  // 1. Try raw JSON
  let obj = tryParseJson(rawConfig);

  // 2. Try URL decode
  if (!obj) {
    try {
      obj = tryParseJson(decodeURIComponent(rawConfig));
    } catch (_) {}
  }

  // 3. Try base64 decode
  if (!obj) {
    try {
      const clean = rawConfig
        .replace(/^(stremio|https?):\/\/[^/]+\//i, '')
        .replace(/\/manifest\.json$/i, '')
        .replace(/^\//, '');
      const b64 = Buffer.from(clean, 'base64').toString('utf8');
      obj = tryParseJson(b64);
    } catch (_) {}
  }

  if (obj && typeof obj === 'object') {
    const findInObject = (o: any) => {
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        const lowerK = k.toLowerCase();
        if (typeof v === 'string') {
          if (
            (lowerK.includes('torbox') && (lowerK.includes('api') || lowerK.includes('token') || lowerK.includes('key'))) ||
            (lowerK === 'tb' && v.length > 15)
          ) {
            creds.torboxApiKey = v;
          } else if (
            lowerK.includes('premiumize') &&
            (lowerK.includes('api') || lowerK.includes('pin') || lowerK.includes('key'))
          ) {
            creds.premiumizeApiKey = v;
          } else if (
            lowerK.includes('realdebrid') ||
            lowerK.includes('rd_api') ||
            (lowerK === 'rd' && v.length > 20)
          ) {
            creds.realdebridApiKey = v;
          } else if (lowerK.includes('alldebrid')) {
            creds.alldebridApiKey = v;
          }
        } else if (typeof v === 'object') {
          if (lowerK === 'torbox' && (v as any).apiKey) creds.torboxApiKey = (v as any).apiKey;
          if (lowerK === 'premiumize' && (v as any).apiKey) creds.premiumizeApiKey = (v as any).apiKey;
          if (lowerK === 'realdebrid' && (v as any).apiKey) creds.realdebridApiKey = (v as any).apiKey;
          if (lowerK === 'alldebrid' && (v as any).apiKey) creds.alldebridApiKey = (v as any).apiKey;
          if (lowerK === 'easynews') {
            if ((v as any).username) creds.easynewsUsername = (v as any).username;
            if ((v as any).password) creds.easynewsPassword = (v as any).password;
          }
          findInObject(v);
        }
      }
    };
    findInObject(obj);
  }

  return creds;
}

async function fetchTorboxQuota(apiKey: string): Promise<ProviderQuota | null> {
  try {
    const res = await undiciFetch('https://api.torbox.app/v1/api/user/me?settings=true', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    if (!json.success || !json.data) return null;

    const data = json.data;
    const usedBytes = data.total_downloaded || 0;
    const planCode = data.plan; // 0 = Free, 1 = Essential, 2 = Pro, 3 = Standard
    let totalBytes = 1000 * 1024 * 1024 * 1024; // 1TB default
    let planName = 'Pro';
    if (planCode === 0) {
      totalBytes = 100 * 1024 * 1024 * 1024;
      planName = 'Free';
    } else if (planCode === 1) {
      totalBytes = 500 * 1024 * 1024 * 1024;
      planName = 'Essential';
    } else if (planCode === 2 || planCode === 3) {
      totalBytes = 1000 * 1024 * 1024 * 1024;
      planName = 'Pro';
    }

    const remainingBytes = Math.max(0, totalBytes - usedBytes);
    const remainingGb = Math.round(remainingBytes / (1024 * 1024 * 1024));
    const percentUsed = Math.min(100, Math.round((usedBytes / totalBytes) * 100));

    let daysRemaining: number | undefined;
    let expiresAt: string | undefined;
    if (data.customer?.expires_at) {
      expiresAt = String(data.customer.expires_at);
      daysRemaining = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
    }

    return {
      provider: 'torbox',
      name: 'TorBox',
      shortName: 'TorBox',
      status: percentUsed > 90 ? 'warning' : 'active',
      plan: planName,
      usedBytes,
      totalBytes,
      remainingBytes,
      remainingGbText: `${remainingGb} GB`,
      percentUsed,
      daysRemaining,
      expiresAt,
    };
  } catch (_) {
    return null;
  }
}

async function fetchPremiumizeQuota(apiKey: string): Promise<ProviderQuota | null> {
  try {
    const res = await undiciFetch(`https://www.premiumize.me/api/account/info?apikey=${encodeURIComponent(apiKey)}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    if (json.status !== 'success') return null;

    const limitUsed = typeof json.limit_used === 'number' ? json.limit_used : 0;
    const pointsTotal = 1000;
    const pointsUsed = Math.round(limitUsed * pointsTotal);
    const pointsRemaining = Math.max(0, pointsTotal - pointsUsed);
    const percentUsed = Math.round(limitUsed * 100);

    let daysRemaining: number | undefined;
    let expiresAt: string | undefined;
    if (json.premium_until) {
      const expMs = json.premium_until * 1000;
      expiresAt = new Date(expMs).toISOString();
      daysRemaining = Math.max(0, Math.round((expMs - Date.now()) / (1000 * 60 * 60 * 24)));
    }

    return {
      provider: 'premiumize',
      name: 'Premiumize',
      shortName: 'Premiumize',
      status: percentUsed > 90 ? 'warning' : (daysRemaining !== undefined && daysRemaining <= 0) ? 'expired' : 'active',
      plan: 'Fair-Use Points',
      usedBytes: pointsUsed * 1024 * 1024 * 1024,
      totalBytes: pointsTotal * 1024 * 1024 * 1024,
      remainingBytes: pointsRemaining * 1024 * 1024 * 1024,
      remainingGbText: `${pointsRemaining} GB`,
      percentUsed,
      daysRemaining,
      expiresAt,
    };
  } catch (_) {
    return null;
  }
}

async function fetchEasynewsQuota(username: string, pass: string): Promise<ProviderQuota | null> {
  try {
    const auth = Buffer.from(`${username}:${pass}`).toString('base64');
    const headers = {
      Authorization: `Basic ${auth}`,
      Accept: 'text/html,application/xhtml+xml,application/xml',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    let html = '';
    const res = await undiciFetch('https://members.easynews.com/index.html', {
      headers,
      signal: AbortSignal.timeout(6000),
    });

    if (res.ok) {
      html = await res.text();
    } else {
      const res2 = await undiciFetch('https://members.easynews.com/', {
        headers,
        signal: AbortSignal.timeout(6000),
      });
      if (res2.ok) {
        html = await res2.text();
      }
    }

    if (html) {
      const gigMatch =
        html.match(/You have <strong>([0-9.,]+)<\/strong>\s*gigabytes\s*\(<strong>([0-9.,]+)<\/strong>\s*bytes\)\s*remaining/i) ||
        html.match(/<strong>([0-9.,]+)\s*gigabytes\s*<\/strong>\s*(?:<br\s*\/?>)?\s*remaining in your gig bank/i) ||
        html.match(/([0-9.,]+)\s*gigabytes.*?remaining/i);

      let remainingGigs: number | undefined;
      let remainingBytes: number | undefined;

      if (gigMatch) {
        remainingGigs = parseFloat(gigMatch[1].replace(/,/g, ''));
        if (gigMatch[2]) {
          remainingBytes = parseInt(gigMatch[2].replace(/,/g, ''), 10);
        } else {
          remainingBytes = Math.round(remainingGigs * 1024 * 1024 * 1024);
        }
      }

      const planMatch = html.match(/You have an?\s+([^<]+?)\s+account/i);
      const plan = planMatch ? planMatch[1].trim() : 'Web Usenet';

      let totalGigs = 1000;
      if (/1\s*TB/i.test(plan)) totalGigs = 1000;
      else if (/2\s*TB/i.test(plan)) totalGigs = 2000;
      else if (/500\s*GB/i.test(plan)) totalGigs = 500;
      else if (/250\s*GB/i.test(plan)) totalGigs = 250;
      else if (/150\s*GB/i.test(plan)) totalGigs = 150;
      else if (/40\s*GB/i.test(plan)) totalGigs = 40;
      else if (/20\s*GB/i.test(plan)) totalGigs = 20;

      const totalBytes = totalGigs * 1024 * 1024 * 1024;

      if (remainingGigs !== undefined) {
        const percentUsed = Math.min(100, Math.max(0, Math.round(((totalBytes - (remainingBytes || remainingGigs * 1024 * 1024 * 1024)) / totalBytes) * 100)));
        return {
          provider: 'easynews',
          name: 'Easynews',
          shortName: 'Easynews',
          status: percentUsed > 90 ? 'warning' : 'active',
          plan,
          remainingBytes: remainingBytes || remainingGigs * 1024 * 1024 * 1024,
          totalBytes,
          remainingGbText: `${remainingGigs.toFixed(1)} GB`,
          percentUsed,
        };
      }
    }

    // Connected with valid auth fallback
    return {
      provider: 'easynews',
      name: 'Easynews',
      shortName: 'Easynews',
      status: 'active',
      plan: 'Web Usenet',
      remainingGbText: 'Active',
    };
  } catch (_) {
    return null;
  }
}

async function fetchRealDebridQuota(apiKey: string): Promise<ProviderQuota | null> {
  try {
    const res = await undiciFetch('https://api.real-debrid.com/rest/1.0/user', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    if (!data || !data.expiration) return null;

    const expDate = new Date(data.expiration);
    const daysRemaining = Math.max(0, Math.round((expDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

    return {
      provider: 'realdebrid',
      name: 'Real-Debrid',
      shortName: 'RealDebrid',
      status: daysRemaining <= 0 ? 'expired' : daysRemaining <= 3 ? 'warning' : 'active',
      plan: 'Unlimited VIP',
      remainingGbText: `${daysRemaining}d VIP`,
      daysRemaining,
      expiresAt: data.expiration,
    };
  } catch (_) {
    return null;
  }
}

async function fetchAllDebridQuota(apiKey: string): Promise<ProviderQuota | null> {
  try {
    const res = await undiciFetch(
      `https://api.alldebrid.com/v4/user?agent=CineStream&apikey=${encodeURIComponent(apiKey)}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null;
    const json: any = await res.json();
    if (json.status !== 'success' || !json.data?.user) return null;

    const user = json.data.user;
    let daysRemaining: number | undefined;
    if (user.premiumUntil) {
      daysRemaining = Math.max(0, Math.round((user.premiumUntil * 1000 - Date.now()) / (1000 * 60 * 60 * 24)));
    }

    return {
      provider: 'alldebrid',
      name: 'AllDebrid',
      shortName: 'AllDebrid',
      status: daysRemaining !== undefined && daysRemaining <= 3 ? 'warning' : 'active',
      plan: 'Unlimited Premium',
      remainingGbText: `${daysRemaining ?? 0}d VIP`,
      daysRemaining,
    };
  } catch (_) {
    return null;
  }
}

function isValidKey(val?: string | null): boolean {
  if (!val) return false;
  const s = val.trim();
  if (!s) return false;
  if (/^(your[_-]|tb_live_your|sample|placeholder|default)/i.test(s)) {
    return false;
  }
  return true;
}

class ProviderQuotasService {
  private cache: { quotas: ProviderQuota[]; expiresAt: number } | null = null;

  public async getQuotas(configOverride?: string | null): Promise<ProviderQuota[]> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now && !configOverride) {
      return this.cache.quotas;
    }

    const aioCreds = extractCredentialsFromAioConfig(configOverride || config.aiostreamsUserConfig);

    const torboxKey = config.torboxApiKey || aioCreds.torboxApiKey;
    const premiumizeKey = config.premiumizeApiKey || aioCreds.premiumizeApiKey;
    const easynewsUser = config.easynewsUsername || aioCreds.easynewsUsername;
    const easynewsPass = config.easynewsPassword || aioCreds.easynewsPassword;
    const rdKey = config.realdebridApiKey || aioCreds.realdebridApiKey;
    const adKey = config.alldebridApiKey || aioCreds.alldebridApiKey;

    const promises: Promise<ProviderQuota | null>[] = [];
    if (isValidKey(torboxKey)) promises.push(fetchTorboxQuota(torboxKey!));
    if (isValidKey(premiumizeKey)) promises.push(fetchPremiumizeQuota(premiumizeKey!));
    if (isValidKey(easynewsUser) && isValidKey(easynewsPass)) promises.push(fetchEasynewsQuota(easynewsUser!, easynewsPass!));
    if (isValidKey(rdKey)) promises.push(fetchRealDebridQuota(rdKey!));
    if (isValidKey(adKey)) promises.push(fetchAllDebridQuota(adKey!));

    if (promises.length === 0) {
      return [];
    }

    const results = await Promise.allSettled(promises);
    const quotas: ProviderQuota[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        quotas.push(r.value);
      }
    }

    if (!configOverride) {
      this.cache = { quotas, expiresAt: now + 60000 }; // 60s cache
    }

    return quotas;
  }
}

export const providerQuotas = new ProviderQuotasService();
