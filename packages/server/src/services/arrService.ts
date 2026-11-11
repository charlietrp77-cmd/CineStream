import { fetch as undiciFetch } from 'undici';
import path from 'path';
import { appSettings } from './appSettings';
import { StreamBadges } from './aiostreams';
import { bootstrapService } from './bootstrapService';
import { config } from '../config';

export interface ArrStatus {
  radarr: {
    configured: boolean;
    online: boolean;
    url: string;
    externalUrl?: string;
    version?: string;
    error?: string;
  };
  sonarr: {
    configured: boolean;
    online: boolean;
    url: string;
    externalUrl?: string;
    version?: string;
    error?: string;
  };
  indexers: {
    althub: boolean;
    nzbgeek: boolean;
    drunkenslug: boolean;
  };
  sabnzbd: {
    configured: boolean;
    online: boolean;
  };
}

export interface MatchedArrRelease {
  guid: string;
  indexerId: number;
  indexer: string;
  title: string;
  sizeBytes: number;
  sizeText: string;
  targetSizeBytes: number;
  sizeDiffBytes: number;
  sizeDiffPercent: number; // e.g. -3.5 (%)
  isWithin10Percent: boolean;
  resolution?: string;
  qualityName?: string;
  rejected: boolean;
  rejections?: string[];
  seeders?: number;
  score: number;
}

