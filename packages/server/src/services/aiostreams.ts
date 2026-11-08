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
  isNasCached: boolean;
}

export interface AioRawStream {
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  behaviorHints?: {
    bingeGroup?: string;
    filename?: string;
    videoHash?: string;
    videoSize?: number;
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
}

const CAM_REGEX = /\b(CAM|HDCAM|CAMRIP|TS|TELESYNC|HDTS|TC|TELECINE|SCR|SCREENER|WORKPRINT)\b/i;

export function isCamStream(text: string): boolean {
  return CAM_REGEX.test(text);
}

export function parseStreamBadges(stream: AioRawStream): StreamBadges {
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
  let source = 'Debrid';
  if (/easynews/i.test(combined)) {
    source = 'Easynews';
  } else if (/real-?debrid/i.test(combined) || /\bRD\b/.test(combined)) {
    source = 'Real-Debrid';
  } else if (/torbox/i.test(combined)) {
    source = 'TorBox';
  } else if (/alldebrid/i.test(combined) || /\bAD\b/.test(combined)) {
    source = 'AllDebrid';
  } else if (/premiumize/i.test(combined) || /\bPM\b/.test(combined)) {
    source = 'Premiumize';
  } else if (/usenet/i.test(combined)) {
    source = 'Usenet';
  }

  // Size extraction (e.g., "62.4 GB", "3.2 GiB")
  let sizeText = '';
  const sizeMatch = /(\d+(?:\.\d+)?)\s*(GB|GiB|MB|MiB)/i.exec(combined);
  if (sizeMatch) {
    sizeText = `${sizeMatch[1]} ${sizeMatch[2].toUpperCase()}`;
  } else if (stream.behaviorHints?.videoSize) {
    const gb = stream.behaviorHints.videoSize / (1024 * 1024 * 1024);
    sizeText = gb >= 1 ? `${gb.toFixed(1)} GB` : `${(gb * 1024).toFixed(0)} MB`;
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
    isNasCached: false,
  };
}

export function computeQualityScore(badges: StreamBadges): number {
  let score = 0;
  if (badges.resolution === '4K') score += 1000;
  else if (badges.resolution === '1080p') score += 500;
  else if (badges.resolution === '720p') score += 200;

  if (badges.remux) score += 300;
  if (badges.dolbyVision) score += 250;
  if (badges.hdr10Plus) score += 150;
  else if (badges.hdr) score += 100;

  if (badges.atmos) score += 120;
  if (badges.trueHd) score += 80;
  if (badges.dtsHd) score += 70;

  return score;
}

class AioStreamsService {
  private prefetchCache = new Map<string, { streams: ResolvedStream[]; expiresAt: number }>();

  public async fetchRawStreams(
    type: 'movie' | 'tv',
    id: string,
    configOverride?: string | null
  ): Promise<AioRawStream[]> {
    const activeConfig = configOverride || config.aiostreamsUserConfig;
    if (!activeConfig) {
      return [];
    }

    const url = `${config.aiostreamsInternalUrl}/${activeConfig}/stream/${type}/${id}.json`;

    try {
      const response = await undiciFetch(url, {
        headers: { 'User-Agent': 'CineStream/1.0.0' },
      });

      if (!response.ok) {
        return [];
      }

      const json = (await response.json()) as { streams?: AioRawStream[] };
      return json.streams || [];
    } catch (err) {
      console.error(`Error querying AIOStreams at ${url}:`, err);
      return [];
    }
  }

  public async resolveStreams(
    type: 'movie' | 'tv',
    id: string,
    configOverride?: string | null
  ): Promise<ResolvedStream[]> {
    const cacheKey = `${type}:${id}:${configOverride || ''}`;
    const cached = this.prefetchCache.get(cacheKey);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.streams;
    }

    const rawStreams = await this.fetchRawStreams(type, id, configOverride);
    const results: ResolvedStream[] = [];

    let counter = 0;
    for (const raw of rawStreams) {
      if (!raw.url) continue;

      const fullText = `${raw.name || ''} ${raw.title || ''} ${raw.description || ''} ${raw.behaviorHints?.filename || ''}`;
      // Reject CAM streams
      if (isCamStream(fullText)) {
        continue;
      }

      const badges = parseStreamBadges(raw);
      const score = computeQualityScore(badges);
      const headers = raw.behaviorHints?.proxyHeaders?.request;

      // Construct stream proxy URL
      const urlBase64 = Buffer.from(raw.url).toString('base64url');
      const headersBase64 = headers ? Buffer.from(JSON.stringify(headers)).toString('base64url') : '';
      const proxyUrl = `${config.publicServerUrl}/proxy/stream?url=${urlBase64}${headersBase64 ? `&headers=${headersBase64}` : ''}`;

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
      });
    }

    // Sort by quality score descending
    results.sort((a, b) => b.qualityScore - a.qualityScore);

    this.prefetchCache.set(cacheKey, {
      streams: results,
      expiresAt: now + 15 * 60 * 1000, // 15 mins cache
    });

    return results;
  }

  public async prefetchStreams(type: 'movie' | 'tv', id: string, configOverride?: string | null): Promise<void> {
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

