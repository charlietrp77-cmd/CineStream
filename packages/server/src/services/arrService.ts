import { fetch as undiciFetch } from 'undici';
import path from 'path';
import { appSettings } from './appSettings';
import { StreamBadges } from './aiostreams';

export interface ArrStatus {
  radarr: {
    configured: boolean;
    online: boolean;
    url: string;
    version?: string;
    error?: string;
  };
  sonarr: {
    configured: boolean;
    online: boolean;
    url: string;
    version?: string;
    error?: string;
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

  public async getStatus(): Promise<ArrStatus> {
    const radarr = this.getRadarrConfig();
    const sonarr = this.getSonarrConfig();

    const status: ArrStatus = {
      radarr: { configured: radarr.isConfigured, online: false, url: radarr.url },
      sonarr: { configured: sonarr.isConfigured, online: false, url: sonarr.url },
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
        } else {
          status.sonarr.error = `HTTP ${res.status}`;
        }
      } catch (err: any) {
        status.sonarr.error = err.message || 'Connection failed';
      }
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
      try {
        const directPushRes = await undiciFetch(`${radarr.url}/api/v3/release/push`, {
          method: 'POST',
          headers: {
            'X-Api-Key': radarr.key,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: params.movieTitle,
            downloadUrl: params.targetNzbUrl,
            protocol: 'usenet',
            publishDate: new Date().toISOString(),
          }),
        });
        if (directPushRes.ok) {
          return {
            success: true,
            service: 'radarr',
            matchedRelease: {
              guid: params.targetNzbUrl,
              indexerId: 0,
              indexer: 'Direct Usenet NZB',
              title: params.movieTitle,
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
        }
      } catch (_) {}
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
    let seriesId: number | null = null;
    try {
      const getRes = await undiciFetch(`${sonarr.url}/api/v3/series?includeSeasonImages=false`, {
        headers: { 'X-Api-Key': sonarr.key },
      });
      if (getRes.ok) {
        const seriesList: any = await getRes.json();
        const found = seriesList.find((s: any) =>
          (params.tvdbId && s.tvdbId === params.tvdbId) ||
          (params.imdbId && s.imdbId === params.imdbId) ||
          (s.title && s.title.toLowerCase() === params.seriesTitle.toLowerCase())
        );
        if (found) seriesId = found.id;
      }

      if (!seriesId) {
        // Lookup series
        const term = params.tvdbId ? `tvdb:${params.tvdbId}` : `imdb:${params.imdbId}`;
        const lookupRes = await undiciFetch(`${sonarr.url}/api/v3/series/lookup?term=${encodeURIComponent(term)}`, {
          headers: { 'X-Api-Key': sonarr.key },
        });
        if (!lookupRes.ok) throw new Error('Could not lookup series in Sonarr');
        const lookupList: any = await lookupRes.json();
        const lookupSeries = lookupList[0];
        if (!lookupSeries) throw new Error(`Series "${params.seriesTitle}" not found in Sonarr lookup`);

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
          seriesId = added.id;
        }
      }
    } catch (err: any) {
      return {
        success: false,
        service: 'sonarr',
        matchedRelease: null,
        message: `Failed to find or add series in Sonarr: ${err.message}`,
        isWithin10Percent: false,
        allCandidatesCount: 0,
        error: err.message,
      };
    }

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
      try {
        const directPushRes = await undiciFetch(`${sonarr.url}/api/v3/release/push`, {
          method: 'POST',
          headers: {
            'X-Api-Key': sonarr.key,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: params.seriesTitle,
            downloadUrl: params.targetNzbUrl,
            protocol: 'usenet',
            publishDate: new Date().toISOString(),
          }),
        });
        if (directPushRes.ok) {
          return {
            success: true,
            service: 'sonarr',
            matchedRelease: {
              guid: params.targetNzbUrl,
              indexerId: 0,
              indexer: 'Direct Usenet NZB',
              title: params.seriesTitle,
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
        }
      } catch (_) {}
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
}

export const arrService = new ArrService();