export interface PushResult {
  success: boolean;
  service: 'radarr' | 'sonarr';
  matchedRelease: MatchedArrRelease | null;
  message: string;
  isWithin10Percent: boolean;
  allCandidatesCount: number;
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

function resolveExternalArrUrl(rawUrl: string, clientHost?: string, defaultPort = 7878): string {
  if (!rawUrl) return '';
  try {
    const parsed = new URL(rawUrl);
    const host = clientHost || 'localhost';
    const isContainer = /^(radarr|sonarr|cinestream|cinestream-server|sabnzbd|localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(parsed.hostname);
    const resolvedHostname = isContainer ? host : parsed.hostname;
    const port = parsed.port || String(defaultPort);
    return `${parsed.protocol || 'http:'}//${resolvedHostname}:${port}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch (_) {
    return `http://${clientHost || 'localhost'}:${defaultPort}`;
  }
}

export class ArrService {
  private getRadarrConfig() {
    const url = appSettings.get('radarr_url').replace(/\/$/, '');
    const key = appSettings.get('radarr_api_key');
    return { url, key, isConfigured: Boolean(url && key) };
  }

  private getSonarrConfig() {
    const url = appSettings.get('sonarr_url').replace(/\/$/, '');
    const key = appSettings.get('sonarr_api_key');
    return { url, key, isConfigured: Boolean(url && key) };
  }

  public async getStatus(clientHost?: string): Promise<ArrStatus> {
    const radarr = this.getRadarrConfig();
    const sonarr = this.getSonarrConfig();

    const althubKey = Boolean(config.althubApiKey || appSettings.get('althub_api_key'));
    const nzbgeekKey = Boolean(config.nzbgeekApiKey || appSettings.get('nzbgeek_api_key'));
    const drunkenslugKey = Boolean(config.drunkenslugApiKey || appSettings.get('drunkenslug_api_key'));

    const indexersStatus = {
      althub: althubKey,
      nzbgeek: nzbgeekKey,
      drunkenslug: drunkenslugKey,
    };

    const sabKey = appSettings.get('sabnzbd_api_key') || process.env.SABNZBD_API_KEY || '';
    const sabStatus = {
      configured: Boolean(sabKey),
      online: false,
    };

    const status: ArrStatus = {
      radarr: {
        configured: radarr.isConfigured,
        online: false,
        url: radarr.url,
        externalUrl: resolveExternalArrUrl(radarr.url, clientHost, 7878),
      },
      sonarr: {
        configured: sonarr.isConfigured,
        online: false,
        url: sonarr.url,
        externalUrl: resolveExternalArrUrl(sonarr.url, clientHost, 8989),
      },
      indexers: indexersStatus,
      sabnzbd: sabStatus,
    };

    if (radarr.isConfigured) {
      try {
        const res = await undiciFetch(`${radarr.url}/api/v3/system/status`, {
          headers: { 'X-Api-Key': radarr.key },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const json: any = await res.json();
          status.radarr.online = true;
          status.radarr.version = json.version;

          // Auto-sync missing Newznab indexers (altHUB, NZBGeek, DrunkenSlug)
          bootstrapService.registerNewznabIndexers('radarr', radarr.url, radarr.key, [2000, 2030, 2040, 2045, 2060]).catch(() => {});
          bootstrapService.syncSabnzbdClients().catch(() => {});
          bootstrapService.ensureRootFolder('radarr', radarr.url, radarr.key).catch(() => {});

          // Check live indexers configured in Radarr
          try {
            const idxRes = await undiciFetch(`${radarr.url}/api/v3/indexer`, {
              headers: { 'X-Api-Key': radarr.key },
              signal: AbortSignal.timeout(3000),
            });
            if (idxRes.ok) {
              const idxList: any = await idxRes.json();
              if (Array.isArray(idxList)) {
                for (const idx of idxList) {
                  const name = (idx.name || '').toLowerCase();
                  const enabled = idx.enableAutomaticSearch || idx.enableInteractiveSearch || idx.enableRss;
                  if (enabled) {
                    if (name.includes('althub')) indexersStatus.althub = true;
                    if (name.includes('geek')) indexersStatus.nzbgeek = true;
                    if (name.includes('slug')) indexersStatus.drunkenslug = true;
                  }
                }
              }
            }
          } catch (_) {}
        } else {
          status.radarr.error = `HTTP ${res.status}`;
        }
      } catch (err: any) {
        status.radarr.error = err.message || 'Connection failed';
      }
    }

    if (sonarr.isConfigured) {
      try {
        const res = await undiciFetch(`${sonarr.url}/api/v3/system/status`, {
          headers: { 'X-Api-Key': sonarr.key },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const json: any = await res.json();
          status.sonarr.online = true;
          status.sonarr.version = json.version;

          // Auto-sync missing Newznab indexers (altHUB, NZBGeek, DrunkenSlug)
          bootstrapService.registerNewznabIndexers('sonarr', sonarr.url, sonarr.key, [5000, 5020, 5030, 5040, 5045]).catch(() => {});
          bootstrapService.syncSabnzbdClients().catch(() => {});
          bootstrapService.ensureRootFolder('sonarr', sonarr.url, sonarr.key).catch(() => {});

          // Check live indexers configured in Sonarr
          try {
            const idxRes = await undiciFetch(`${sonarr.url}/api/v3/indexer`, {
              headers: { 'X-Api-Key': sonarr.key },
              signal: AbortSignal.timeout(3000),
            });
            if (idxRes.ok) {
              const idxList: any = await idxRes.json();
              if (Array.isArray(idxList)) {
                for (const idx of idxList) {
                  const name = (idx.name || '').toLowerCase();
                  const enabled = idx.enableAutomaticSearch || idx.enableInteractiveSearch || idx.enableRss;
                  if (enabled) {
                    if (name.includes('althub')) indexersStatus.althub = true;
                    if (name.includes('geek')) indexersStatus.nzbgeek = true;
                    if (name.includes('slug')) indexersStatus.drunkenslug = true;
                  }
                }
              }
            }
          } catch (_) {}
        } else {
          status.sonarr.error = `HTTP ${res.status}`;
        }
      } catch (err: any) {
        status.sonarr.error = err.message || 'Connection failed';
      }
    }

    // Check SABnzbd health if configured
    if (sabStatus.configured) {
      try {
        const sabRes = await undiciFetch(`http://sabnzbd:8080/api?mode=version&output=json&apikey=${sabKey}`, {
          signal: AbortSignal.timeout(2000),
        });
        if (sabRes.ok) {
          const json: any = await sabRes.json();
          if (json.version && json.status !== false) {
            sabStatus.online = true;
          }
        }
      } catch (_) {}
    }

    return status;
  }

  /**
   * Evaluates raw releases from Radarr or Sonarr against the user's selected CineStream stream.
   * Ranks candidates by proximity to target size (+-10%) and audio/video feature alignment.
   */
  public matchReleases(
    rawReleases: any[],
    targetSizeBytes: number,
    targetBadges?: Partial<StreamBadges>
  ): MatchedArrRelease[] {
    const candidates: MatchedArrRelease[] = [];

    for (const raw of rawReleases) {
      if (!raw || !raw.guid || !raw.size) continue;

      const sizeBytes = Number(raw.size) || 0;
      const sizeDiffBytes = sizeBytes - targetSizeBytes;
      const sizeDiffPercent = targetSizeBytes > 0 ? (sizeDiffBytes / targetSizeBytes) * 100 : 0;
      const absDiff = Math.abs(sizeDiffPercent);
      const isWithin10 = absDiff <= 10;

      const title = raw.title || '';
      const qualityName = raw.quality?.quality?.name || '';
      const resolutionNum = raw.quality?.quality?.resolution || 0;
      const is4K = resolutionNum === 2160 || /\b(4K|2160p|UHD)\b/i.test(title);
      const is1080p = resolutionNum === 1080 || /\b(1080p|FHD)\b/i.test(title);
      const hasDV = /\b(DV|Dolby\s*Vision|DoVi)\b/i.test(title);
      const hasHDR = /\b(HDR|HDR10)\b/i.test(title) || hasDV;
      const hasRemux = /\b(REMUX)\b/i.test(title);
      const hasAtmos = /\b(Atmos)\b/i.test(title);

      // Scoring
      let score = 1000 - Math.min(1000, absDiff * 25);
      if (isWithin10) score += 500; // Big bonus for hitting the 10% target

      if (targetBadges?.resolution === '4K' && is4K) score += 300;
      else if (targetBadges?.resolution === '1080p' && is1080p) score += 300;
      else if (targetBadges?.resolution === '4K' && !is4K) score -= 600;

      if (targetBadges?.dolbyVision && hasDV) score += 200;
      if (targetBadges?.hdr && hasHDR) score += 100;
      if (targetBadges?.remux && hasRemux) score += 250;
      if (targetBadges?.atmos && hasAtmos) score += 100;

      if (raw.seeders && typeof raw.seeders === 'number') {
        score += Math.min(150, raw.seeders * 3);
      }

      if (raw.rejected) {
        score -= 500;
      }

      candidates.push({
        guid: raw.guid,
        indexerId: raw.indexerId || 0,
        indexer: raw.indexer || 'Indexer',
        title,
        sizeBytes,
        sizeText: formatBytes(sizeBytes),
        targetSizeBytes,
        sizeDiffBytes,
        sizeDiffPercent: Math.round(sizeDiffPercent * 10) / 10,
        isWithin10Percent: isWithin10,
        resolution: is4K ? '4K' : is1080p ? '1080p' : 'HD',
        qualityName,
        rejected: Boolean(raw.rejected),
        rejections: raw.rejections || [],
        seeders: raw.seeders,
        score: Math.round(score),
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  }

  /**
   * Pushes a movie search to Radarr, finds an equivalent release (+-10% size), and pushes to download queue.
   */
  public async pushRadarrMovie(params: {
    tmdbId: number;
    imdbId: string;
    movieTitle: string;
    releaseTitle?: string;
    year?: string;
    targetSizeBytes: number;
    targetBadges?: Partial<StreamBadges>;
    targetMagnetUrl?: string;
    targetNzbUrl?: string;
    selectedGuid?: string;
    selectedIndexerId?: number;
  }): Promise<PushResult> {
    const radarr = this.getRadarrConfig();
    if (!radarr.isConfigured) {
      return {
        success: false,
        service: 'radarr',
        matchedRelease: null,
        message: 'Radarr is not configured. Please set RADARR_URL and RADARR_API_KEY in settings or .env.',
        isWithin10Percent: false,
        allCandidatesCount: 0,
        error: 'RADARR_NOT_CONFIGURED',
      };
    }

    // 1. Ensure movie exists in Radarr
    let movieId: number | null = null;
    try {
      const getRes = await undiciFetch(`${radarr.url}/api/v3/movie?tmdbId=${params.tmdbId}`, {
        headers: { 'X-Api-Key': radarr.key },
        signal: AbortSignal.timeout(6000),
      });
      if (getRes.ok) {
        const movies: any = await getRes.json();
        if (Array.isArray(movies) && movies.length > 0) {
          movieId = movies[0].id;
        }
      }

      if (!movieId) {
        // Lookup & add movie
        const lookupRes = await undiciFetch(`${radarr.url}/api/v3/movie/lookup/tmdb?tmdbId=${params.tmdbId}`, {
          headers: { 'X-Api-Key': radarr.key },
          signal: AbortSignal.timeout(6000),
        });
        if (!lookupRes.ok) throw new Error('Could not lookup movie in Radarr');
        const lookupMovie: any = await lookupRes.json();

        // Get root folder & quality profile
        const rootRes = await undiciFetch(`${radarr.url}/api/v3/rootfolder`, {
          headers: { 'X-Api-Key': radarr.key },
        });
        const rootFolders: any = await rootRes.json();
        const rootPath = rootFolders[0]?.path || '/movies';

        const qpRes = await undiciFetch(`${radarr.url}/api/v3/qualityprofile`, {
          headers: { 'X-Api-Key': radarr.key },
        });
        const qp: any = await qpRes.json();
        const qpId = qp[0]?.id || 1;

        const addRes = await undiciFetch(`${radarr.url}/api/v3/movie`, {
          method: 'POST',
          headers: {
            'X-Api-Key': radarr.key,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: lookupMovie.title || params.movieTitle,
            tmdbId: params.tmdbId,
            year: lookupMovie.year || parseInt(params.year || '0', 10),
            qualityProfileId: qpId,
            rootFolderPath: rootPath,
            monitored: true,
            addOptions: { searchForMovie: false },
          }),
        });
        if (addRes.ok) {
          const added: any = await addRes.json();
          movieId = added.id;
        }
      }
    } catch (err: any) {
      return {
        success: false,
        service: 'radarr',
        matchedRelease: null,
        message: `Failed to find or add movie in Radarr: ${err.message}`,
        isWithin10Percent: false,
        allCandidatesCount: 0,
        error: err.message,
      };
    }

    if (!movieId) {
      return {
        success: false,
        service: 'radarr',
        matchedRelease: null,
        message: 'Could not resolve or create movie ID in Radarr.',
        isWithin10Percent: false,
        allCandidatesCount: 0,
      };
    }

    // 1b. If exact magnet link is available, push directly into Radarr
    if (params.targetMagnetUrl) {
      try {
        const directPushRes = await undiciFetch(`${radarr.url}/api/v3/release/push`, {
          method: 'POST',
          headers: {
            'X-Api-Key': radarr.key,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: params.movieTitle,
            downloadUrl: params.targetMagnetUrl,
            protocol: 'torrent',
            publishDate: new Date().toISOString(),
          }),
        });
        if (directPushRes.ok) {
          return {
            success: true,
            service: 'radarr',
            matchedRelease: {
              guid: params.targetMagnetUrl,
              indexerId: 0,
              indexer: 'AIOStreams Magnet',
              title: params.movieTitle,
              sizeBytes: params.targetSizeBytes,
              sizeText: formatBytes(params.targetSizeBytes),
              targetSizeBytes: params.targetSizeBytes,
              sizeDiffBytes: 0,
              sizeDiffPercent: 0,
              isWithin10Percent: true,
              resolution: params.targetBadges?.resolution || '4K',
              qualityName: 'Direct Magnet',
              rejected: false,
              score: 9999,
            },
            message: `Pushed exact stream magnet link directly into Radarr!`,
            isWithin10Percent: true,
            allCandidatesCount: 1,
          };
        }
      } catch (_) {}
    }

    // 1c. If direct NZB link is available, push directly into Radarr (Usenet)
    if (params.targetNzbUrl) {
      const cleanReleaseName = (params.releaseTitle || params.movieTitle)
        .replace(/\.nzb$/i, '')
        .trim();

      try {
        const directPushRes = await undiciFetch(`${radarr.url}/api/v3/release/push`, {
          method: 'POST',
          headers: {
            'X-Api-Key': radarr.key,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: cleanReleaseName,
            downloadUrl: params.targetNzbUrl,
            protocol: 'usenet',
            publishDate: new Date().toISOString(),
            size: params.targetSizeBytes || 0,
            indexer: 'AltHub',
          }),
        });
        if (directPushRes.ok) {
          return {
            success: true,
            service: 'radarr',
            matchedRelease: {
              guid: params.targetNzbUrl,
              indexerId: 0,
              indexer: 'AltHub (NZB)',
              title: cleanReleaseName,
              sizeBytes: params.targetSizeBytes,
              sizeText: formatBytes(params.targetSizeBytes),
              targetSizeBytes: params.targetSizeBytes,
              sizeDiffBytes: 0,
              sizeDiffPercent: 0,
              isWithin10Percent: true,
              resolution: params.targetBadges?.resolution || '4K',
              qualityName: 'Direct NZB',
              rejected: false,
              score: 9999,
            },
            message: `Pushed exact stream NZB directly into Radarr (Usenet)!`,
            isWithin10Percent: true,
            allCandidatesCount: 1,
          };
        } else {
          const errText = await directPushRes.text();
          console.warn('[Radarr] Direct release push response:', errText);
        }
      } catch (err: any) {
        console.warn('[Radarr] Direct release push network notice:', err.message);
      }

      // If Radarr rejected or has no indexer for it, queue directly in SABnzbd
      const sabKey = appSettings.get('sabnzbd_api_key');
      if (sabKey) {
        try {
          const sabRes = await undiciFetch(`http://sabnzbd:8080/api?mode=addurl&name=${encodeURIComponent(params.targetNzbUrl)}&nzbname=${encodeURIComponent(cleanReleaseName)}&cat=movies&apikey=${sabKey}`, {
            headers: { Host: 'localhost:8080' },
            signal: AbortSignal.timeout(5000),
          });
          if (sabRes.ok) {
            const sabJson: any = await sabRes.json();
            if (sabJson?.status === true) {
              return {
                success: true,
                service: 'radarr',
                matchedRelease: {
                  guid: params.targetNzbUrl,
                  indexerId: 0,
                  indexer: 'AltHub -> SABnzbd',
                  title: cleanReleaseName,
                  sizeBytes: params.targetSizeBytes,
                  sizeText: formatBytes(params.targetSizeBytes),
                  targetSizeBytes: params.targetSizeBytes,
                  sizeDiffBytes: 0,
                  sizeDiffPercent: 0,
                  isWithin10Percent: true,
                  resolution: params.targetBadges?.resolution || '4K',
                  qualityName: 'Direct SABnzbd',
                  rejected: false,
                  score: 9999,
                },
                message: `Sent AltHub NZB directly to SABnzbd queue (downloading to NAS /movies)!`,
                isWithin10Percent: true,
                allCandidatesCount: 1,
              };
            }
          }
        } catch (_) {}
      }
    }

    // 2. Fetch releases from Radarr indexers
    let rawReleases: any[] = [];
    try {
      const releaseRes = await undiciFetch(`${radarr.url}/api/v3/release?movieId=${movieId}`, {
        headers: { 'X-Api-Key': radarr.key },
        signal: AbortSignal.timeout(30000), // Indexer searches can take up to 30s
      });
      if (releaseRes.ok) {
        rawReleases = (await releaseRes.json()) as any[];
      }
    } catch (err: any) {
      return {
        success: false,
        service: 'radarr',
        matchedRelease: null,
        message: `Radarr indexer search failed: ${err.message}`,
        isWithin10Percent: false,
        allCandidatesCount: 0,
        error: err.message,
      };
    }

    if (!Array.isArray(rawReleases) || rawReleases.length === 0) {
      return {
        success: false,
        service: 'radarr',
        matchedRelease: null,
        message: 'No releases found on Radarr indexers for this movie.',
        isWithin10Percent: false,
        allCandidatesCount: 0,
      };
    }

    // 3. Match release within 10% size
    const ranked = this.matchReleases(rawReleases, params.targetSizeBytes, params.targetBadges);
    if (ranked.length === 0) {
      return {
        success: false,
        service: 'radarr',
        matchedRelease: null,
        message: 'No valid releases found across configured indexers.',
        isWithin10Percent: false,
        allCandidatesCount: 0,
      };
    }

    // If specific GUID was explicitly chosen, use that, else pick highest ranked
    const targetCandidate = params.selectedGuid
      ? ranked.find((r) => r.guid === params.selectedGuid) || ranked[0]
      : ranked[0];

    // 4. Push release to Radarr download queue
    try {
      const pushRes = await undiciFetch(`${radarr.url}/api/v3/release`, {
        method: 'POST',
        headers: {
          'X-Api-Key': radarr.key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          guid: targetCandidate.guid,
          indexerId: targetCandidate.indexerId,
        }),
      });

      if (!pushRes.ok) {
        const errorText = await pushRes.text();
        return {
          success: false,
          service: 'radarr',
          matchedRelease: targetCandidate,
          message: `Radarr rejected release push: ${errorText}`,
          isWithin10Percent: targetCandidate.isWithin10Percent,
          allCandidatesCount: ranked.length,
          error: errorText,
        };
      }

      const diffPrefix = targetCandidate.sizeDiffPercent > 0 ? `+${targetCandidate.sizeDiffPercent}%` : `${targetCandidate.sizeDiffPercent}%`;
      const withinMsg = targetCandidate.isWithin10Percent
        ? `Found release within 10% size (${targetCandidate.sizeText}, ${diffPrefix}) and pushed to Radarr queue!`
        : `Found closest available release (${targetCandidate.sizeText}, ${diffPrefix}) and pushed to Radarr queue!`;

      return {
        success: true,
        service: 'radarr',
        matchedRelease: targetCandidate,
        message: withinMsg,
        isWithin10Percent: targetCandidate.isWithin10Percent,
        allCandidatesCount: ranked.length,
      };
    } catch (err: any) {
      return {
        success: false,
        service: 'radarr',
        matchedRelease: targetCandidate,
        message: `Failed to push release to Radarr: ${err.message}`,
        isWithin10Percent: targetCandidate.isWithin10Percent,
        allCandidatesCount: ranked.length,
        error: err.message,
      };
    }
  }

  /**
   * Pushes an episode or season search to Sonarr, finds an equivalent release (+-10% size), and pushes to download queue.
   */
  public async pushSonarrSeries(params: {
    tvdbId?: number;
    imdbId: string;
    seriesTitle: string;
    releaseTitle?: string;
    seasonNumber: number;
    episodeNumber?: number; // Omit for full season pack
    targetSizeBytes: number;
    targetBadges?: Partial<StreamBadges>;
    targetMagnetUrl?: string;
    targetNzbUrl?: string;
    selectedGuid?: string;
  }): Promise<PushResult> {
    const sonarr = this.getSonarrConfig();
    if (!sonarr.isConfigured) {
      return {
        success: false,
        service: 'sonarr',
        matchedRelease: null,
        message: 'Sonarr is not configured. Please set SONARR_URL and SONARR_API_KEY in settings or .env.',
        isWithin10Percent: false,
        allCandidatesCount: 0,
        error: 'SONARR_NOT_CONFIGURED',
      };
    }

    // 1. Ensure series exists in Sonarr
    const seriesId = await this.ensureSeriesInSonarr(params.imdbId, params.seriesTitle, params.tvdbId);
    if (!seriesId) {
      return {
        success: false,
        service: 'sonarr',
        matchedRelease: null,
        message: 'Could not resolve or create series ID in Sonarr.',
        isWithin10Percent: false,
        allCandidatesCount: 0,
      };
    }

    // 1b. If exact magnet link is available, push directly into Sonarr
    if (params.targetMagnetUrl) {
      try {
        const directPushRes = await undiciFetch(`${sonarr.url}/api/v3/release/push`, {
          method: 'POST',
          headers: {
            'X-Api-Key': sonarr.key,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: params.seriesTitle,
            downloadUrl: params.targetMagnetUrl,
            protocol: 'torrent',
            publishDate: new Date().toISOString(),
          }),
        });
        if (directPushRes.ok) {
          return {
            success: true,
            service: 'sonarr',
            matchedRelease: {
              guid: params.targetMagnetUrl,
              indexerId: 0,
              indexer: 'AIOStreams Magnet',
              title: params.seriesTitle,
              sizeBytes: params.targetSizeBytes,
              sizeText: formatBytes(params.targetSizeBytes),
              targetSizeBytes: params.targetSizeBytes,
              sizeDiffBytes: 0,
              sizeDiffPercent: 0,
              isWithin10Percent: true,
              resolution: params.targetBadges?.resolution || '4K',
              qualityName: 'Direct Magnet',
              rejected: false,
              score: 9999,
            },
            message: `Pushed exact stream magnet link directly into Sonarr!`,
            isWithin10Percent: true,
            allCandidatesCount: 1,
          };
        }
      } catch (_) {}
    }

    // 1c. If direct NZB link is available, push directly into Sonarr (Usenet)
    if (params.targetNzbUrl) {
      const cleanReleaseName = (params.releaseTitle || params.seriesTitle)
        .replace(/\.nzb$/i, '')
        .trim();

      try {
        const directPushRes = await undiciFetch(`${sonarr.url}/api/v3/release/push`, {
          method: 'POST',
          headers: {
            'X-Api-Key': sonarr.key,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: cleanReleaseName,
            downloadUrl: params.targetNzbUrl,
            protocol: 'usenet',
            publishDate: new Date().toISOString(),
            size: params.targetSizeBytes || 0,
            indexer: 'AltHub',
          }),
        });
        if (directPushRes.ok) {
          return {
            success: true,
            service: 'sonarr',
            matchedRelease: {
              guid: params.targetNzbUrl,
              indexerId: 0,
              indexer: 'AltHub (NZB)',
              title: cleanReleaseName,
              sizeBytes: params.targetSizeBytes,
              sizeText: formatBytes(params.targetSizeBytes),
              targetSizeBytes: params.targetSizeBytes,
              sizeDiffBytes: 0,
              sizeDiffPercent: 0,
              isWithin10Percent: true,
              resolution: params.targetBadges?.resolution || '4K',
              qualityName: 'Direct NZB',
              rejected: false,
              score: 9999,
            },
            message: `Pushed exact stream NZB directly into Sonarr (Usenet)!`,
            isWithin10Percent: true,
            allCandidatesCount: 1,
          };
        } else {
          const errText = await directPushRes.text();
          console.warn('[Sonarr] Direct release push response:', errText);
        }
      } catch (err: any) {
        console.warn('[Sonarr] Direct release push network notice:', err.message);
      }

      // If Sonarr rejected or has no indexer for it, queue directly in SABnzbd
      const sabKey = appSettings.get('sabnzbd_api_key');
      if (sabKey) {
        try {
          const sabRes = await undiciFetch(`http://sabnzbd:8080/api?mode=addurl&name=${encodeURIComponent(params.targetNzbUrl)}&nzbname=${encodeURIComponent(cleanReleaseName)}&cat=tv&apikey=${sabKey}`, {
            headers: { Host: 'localhost:8080' },
            signal: AbortSignal.timeout(5000),
          });
          if (sabRes.ok) {
            const sabJson: any = await sabRes.json();
            if (sabJson?.status === true) {
              return {
                success: true,
                service: 'sonarr',
                matchedRelease: {
                  guid: params.targetNzbUrl,
                  indexerId: 0,
                  indexer: 'AltHub -> SABnzbd',
                  title: cleanReleaseName,
                  sizeBytes: params.targetSizeBytes,
                  sizeText: formatBytes(params.targetSizeBytes),
                  targetSizeBytes: params.targetSizeBytes,
                  sizeDiffBytes: 0,
                  sizeDiffPercent: 0,
                  isWithin10Percent: true,
                  resolution: params.targetBadges?.resolution || '4K',
                  qualityName: 'Direct SABnzbd',
                  rejected: false,
                  score: 9999,
                },
                message: `Sent AltHub NZB directly to SABnzbd queue (downloading to NAS /tv)!`,
                isWithin10Percent: true,
                allCandidatesCount: 1,
              };
            }
          }
        } catch (_) {}
      }
    }

    // 2. Fetch releases from Sonarr
    let releaseUrl = `${sonarr.url}/api/v3/release?seriesId=${seriesId}`;
    if (params.episodeNumber !== undefined) {
      // Find episode ID
      try {
        const epRes = await undiciFetch(`${sonarr.url}/api/v3/episode?seriesId=${seriesId}&seasonNumber=${params.seasonNumber}`, {
          headers: { 'X-Api-Key': sonarr.key },
        });
        if (epRes.ok) {
          const episodes: any = await epRes.json();
          const targetEp = episodes.find((e: any) => e.episodeNumber === params.episodeNumber);
          if (targetEp) {
            releaseUrl += `&episodeId=${targetEp.id}`;
          }
        }
      } catch (_) {}
    } else {
      releaseUrl += `&seasonNumber=${params.seasonNumber}`;
    }

    let rawReleases: any[] = [];
    try {
      const releaseRes = await undiciFetch(releaseUrl, {
        headers: { 'X-Api-Key': sonarr.key },
        signal: AbortSignal.timeout(30000),
      });
      if (releaseRes.ok) {
        rawReleases = (await releaseRes.json()) as any[];
      }
    } catch (err: any) {
      return {
        success: false,
        service: 'sonarr',
        matchedRelease: null,
        message: `Sonarr indexer search failed: ${err.message}`,
        isWithin10Percent: false,
        allCandidatesCount: 0,
        error: err.message,
      };
    }

    if (!Array.isArray(rawReleases) || rawReleases.length === 0) {
      return {
        success: false,
        service: 'sonarr',
        matchedRelease: null,
        message: 'No releases found on Sonarr indexers for this episode/season.',
        isWithin10Percent: false,
        allCandidatesCount: 0,
      };
    }

    // 3. Match release within 10% size
    const ranked = this.matchReleases(rawReleases, params.targetSizeBytes, params.targetBadges);
    if (ranked.length === 0) {
      return {
        success: false,
        service: 'sonarr',
        matchedRelease: null,
        message: 'No valid releases found across configured Sonarr indexers.',
        isWithin10Percent: false,
        allCandidatesCount: 0,
      };
    }

    const targetCandidate = params.selectedGuid
      ? ranked.find((r) => r.guid === params.selectedGuid) || ranked[0]
      : ranked[0];

    // 4. Push release to Sonarr download queue
    try {
      const pushRes = await undiciFetch(`${sonarr.url}/api/v3/release`, {
        method: 'POST',
        headers: {
          'X-Api-Key': sonarr.key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          guid: targetCandidate.guid,
          indexerId: targetCandidate.indexerId,
        }),
      });

      if (!pushRes.ok) {
        const errorText = await pushRes.text();
        return {
          success: false,
          service: 'sonarr',
          matchedRelease: targetCandidate,
          message: `Sonarr rejected release push: ${errorText}`,
          isWithin10Percent: targetCandidate.isWithin10Percent,
          allCandidatesCount: ranked.length,
          error: errorText,
        };
      }

      const diffPrefix = targetCandidate.sizeDiffPercent > 0 ? `+${targetCandidate.sizeDiffPercent}%` : `${targetCandidate.sizeDiffPercent}%`;
      const withinMsg = targetCandidate.isWithin10Percent
        ? `Found release within 10% size (${targetCandidate.sizeText}, ${diffPrefix}) and pushed to Sonarr queue!`
        : `Found closest available release (${targetCandidate.sizeText}, ${diffPrefix}) and pushed to Sonarr queue!`;

      return {
        success: true,
        service: 'sonarr',
        matchedRelease: targetCandidate,
        message: withinMsg,
        isWithin10Percent: targetCandidate.isWithin10Percent,
        allCandidatesCount: ranked.length,
      };
    } catch (err: any) {
      return {
        success: false,
        service: 'sonarr',
        matchedRelease: targetCandidate,
        message: `Failed to push release to Sonarr: ${err.message}`,
        isWithin10Percent: targetCandidate.isWithin10Percent,
        allCandidatesCount: ranked.length,
        error: err.message,
      };
    }
  }

