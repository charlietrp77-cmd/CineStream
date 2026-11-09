import { fetch as undiciFetch } from 'undici';
import { config } from '../config';

export interface StreamBadges {
  resolution: '4K' | '1080p' | '720p' | 'SD';
  dolbyVision: boolean;
  hdr10Plus: boolean;
  hdr: boolean;
  atmos: boolean;
  trueHd: boolean;
  dtsHd: boolean;
  remux: boolean;
  source: string;
  sizeText: string;
  sizeBytes?: number;
  sizeTier?: 'micro' | 'compact' | 'high' | 'remux';
  isNasCached: boolean;
}

export interface AioRawStream {
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  infoHash?: string;
  nzbUrl?: string;
  fileIdx?: number;
  sources?: string[];
  behaviorHints?: {
    bingeGroup?: string;
    filename?: string;
    videoHash?: string;
    videoSize?: number;
    nzbUrl?: string;
    proxyHeaders?: {
      request?: Record<string, string>;
    };
    notWebReady?: boolean;
  };
}

export interface ResolvedStream {
  id: string;
  name: string;
  title: string;
  url: string;
  rawUrl: string;
  headers?: Record<string, string>;
  bingeGroup?: string;
  badges: StreamBadges;
  qualityScore: number;
  infoHash?: string;
  magnetUrl?: string;
  nzbUrl?: string;
}

const CAM_REGEX = /\b(CAM|HDCAM|CAM-?RIP|TS-?RIP|TELESYNC|HD-?TS|TELE-?CINE|DVD-?SCR|SCREENER|WORKPRINT)\b/i;

export function isCamStream(text: string): boolean {
  return CAM_REGEX.test(text);
}