  /**
   * Notifies Radarr or Sonarr when a backend download finishes so it can auto-import and register the file into the library.
   */
  public async notifyDownloadCompleted(mediaType: 'movie' | 'tv', filePath: string): Promise<void> {
    const folderPath = path.dirname(filePath);
    try {
      if (mediaType === 'movie') {
        const radarr = this.getRadarrConfig();
        if (radarr.isConfigured) {
          await undiciFetch(`${radarr.url}/api/v3/command`, {
            method: 'POST',
            headers: {
              'X-Api-Key': radarr.key,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: 'DownloadedMoviesScan',
              path: folderPath,
            }),
          });
        }
      } else {
        const sonarr = this.getSonarrConfig();
        if (sonarr.isConfigured) {
          await undiciFetch(`${sonarr.url}/api/v3/command`, {
            method: 'POST',
            headers: {
              'X-Api-Key': sonarr.key,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: 'DownloadedEpisodesScan',
              path: folderPath,
            }),
          });
        }
      }
    } catch (err) {
      console.warn(`Failed to notify Arr service of completed download:`, err);
    }
  }

  /**
   * Looks up a series in Sonarr, adds it if not present, and returns the Sonarr series ID.
   */
  public async ensureSeriesInSonarr(imdbId: string, seriesTitle: string, tvdbId?: number): Promise<number | null> {
    const sonarr = this.getSonarrConfig();
    if (!sonarr.isConfigured) return null;

    try {
      const getRes = await undiciFetch(`${sonarr.url}/api/v3/series?includeSeasonImages=false`, {
        headers: { 'X-Api-Key': sonarr.key },
      });
      if (getRes.ok) {
        const seriesList: any = await getRes.json();
        const found = seriesList.find((s: any) =>
          (tvdbId && s.tvdbId === tvdbId) ||
          (imdbId && s.imdbId === imdbId) ||
          (s.title && s.title.toLowerCase() === seriesTitle.toLowerCase())
        );
        if (found) return found.id;
      }

      // Lookup series
      const term = tvdbId ? `tvdb:${tvdbId}` : `imdb:${imdbId}`;
      const lookupRes = await undiciFetch(`${sonarr.url}/api/v3/series/lookup?term=${encodeURIComponent(term)}`, {
        headers: { 'X-Api-Key': sonarr.key },
      });
      if (!lookupRes.ok) return null;
      const lookupList: any = await lookupRes.json();
      const lookupSeries = lookupList[0];
      if (!lookupSeries) return null;

      // Root folder & Quality profile
      const rootRes = await undiciFetch(`${sonarr.url}/api/v3/rootfolder`, { headers: { 'X-Api-Key': sonarr.key } });
      const rootFolders: any = await rootRes.json();
      const rootPath = rootFolders[0]?.path || '/tv';

      const qpRes = await undiciFetch(`${sonarr.url}/api/v3/qualityprofile`, { headers: { 'X-Api-Key': sonarr.key } });
      const qp: any = await qpRes.json();
      const qpId = qp[0]?.id || 1;

      const addRes = await undiciFetch(`${sonarr.url}/api/v3/series`, {
        method: 'POST',
        headers: {
          'X-Api-Key': sonarr.key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: lookupSeries.title,
          tvdbId: lookupSeries.tvdbId,
          qualityProfileId: qpId,
          rootFolderPath: rootPath,
          monitored: true,
          seasonFolder: true,
          addOptions: { searchForMissingEpisodes: false },
        }),
      });
      if (addRes.ok) {
        const added: any = await addRes.json();
        return added.id || null;
      }
    } catch (_) {}
    return null;
  }

  /**
   * Returns total number of episodes in a specific season registered in Sonarr.
   */
  public async getSonarrSeasonTotalEpisodes(imdbId: string, seriesTitle: string, seasonNumber: number, tvdbId?: number): Promise<number> {
    const sonarr = this.getSonarrConfig();
    if (!sonarr.isConfigured) return 0;
    const seriesId = await this.ensureSeriesInSonarr(imdbId, seriesTitle, tvdbId);
    if (!seriesId) return 0;

    try {
      const epRes = await undiciFetch(`${sonarr.url}/api/v3/episode?seriesId=${seriesId}&seasonNumber=${seasonNumber}`, {
        headers: { 'X-Api-Key': sonarr.key },
        signal: AbortSignal.timeout(5000),
      });
      if (!epRes.ok) return 0;
      const episodes = (await epRes.json()) as any[];
      return Array.isArray(episodes) ? episodes.length : 0;
    } catch (_) {
      return 0;
    }
  }

  /**
   * Triggers download searches for all missing episodes in a season in strict sequential order (E1, then E2, etc.).
   */
  public async downloadSonarrSeasonInOrder(
    imdbId: string,
    seriesTitle: string,
    seasonNumber: number,
    startEpisodeNumber: number = 1,
    tvdbId?: number
  ): Promise<{ success: boolean; queuedEpisodes: number[]; totalMissing: number }> {
    const sonarr = this.getSonarrConfig();
    if (!sonarr.isConfigured) {
      return { success: false, queuedEpisodes: [], totalMissing: 0 };
    }

    const seriesId = await this.ensureSeriesInSonarr(imdbId, seriesTitle, tvdbId);
    if (!seriesId) {
      return { success: false, queuedEpisodes: [], totalMissing: 0 };
    }

    try {
      const epRes = await undiciFetch(`${sonarr.url}/api/v3/episode?seriesId=${seriesId}&seasonNumber=${seasonNumber}`, {
        headers: { 'X-Api-Key': sonarr.key },
        signal: AbortSignal.timeout(8000),
      });
      if (!epRes.ok) return { success: false, queuedEpisodes: [], totalMissing: 0 };
      const episodes = (await epRes.json()) as any[];
      if (!Array.isArray(episodes) || episodes.length === 0) {
        return { success: false, queuedEpisodes: [], totalMissing: 0 };
      }

      // Filter for missing episodes >= startEpisodeNumber
      const missing = episodes
        .filter((ep) => ep.episodeNumber >= startEpisodeNumber && !ep.hasFile)
        .sort((a, b) => a.episodeNumber - b.episodeNumber);

      if (missing.length === 0) {
        console.log(`[Sonarr] Season ${seasonNumber} (from ep ${startEpisodeNumber}) is already fully downloaded.`);
        return { success: true, queuedEpisodes: [], totalMissing: 0 };
      }

      // Ensure the season is monitored in Sonarr
      try {
        const sRes = await undiciFetch(`${sonarr.url}/api/v3/series/${seriesId}`, {
          headers: { 'X-Api-Key': sonarr.key },
        });
        if (sRes.ok) {
          const sData: any = await sRes.json();
          const targetSeason = sData.seasons?.find((s: any) => s.seasonNumber === seasonNumber);
          if (targetSeason && !targetSeason.monitored) {
            targetSeason.monitored = true;
            await undiciFetch(`${sonarr.url}/api/v3/series/${seriesId}`, {
              method: 'PUT',
              headers: { 'X-Api-Key': sonarr.key, 'Content-Type': 'application/json' },
              body: JSON.stringify(sData),
            });
          }
        }
      } catch (_) {}

      // Trigger EpisodeSearch in sequential order
      const queuedEpisodes: number[] = [];
      for (const ep of missing) {
        try {
          const cmdRes = await undiciFetch(`${sonarr.url}/api/v3/command`, {
            method: 'POST',
            headers: {
              'X-Api-Key': sonarr.key,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: 'EpisodeSearch',
              episodeIds: [ep.id],
            }),
          });
          if (cmdRes.ok) {
            queuedEpisodes.push(ep.episodeNumber);
            console.log(`✅ [Sonarr] Queued S${seasonNumber}E${ep.episodeNumber} download search in sequential order`);
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        } catch (err: any) {
          console.warn(`[Sonarr] Failed to queue episode S${seasonNumber}E${ep.episodeNumber}:`, err.message);
        }
      }

      return {
        success: true,
        queuedEpisodes,
        totalMissing: missing.length,
      };
    } catch (err: any) {
      console.warn(`[Sonarr] downloadSonarrSeasonInOrder error:`, err.message);
      return { success: false, queuedEpisodes: [], totalMissing: 0 };
    }
  }

  /**
   * Checks Sonarr to verify if a specific series episode has already been downloaded (hasFile: true).
   */
  public async isEpisodeDownloadedInSonarr(
    imdbId: string,
    seasonNumber: number,
    episodeNumber: number,
    tvdbId?: number
  ): Promise<boolean> {
    const sonarr = this.getSonarrConfig();
    if (!sonarr.isConfigured) return false;

    try {
      const getRes = await undiciFetch(`${sonarr.url}/api/v3/series?includeSeasonImages=false`, {
        headers: { 'X-Api-Key': sonarr.key },
        signal: AbortSignal.timeout(5000),
      });
      if (!getRes.ok) return false;
      const seriesList: any = await getRes.json();
      if (!Array.isArray(seriesList)) return false;

      const found = seriesList.find(
        (s: any) =>
          (tvdbId && s.tvdbId === tvdbId) ||
          (imdbId && s.imdbId === imdbId)
      );
      if (!found || !found.id) return false;

      const epRes = await undiciFetch(`${sonarr.url}/api/v3/episode?seriesId=${found.id}&seasonNumber=${seasonNumber}`, {
        headers: { 'X-Api-Key': sonarr.key },
        signal: AbortSignal.timeout(5000),
      });
      if (!epRes.ok) return false;
      const epList: any = await epRes.json();
      if (!Array.isArray(epList)) return false;

      const ep = epList.find((e: any) => e.episodeNumber === episodeNumber);
      return Boolean(ep && ep.hasFile);
    } catch (_) {
      return false;
    }
  }

  /**
   * Adds or updates a TV series in Sonarr with continuous monitoring enabled (all seasons monitored)
   * and triggers an automatic search for any missing episodes.
   */
  public async monitorSeriesInSonarr(
    imdbId: string,
    seriesTitle: string,
    tmdbId?: number,
    tvdbId?: number
  ): Promise<{ success: boolean; message: string; seriesId?: number }> {
    const sonarr = this.getSonarrConfig();
    if (!sonarr.isConfigured) {
      return { success: false, message: 'Sonarr is not configured.' };
    }

    try {
      // 1. Check if series already exists in Sonarr
      const getRes = await undiciFetch(`${sonarr.url}/api/v3/series?includeSeasonImages=false`, {
        headers: { 'X-Api-Key': sonarr.key },
      });
      let existingSeries: any = null;
      if (getRes.ok) {
        const seriesList = (await getRes.json()) as any[];
        if (Array.isArray(seriesList)) {
          existingSeries = seriesList.find(
            (s: any) =>
              (tvdbId && s.tvdbId === tvdbId) ||
              (imdbId && s.imdbId === imdbId) ||
              (s.title && s.title.toLowerCase() === seriesTitle.toLowerCase())
          );
        }
      }

      if (existingSeries) {
        let modified = false;
        if (!existingSeries.monitored) {
          existingSeries.monitored = true;
          modified = true;
        }
        if (Array.isArray(existingSeries.seasons)) {
          for (const s of existingSeries.seasons) {
            if (!s.monitored) {
              s.monitored = true;
              modified = true;
            }
          }
        }

        if (modified) {
          await undiciFetch(`${sonarr.url}/api/v3/series/${existingSeries.id}`, {
            method: 'PUT',
            headers: { 'X-Api-Key': sonarr.key, 'Content-Type': 'application/json' },
            body: JSON.stringify(existingSeries),
          });
        }

        // Trigger SeriesSearch to immediately search indexers for all missing episodes
        await undiciFetch(`${sonarr.url}/api/v3/command`, {
          method: 'POST',
          headers: { 'X-Api-Key': sonarr.key, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'SeriesSearch',
            seriesId: existingSeries.id,
          }),
        });

        console.log(`✅ [Sonarr] Continuous monitoring enabled & SeriesSearch triggered for "${seriesTitle}" (ID: ${existingSeries.id})`);
        return { success: true, message: `Monitoring "${seriesTitle}" in Sonarr for all missing & new episodes.`, seriesId: existingSeries.id };
      }

      // 2. Lookup series in Sonarr
      const term = tvdbId ? `tvdb:${tvdbId}` : `imdb:${imdbId}`;
      const lookupRes = await undiciFetch(`${sonarr.url}/api/v3/series/lookup?term=${encodeURIComponent(term)}`, {
        headers: { 'X-Api-Key': sonarr.key },
      });
      if (!lookupRes.ok) throw new Error('Could not lookup series in Sonarr');
      const lookupList = (await lookupRes.json()) as any[];
      const lookupSeries = lookupList[0];
      if (!lookupSeries) throw new Error(`Series "${seriesTitle}" not found in Sonarr lookup`);

      // 3. Root folder & Quality profile
      const rootRes = await undiciFetch(`${sonarr.url}/api/v3/rootfolder`, { headers: { 'X-Api-Key': sonarr.key } });
      const rootFolders = (await rootRes.json()) as any[];
      const rootPath = rootFolders[0]?.path || '/tv';

      const qpRes = await undiciFetch(`${sonarr.url}/api/v3/qualityprofile`, { headers: { 'X-Api-Key': sonarr.key } });
      const qp = (await qpRes.json()) as any[];
      const qpId = qp[0]?.id || 1;

      // Ensure all seasons are monitored
      const seasons = (lookupSeries.seasons || []).map((s: any) => ({
        ...s,
        monitored: true,
      }));

      // 4. Add to Sonarr with searchForMissingEpisodes: true
      const addRes = await undiciFetch(`${sonarr.url}/api/v3/series`, {
        method: 'POST',
        headers: {
          'X-Api-Key': sonarr.key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: lookupSeries.title,
          tvdbId: lookupSeries.tvdbId,
          qualityProfileId: qpId,
          rootFolderPath: rootPath,
          monitored: true,
          seasonFolder: true,
          seasons,
          addOptions: { searchForMissingEpisodes: true },
        }),
      });

      if (!addRes.ok) {
        const errText = await addRes.text();
        throw new Error(`Sonarr rejected series: ${errText}`);
      }

      const added = (await addRes.json()) as any;
      console.log(`✅ [Sonarr] Added "${seriesTitle}" to Sonarr with continuous monitoring & missing episode search!`);
      return { success: true, message: `Added "${seriesTitle}" to Sonarr with continuous monitoring.`, seriesId: added.id };
    } catch (err: any) {
      console.warn(`[Sonarr] monitorSeriesInSonarr notice:`, err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * Adds or updates a movie in Radarr with continuous monitoring enabled and searches for release.
   */
  public async monitorMovieInRadarr(
    imdbId: string,
    tmdbId: number,
    movieTitle: string,
    year?: string
  ): Promise<{ success: boolean; message: string; movieId?: number }> {
    const radarr = this.getRadarrConfig();
    if (!radarr.isConfigured) {
      return { success: false, message: 'Radarr is not configured.' };
    }

    try {
      const getRes = await undiciFetch(`${radarr.url}/api/v3/movie?tmdbId=${tmdbId}`, {
        headers: { 'X-Api-Key': radarr.key },
      });
      if (getRes.ok) {
        const movies = (await getRes.json()) as any[];
        if (Array.isArray(movies) && movies.length > 0) {
          const m = movies[0];
          if (!m.monitored) {
            m.monitored = true;
            await undiciFetch(`${radarr.url}/api/v3/movie/${m.id}`, {
              method: 'PUT',
              headers: { 'X-Api-Key': radarr.key, 'Content-Type': 'application/json' },
              body: JSON.stringify(m),
            });
          }
          await undiciFetch(`${radarr.url}/api/v3/command`, {
            method: 'POST',
            headers: { 'X-Api-Key': radarr.key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'MoviesSearch', movieIds: [m.id] }),
          });
          return { success: true, message: `Monitoring "${movieTitle}" in Radarr.`, movieId: m.id };
        }
      }

      // Lookup & add movie
      const lookupRes = await undiciFetch(`${radarr.url}/api/v3/movie/lookup/tmdb?tmdbId=${tmdbId}`, {
        headers: { 'X-Api-Key': radarr.key },
      });
      if (!lookupRes.ok) throw new Error('Could not lookup movie in Radarr');
      const lookupMovie = (await lookupRes.json()) as any;

      const rootRes = await undiciFetch(`${radarr.url}/api/v3/rootfolder`, { headers: { 'X-Api-Key': radarr.key } });
      const rootFolders = (await rootRes.json()) as any[];
      const rootPath = rootFolders[0]?.path || '/movies';

      const qpRes = await undiciFetch(`${radarr.url}/api/v3/qualityprofile`, { headers: { 'X-Api-Key': radarr.key } });
      const qp = (await qpRes.json()) as any[];
      const qpId = qp[0]?.id || 1;

      const addRes = await undiciFetch(`${radarr.url}/api/v3/movie`, {
        method: 'POST',
        headers: {
          'X-Api-Key': radarr.key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: lookupMovie.title || movieTitle,
          tmdbId,
          year: lookupMovie.year || parseInt(year || '0', 10),
          qualityProfileId: qpId,
          rootFolderPath: rootPath,
          monitored: true,
          addOptions: { searchForMovie: true },
        }),
      });

      if (!addRes.ok) {
        const errText = await addRes.text();
        throw new Error(`Radarr rejected movie: ${errText}`);
      }

      const added = (await addRes.json()) as any;
      console.log(`✅ [Radarr] Added "${movieTitle}" to Radarr with continuous monitoring & search!`);
      return { success: true, message: `Added "${movieTitle}" to Radarr with continuous monitoring.`, movieId: added.id };
    } catch (err: any) {
      console.warn(`[Radarr] monitorMovieInRadarr notice:`, err.message);
      return { success: false, message: err.message };
    }
  }
}

export const arrService = new ArrService();