export function parseStreamBadges(stream: AioRawStream, isEpisode: boolean = false): StreamBadges {
  const combined = [
    stream.name || '',
    stream.title || '',
    stream.description || '',
    stream.behaviorHints?.filename || '',
  ].join(' ');

  // Resolution detection
  let resolution: '4K' | '1080p' | '720p' | 'SD' = '1080p';
  if (/\b(4K|2160p|UHD)\b/i.test(combined)) {
    resolution = '4K';
  } else if (/\b(1080p|FHD)\b/i.test(combined)) {
    resolution = '1080p';
  } else if (/\b(720p|HD)\b/i.test(combined)) {
    resolution = '720p';
  } else if (/\b(480p|576p|SD)\b/i.test(combined)) {
    resolution = 'SD';
  }

  // HDR & Vision
  const dolbyVision = /\b(DV|Dolby\s*Vision|DoVi)\b/i.test(combined);
  const hdr10Plus = /\b(HDR10\+|HDR10Plus)\b/i.test(combined);
  const hdr = /\b(HDR|HDR10)\b/i.test(combined) || hdr10Plus;

  // Audio Codecs
  const atmos = /\b(Atmos)\b/i.test(combined);
  const trueHd = /\b(TrueHD)\b/i.test(combined);
  const dtsHd = /\b(DTS-HD|DTS:X|DTS-MA)\b/i.test(combined);

  // Remux
  const remux = /\b(REMUX)\b/i.test(combined);

  // Provider / Source extraction
  const bingeLower = (stream.behaviorHints?.bingeGroup || (stream as any).bingeGroup || '').toLowerCase();
  let source = 'Debrid';
  if (bingeLower.includes('easynews') || /easynews/i.test(combined) || /\(EN\)/i.test(combined)) {
    source = 'Easynews';
  } else if (bingeLower.includes('premiumize') || /premiumize/i.test(combined) || /\(PM\)/i.test(combined) || /\bPM\b/.test(combined)) {
    source = 'Premiumize';
  } else if (bingeLower.includes('realdebrid') || /real-?debrid/i.test(combined) || /\(RD\)/i.test(combined) || /\bRD\b/.test(combined)) {
    source = 'Real-Debrid';
  } else if (bingeLower.includes('torbox') || /torbox/i.test(combined) || /\(TB\)/i.test(combined)) {
    source = 'TorBox';
  } else if (bingeLower.includes('alldebrid') || /alldebrid/i.test(combined) || /\(AD\)/i.test(combined)) {
    source = 'AllDebrid';
  } else if (bingeLower.includes('debridlink') || /debrid-?link/i.test(combined) || /\(DL\)/i.test(combined)) {
    source = 'Debrid-Link';
  } else if (/usenet/i.test(combined)) {
    source = 'Usenet';
  }

  // Size extraction (e.g., "62.4 GB", "3.2 GiB", "💾 15.2 GB")
  let sizeText = '';
  let sizeBytes: number | undefined;

  const sizeMatch = /(?:💾|size[:\s]*|\[|\()?\s*(\d+(?:\.\d+)?)\s*(GB|GiB|MB|MiB)\b/i.exec(combined);
  if (sizeMatch) {
    const val = parseFloat(sizeMatch[1]);
    const unit = sizeMatch[2].toUpperCase();
    if (unit.startsWith('G')) {
      sizeBytes = Math.round(val * 1024 * 1024 * 1024);
      sizeText = `${val} ${unit}`;
    } else {
      sizeBytes = Math.round(val * 1024 * 1024);
      sizeText = `${val} ${unit}`;
    }
  } else if (stream.behaviorHints?.videoSize) {
    sizeBytes = stream.behaviorHints.videoSize;
    const gb = sizeBytes / (1024 * 1024 * 1024);
    sizeText = gb >= 1 ? `${gb.toFixed(1)} GB` : `${(gb * 1024).toFixed(0)} MB`;
  }

  // Check if stream is a Season Pack (contains multiple episodes)
  const isSeasonPack = isEpisode && /\b(complete\s*season|season\s*\d+\s*(?:complete|batch)?|s\d+\s*complete|s\d+-s\d+)\b/i.test(combined);

  // Micro-encode detection (groups known for high compression / 2-3 Mbps re-encodes)
  const isMicroGroup = /\b(yts|yify|psa|galaxyrg|galaxytv|pahe|qxr|rmteam|megusta|eztv)\b/i.test(combined);
  if (!sizeBytes && isMicroGroup) {
    if (isEpisode) {
      sizeText = resolution === '4K' ? '~900 MB (Micro)' : '~350 MB (Micro)';
      sizeBytes = resolution === '4K' ? 900 * 1024 * 1024 : 350 * 1024 * 1024;
    } else {
      sizeText = resolution === '4K' ? '~3.5 GB (Micro)' : '~1.2 GB (Micro)';
      sizeBytes = resolution === '4K' ? 3.5 * 1024 * 1024 * 1024 : 1.2 * 1024 * 1024 * 1024;
    }
  }

  // Size tier classification (aligning with TRaSH Guides: Sonarr TV vs Radarr Movies)
  let sizeTier: 'micro' | 'compact' | 'high' | 'remux' = 'compact';

  if (isEpisode) {
    if (isSeasonPack) {
      // Full Season Pack (~8-12 episodes)
      if (remux || (sizeBytes && sizeBytes >= 80 * 1024 * 1024 * 1024)) {
        sizeTier = 'remux';
      } else if (
        isMicroGroup ||
        (sizeBytes &&
          ((resolution === '4K' && sizeBytes < 12 * 1024 * 1024 * 1024) ||
            (resolution === '1080p' && sizeBytes < 4 * 1024 * 1024 * 1024)))
      ) {
        sizeTier = 'micro';
      } else if (
        sizeBytes &&
        ((resolution === '4K' && sizeBytes >= 35 * 1024 * 1024 * 1024) ||
          (resolution === '1080p' && sizeBytes >= 15 * 1024 * 1024 * 1024))
      ) {
        sizeTier = 'high';
      } else {
        sizeTier = 'compact';
      }
    } else {
      // Single TV Episode (typically 25-60 mins)
      if (remux || (sizeBytes && sizeBytes >= 14 * 1024 * 1024 * 1024)) {
        sizeTier = 'remux';
      } else if (
        isMicroGroup ||
        (sizeBytes &&
          ((resolution === '4K' && sizeBytes < 1.4 * 1024 * 1024 * 1024) ||
            (resolution === '1080p' && sizeBytes < 450 * 1024 * 1024)))
      ) {
        sizeTier = 'micro';
      } else if (
        sizeBytes &&
        ((resolution === '4K' && sizeBytes >= 4 * 1024 * 1024 * 1024) ||
          (resolution === '1080p' && sizeBytes >= 1.8 * 1024 * 1024 * 1024))
      ) {
        sizeTier = 'high';
      } else {
        sizeTier = 'compact';
      }
    }
  } else {
    // Feature Movie (typically 90-180 mins)
    if (remux || (sizeBytes && sizeBytes >= 40 * 1024 * 1024 * 1024)) {
      sizeTier = 'remux';
    } else if (
      isMicroGroup ||
      (sizeBytes &&
        ((resolution === '4K' && sizeBytes < 6 * 1024 * 1024 * 1024) ||
          (resolution === '1080p' && sizeBytes < 2 * 1024 * 1024 * 1024)))
    ) {
      sizeTier = 'micro';
    } else if (
      sizeBytes &&
      ((resolution === '4K' && sizeBytes >= 16 * 1024 * 1024 * 1024) ||
        (resolution === '1080p' && sizeBytes >= 5 * 1024 * 1024 * 1024))
    ) {
      sizeTier = 'high';
    } else {
      sizeTier = 'compact';
    }
  }

  return {
    resolution,
    dolbyVision,
    hdr10Plus,
    hdr,
    atmos,
    trueHd,
    dtsHd,
    remux,
    source,
    sizeText,
    sizeBytes,
    sizeTier,
    isNasCached: false,
  };
}

export function computeQualityScore(badges: StreamBadges): number {
  let score = 0;
  if (badges.resolution === '4K') score += 1000;
  else if (badges.resolution === '1080p') score += 500;
  else if (badges.resolution === '720p') score += 200;

  // Format & dynamic range features
  if (badges.remux) score += 400;
  if (badges.dolbyVision) score += 250;
  if (badges.hdr10Plus) score += 150;
  else if (badges.hdr) score += 100;

  // Lossless & advanced audio
  if (badges.atmos) score += 120;
  if (badges.trueHd) score += 80;
  if (badges.dtsHd) score += 70;

  // Size & Bitrate Weighting (TRaSH Guides alignment):
  // A 3GB 4K release labeled "DV + Atmos" has heavy compression artifacts & low bitrate.
  // Heavily penalize micro-encodes so high-bitrate encodes or remuxes are picked as bestStream.
  if (badges.sizeTier === 'micro') {
    score -= 700;
  } else if (badges.sizeTier === 'high') {
    score += 350;
  } else if (badges.sizeTier === 'remux') {
    score += 500;
  }

  return score;
}

export function buildStreamUrls(
  internalBaseUrl: string,
  configInput: string,
  type: string,
  id: string
): string[] {
  let cleaned = configInput.trim();
  cleaned = cleaned.replace(/^AIOSTREAMS_USER_CONFIG\s*=\s*/i, '');
  const stremioType = type === 'tv' || type === 'series' ? 'series' : 'movie';
  const urls: string[] = [];

  // If full URL e.g. http://domain:3001/stremio/uuid/password/manifest.json or stremio://...
  if (/^(stremio|https?):\/\//i.test(cleaned)) {
    try {
      const parsed = new URL(cleaned.replace(/^stremio:/i, 'http:'));
      let path = parsed.pathname.replace(/\/manifest\.json$/i, '').replace(/\/$/, '');
      if (!path.startsWith('/')) path = '/' + path;

      urls.push(`${internalBaseUrl}${path}/stream/${stremioType}/${id}.json`);
      urls.push(`${internalBaseUrl}${path}/${stremioType}/${id}.json`);
      return urls;
    } catch (_) {}
  }

  // Clean path format
  const cleanPath = cleaned.replace(/\/manifest\.json$/i, '').replace(/^\/+/, '').replace(/\/+$/, '');

  if (cleanPath.startsWith('stremio/')) {
    urls.push(`${internalBaseUrl}/${cleanPath}/stream/${stremioType}/${id}.json`);
    urls.push(`${internalBaseUrl}/${cleanPath}/${stremioType}/${id}.json`);
  } else {
    // AIOStreams v2 authenticated routes
    urls.push(`${internalBaseUrl}/stremio/${cleanPath}/stream/${stremioType}/${id}.json`);
    urls.push(`${internalBaseUrl}/stremio/${cleanPath}/${stremioType}/${id}.json`);
    urls.push(`${internalBaseUrl}/${cleanPath}/stream/${stremioType}/${id}.json`);
  }

  return urls;
}

export function cleanConfigToken(rawConfig: string): string {
  let cleaned = rawConfig.trim();
  cleaned = cleaned.replace(/^(stremio|https?):\/\/[^/]+\//i, '');
  cleaned = cleaned.replace(/^\//, '');
  cleaned = cleaned.replace(/\/manifest\.json$/i, '');
  cleaned = cleaned.replace(/\/$/, '');
  return cleaned;
}

class AioStreamsService {
  private prefetchCache = new Map<string, { streams: ResolvedStream[]; expiresAt: number }>();

  public async fetchRawStreams(
    type: 'movie' | 'tv' | 'series',
    id: string,
    configOverride?: string | null
  ): Promise<AioRawStream[]> {
    const rawConfig = configOverride || config.aiostreamsUserConfig;
    if (!rawConfig) {
      return [];
    }

    const candidateUrls = buildStreamUrls(config.aiostreamsInternalUrl, rawConfig, type, id);

    for (const url of candidateUrls) {
      try {
        const response = await undiciFetch(url, {
          headers: { 'User-Agent': 'CineStream/1.0.0' },
          signal: AbortSignal.timeout(8000),
        });

        if (!response.ok) {
          continue;
        }

        const json = (await response.json()) as { streams?: AioRawStream[] };
        const streams = json.streams || [];

        // Check if AIOStreams returned a reconfigure error notice
        const isErrorNotice = streams.some((s: any) =>
          s.streamData?.type === 'error' ||
          (s.name && s.name.includes('❌')) ||
          (s.description && s.description.includes('requires you to reconfigure'))
        );

        if (isErrorNotice) {
          continue;
        }

        if (streams.length > 0) {
          return streams;
        }
      } catch (err) {
        // Fallback for host-mode
        if (!url.includes(':3001')) {
          try {
            const fallbackHostUrl = url.replace(config.aiostreamsInternalUrl, 'http://127.0.0.1:3001');
            const res2 = await undiciFetch(fallbackHostUrl, {
              headers: { 'User-Agent': 'CineStream/1.0.0' },
              signal: AbortSignal.timeout(8000),
            });
            if (res2.ok) {
              const json2 = (await res2.json()) as { streams?: AioRawStream[] };
              const streams2 = json2.streams || [];
              const isErr2 = streams2.some((s: any) => s.streamData?.type === 'error' || s.name?.includes('❌'));
              if (!isErr2 && streams2.length > 0) {
                return streams2;
              }
            }
          } catch (_) {}
        }
      }
    }

    return [];
  }

  public async resolveStreams(
    type: 'movie' | 'tv' | 'series',
    id: string,
    configOverride?: string | null
  ): Promise<ResolvedStream[]> {
    const stremioType = type === 'tv' || type === 'series' ? 'series' : 'movie';
    const cacheKey = `${stremioType}:${id}:${configOverride || ''}`;
    const cached = this.prefetchCache.get(cacheKey);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.streams;
    }

    const rawStreams = await this.fetchRawStreams(stremioType, id, configOverride);
    const results: ResolvedStream[] = [];

    let counter = 0;
    for (const raw of rawStreams) {
      if (!raw.url) continue;

      const fullText = `${raw.name || ''} ${raw.title || ''} ${raw.description || ''} ${raw.behaviorHints?.filename || ''}`;
      // Reject CAM streams
      if (isCamStream(fullText)) {
        continue;
      }

      const isEpisode = stremioType === 'series' || id.includes(':');
      const badges = parseStreamBadges(raw, isEpisode);
      const score = computeQualityScore(badges);
      const headers = raw.behaviorHints?.proxyHeaders?.request;

      // Extract infoHash and construct Magnet link if available
      let infoHash = raw.infoHash;
      let magnetUrl = '';

      if (!infoHash && raw.url?.startsWith('magnet:')) {
        magnetUrl = raw.url;
        const hashMatch = /xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i.exec(raw.url);
        if (hashMatch) {
          infoHash = hashMatch[1].toLowerCase();
        }
      }

      if (!infoHash && raw.url) {
        // Check for 40-character SHA1 hex hash in URL path
        const hashMatch = /\b([a-fA-F0-9]{40})\b/.exec(raw.url);
        if (hashMatch) {
          infoHash = hashMatch[1].toLowerCase();
        }
      }

      if (infoHash && !magnetUrl) {
        const trackers = [
          'udp://tracker.opentrackr.org:1337/announce',
          'udp://open.stealth.si:80/announce',
          'udp://tracker.torrent.eu.org:451/announce',
          'udp://tracker.bittor.pw:1337/announce',
          'udp://public.popcorn-tracker.org:6969/announce',
          'udp://tracker.dler.org:6969/announce',
        ];
        const trackerParams = trackers.map((t) => `&tr=${encodeURIComponent(t)}`).join('');
        const dn = encodeURIComponent(raw.behaviorHints?.filename || raw.title || raw.name || 'torrent');
        magnetUrl = `magnet:?xt=urn:btih:${infoHash}&dn=${dn}${trackerParams}`;
      }

      // Extract NZB URL if present from Usenet scrapers/indexers
      let nzbUrl = raw.nzbUrl || raw.behaviorHints?.nzbUrl;
      if (!nzbUrl && raw.url && (/\.nzb(\?|$)/i.test(raw.url) || /mode=getnzb/i.test(raw.url))) {
        nzbUrl = raw.url;
      }

      // Construct stream proxy URL (relative so client always streams from its own origin)
      const urlBase64 = Buffer.from(raw.url).toString('base64url');
      const headersBase64 = headers ? Buffer.from(JSON.stringify(headers)).toString('base64url') : '';
      const proxyUrl = `/proxy/stream?url=${urlBase64}${headersBase64 ? `&headers=${headersBase64}` : ''}`;

      results.push({
        id: `stream_${id}_${counter++}`,
        name: raw.name || 'Stream',
        title: raw.title || raw.description || 'Stream',
        url: proxyUrl,
        rawUrl: raw.url,
        headers,
        bingeGroup: raw.behaviorHints?.bingeGroup,
        badges,
        qualityScore: score,
        infoHash,
        magnetUrl,
        nzbUrl,
      });
    }

    // Sort by quality score descending
    results.sort((a, b) => b.qualityScore - a.qualityScore);

    if (results.length > 0) {
      this.prefetchCache.set(cacheKey, {
        streams: results,
        expiresAt: now + 15 * 60 * 1000, // 15 mins cache
      });
    }

    return results;
  }

  public async prefetchStreams(type: 'movie' | 'tv' | 'series', id: string, configOverride?: string | null): Promise<void> {
    await this.resolveStreams(type, id, configOverride);
  }

  public async verifyNonCamStream(imdbId: string): Promise<{ hasNonCam: boolean; bestBadge: string | null }> {
    const streams = await this.resolveStreams('movie', imdbId);
    if (streams.length === 0) {
      return { hasNonCam: false, bestBadge: null };
    }

    const top = streams[0];
    let badge = `${top.badges.resolution}`;
    if (top.badges.dolbyVision) badge += ' DV';
    else if (top.badges.hdr) badge += ' HDR';
    if (top.badges.remux) badge += ' Remux';

    return {
      hasNonCam: true,
      bestBadge: badge,
    };
  }
}

export const aioStreams = new AioStreamsService();

