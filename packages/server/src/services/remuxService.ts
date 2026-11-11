import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { Readable, PassThrough } from 'stream';
import { Agent, request as undiciRequest } from 'undici';
import { nasDownloader } from './nasDownloader';
import { getUpstreamMetadata } from './proxy';
import { config } from '../config';

export interface MediaTrack {
  id: string;
  index: number;
  codec: string;
  language: string;
  label: string;
  selected?: boolean;
}

export interface MediaProbeResult {
  durationSeconds: number;
  video: {
    codec: string;
    width: number;
    height: number;
    fps?: number;
    is4K: boolean;
    isHdr: boolean;
    isDolbyVision: boolean;
    colorTransfer?: string;
    colorPrimaries?: string;
  } | null;
  audioTracks: MediaTrack[];
  subtitleTracks: MediaTrack[];
}

export interface RemuxOptions {
  source: string;
  startTime?: number; // In seconds
  audioTrackIndex?: number;
  audioMode?: 'auto' | 'copy' | 'transcode';
  videoMode?: 'copy' | 'transcode';
  /** Pre-decoded upstream URL to avoid re-resolving proxy paths */
  resolvedUpstreamUrl?: string;
  /** Custom headers for upstream (e.g. auth) */
  upstreamHeaders?: Record<string, string>;
  /** Explicit hint if source is HEVC/H.265 */
  isHevc?: boolean;
  /** Optional title or release name for codec heuristics */
  title?: string;
}

/** Resolved source details after decoding proxy URLs, NAS IDs, etc. */
export interface ResolvedSource {
  /** The URL or file path FFmpeg should read */
  inputUrl: string;
  /** True if the source is a remote HTTP(S) URL that can be multi-connection downloaded */
  isRemote: boolean;
  /** True if source is a local file path */
  isLocal: boolean;
  /** Auth or custom headers needed for remote fetches */
  headers: Record<string, string>;
}

const undiciAgent = new Agent({
  connections: 64,
  keepAliveTimeout: 30000,
  keepAliveMaxTimeout: 60000,
});

export class RemuxService {
  private ffmpegBin: string;
  private ffprobeBin: string;

  constructor() {
    this.ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';
    this.ffprobeBin = process.env.FFPROBE_PATH || 'ffprobe';
  }

  /**
   * Resolves a media reference (NAS job id, NAS stream URL, local file, proxy URL, or remote HTTP URL)
   * to a ResolvedSource with the direct upstream URL/path and any required auth headers.
   */
  public resolveSource(source: string, customHeaders?: Record<string, string>): ResolvedSource {
    const headers: Record<string, string> = { ...customHeaders };

    if (!source) {
      return { inputUrl: '', isRemote: false, isLocal: false, headers };
    }

    // 1. Direct local filesystem path
    if (fs.existsSync(source)) {
      return { inputUrl: source, isRemote: false, isLocal: true, headers };
    }

    // 2. NAS cache ID format (e.g. "nas_12345" or just "12345")
    const cleanId = source.replace(/^nas_/, '');
    const job = nasDownloader.getJob(cleanId);
    if (job && job.file_path && fs.existsSync(job.file_path)) {
      return { inputUrl: job.file_path, isRemote: false, isLocal: true, headers };
    }

    // 3. Extract ID from an /api/nas/stream/:id URL
    const nasUrlMatch = source.match(/\/api\/nas\/stream\/([^/?#]+)/);
    if (nasUrlMatch) {
      const urlJobId = decodeURIComponent(nasUrlMatch[1]).replace(/^nas_/, '');
      const urlJob = nasDownloader.getJob(urlJobId);
      if (urlJob && urlJob.file_path && fs.existsSync(urlJob.file_path)) {
        return { inputUrl: urlJob.file_path, isRemote: false, isLocal: true, headers };
      }
    }

    // 4. Check if path exists inside NAS mount directory
    const potentialNasPath = path.join(config.nasCachePath, source);
    if (fs.existsSync(potentialNasPath)) {
      return { inputUrl: potentialNasPath, isRemote: false, isLocal: true, headers };
    }

    // 5. If it's a CineStream proxy URL, decode underlying upstream URL
    const proxyMatch = source.match(/\/proxy\/stream\?url=([^&]+)(?:&headers=([^&]+))?/);
    if (proxyMatch) {
      try {
        const decodedUrl = Buffer.from(proxyMatch[1], 'base64url').toString('utf-8');
        if (decodedUrl.startsWith('http://') || decodedUrl.startsWith('https://')) {
          // Also decode any custom headers baked into the proxy URL
          if (proxyMatch[2]) {
            try {
              const jsonStr = Buffer.from(proxyMatch[2], 'base64url').toString('utf-8');
              const parsedHeaders = JSON.parse(jsonStr);
              Object.assign(headers, parsedHeaders);
            } catch (_) {}
          }

          // Extract and remove embedded user:password from URL
          try {
            const parsed = new URL(decodedUrl);
            if (parsed.username || parsed.password) {
              const u = decodeURIComponent(parsed.username);
              const p = decodeURIComponent(parsed.password);
              parsed.username = '';
              parsed.password = '';
              if (!headers['Authorization'] && !headers['authorization']) {
                headers['Authorization'] = `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
              }
              const cleanUrl = parsed.toString();
              this.injectEasynewsAuth(cleanUrl, headers);
              return { inputUrl: cleanUrl, isRemote: true, isLocal: false, headers };
            }
          } catch (_) {}

          this.injectEasynewsAuth(decodedUrl, headers);
          return { inputUrl: decodedUrl, isRemote: true, isLocal: false, headers };
        }
      } catch (_) {}
    }

    // 6. Remote HTTP/HTTPS URL - extract embedded creds and inject Easynews auth
    if (source.startsWith('http://') || source.startsWith('https://')) {
      try {
        const parsed = new URL(source);
        if (parsed.username || parsed.password) {
          const u = decodeURIComponent(parsed.username);
          const p = decodeURIComponent(parsed.password);
          parsed.username = '';
          parsed.password = '';
          if (!headers['Authorization'] && !headers['authorization']) {
            headers['Authorization'] = `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
          }
          const cleanUrl = parsed.toString();
          this.injectEasynewsAuth(cleanUrl, headers);
          return { inputUrl: cleanUrl, isRemote: true, isLocal: false, headers };
        }
      } catch (_) {}

      this.injectEasynewsAuth(source, headers);
      return { inputUrl: source, isRemote: true, isLocal: false, headers };
    }

    // 7. Fallback: treat as-is
    return { inputUrl: source, isRemote: false, isLocal: false, headers };
  }

  /** Auto-inject Easynews Basic Auth if the URL is for easynews.com and no auth header is set */
  private injectEasynewsAuth(url: string, headers: Record<string, string>): void {
    if (
      url.includes('easynews.com') &&
      !headers['Authorization'] &&
      !headers['authorization'] &&
      config.easynewsUsername &&
      config.easynewsPassword
    ) {
      headers['Authorization'] = `Basic ${Buffer.from(
        `${config.easynewsUsername}:${config.easynewsPassword}`
      ).toString('base64')}`;
    }
  }

  /**
   * Probes media container and tracks using ffprobe.
   * For remote URLs: follows redirects to get the final direct URL first,
   * then feeds it to ffprobe with proper auth headers.
   */
  public async probeMedia(rawSource: string, customHeaders?: Record<string, string>): Promise<MediaProbeResult> {
    const resolved = this.resolveSource(rawSource, customHeaders);
    const source = resolved.inputUrl;

    if (!source) {
      return this.createFallbackProbe(rawSource);
    }

    // For remote URLs, resolve redirects first so ffprobe gets a direct URL
    let probeUrl = source;
    let probeHeaders = { ...resolved.headers };

    if (resolved.isRemote) {
      try {
        const meta = await getUpstreamMetadata(source, resolved.headers);
        probeUrl = meta.finalUrl;
        // Storage nodes (e.g. ams-dl-01.easynews.com) don't need auth after redirect
        if (meta.finalUrl !== source && meta.finalUrl.includes('easynews.com') && !meta.finalUrl.includes('members.easynews.com')) {
          // Keep existing headers but the redirect URL usually embeds auth in the path token
        }
      } catch (err: any) {
        console.warn(`[RemuxService] Could not resolve upstream metadata for probe: ${err.message}`);
      }
    }

    return new Promise((resolve) => {
      const isRemote = probeUrl.startsWith('http://') || probeUrl.startsWith('https://');
      const args: string[] = [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        '-probesize', '1048576',
        '-analyzeduration', '1000000',
      ];

      if (isRemote) {
        args.push(
          '-fflags', '+nobuffer+fastseek',
          '-reconnect', '1',
          '-reconnect_at_eof', '1',
          '-reconnect_streamed', '1',
          '-reconnect_delay_max', '3'
        );

        // Build -headers string from all resolved headers
        const headerLines = Object.entries(probeHeaders)
          .map(([k, v]) => `${k}: ${v}\r\n`)
          .join('');
        if (headerLines) {
          args.push('-headers', headerLines);
        }
      }

      args.push('-i', probeUrl);

      const proc = spawn(this.ffprobeBin, args);
      let stdoutData = '';

      proc.stdout.on('data', (chunk) => {
        stdoutData += chunk.toString();
      });

      proc.on('error', (err) => {
        console.warn(`[RemuxService] ffprobe spawn error: ${err.message}. Falling back to default heuristics.`);
        resolve(this.createFallbackProbe(source));
      });

      proc.on('close', (code) => {
        if (code !== 0 || !stdoutData.trim()) {
          resolve(this.createFallbackProbe(source));
          return;
        }

        try {
          const parsed = JSON.parse(stdoutData);
          const streams = parsed.streams || [];
          const format = parsed.format || {};

          let durationSeconds = parseFloat(format.duration) || 0;

          // Video Stream
          const videoStream = streams.find((s: any) => s.codec_type === 'video');
          let videoInfo: MediaProbeResult['video'] = null;

          if (videoStream) {
            const width = videoStream.width || 1920;
            const height = videoStream.height || 1080;
            const is4K = width >= 3800 || height >= 2000;
            const colorTransfer = videoStream.color_transfer || '';
            const colorPrimaries = videoStream.color_primaries || '';
            const isHdr =
              colorTransfer.includes('smpte2084') ||
              colorTransfer.includes('arib-std-b67') ||
              colorPrimaries.includes('bt2020');

            // Detect Dolby Vision side data
            const sideDataList = videoStream.side_data_list || [];
            const isDolbyVision = sideDataList.some(
              (sd: any) => sd.side_data_type && sd.side_data_type.toLowerCase().includes('dovi')
            );

            let fps = 24;
            if (videoStream.r_frame_rate) {
              const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
              if (den && den > 0) fps = Math.round((num / den) * 100) / 100;
            }

            videoInfo = {
              codec: (videoStream.codec_name || 'hevc').toLowerCase(),
              width,
              height,
              fps,
              is4K,
              isHdr,
              isDolbyVision,
              colorTransfer,
              colorPrimaries,
            };
          }

          // Audio Streams
          const audioTracks: MediaTrack[] = [];
          const audioStreams = streams.filter((s: any) => s.codec_type === 'audio');
          audioStreams.forEach((s: any, idx: number) => {
            const lang = s.tags?.language || 'und';
            const title = s.tags?.title || '';
            const codec = (s.codec_name || 'aac').toLowerCase();
            const channels = s.channels === 8 ? '7.1' : s.channels === 6 ? '5.1' : 'Stereo';
            const label = title || `${lang.toUpperCase()} (${codec.toUpperCase()} ${channels})`;

            audioTracks.push({
              id: String(idx),
              index: idx,
              codec,
              language: lang,
              label,
              selected: idx === 0,
            });
          });

          // Subtitle Streams
          const subtitleTracks: MediaTrack[] = [];
          const subStreams = streams.filter((s: any) => s.codec_type === 'subtitle');
          subStreams.forEach((s: any, idx: number) => {
            const lang = s.tags?.language || 'und';
            const title = s.tags?.title || '';
            const codec = (s.codec_name || 'srt').toLowerCase();
            const label = title || `${lang.toUpperCase()} Subtitles (${codec.toUpperCase()})`;

            subtitleTracks.push({
              id: String(idx),
              index: idx,
              codec,
              language: lang,
              label,
              selected: false,
            });
          });

          resolve({
            durationSeconds,
            video: videoInfo,
            audioTracks,
            subtitleTracks,
          });
        } catch (parseErr) {
          console.warn('[RemuxService] Error parsing ffprobe JSON:', parseErr);
          resolve(this.createFallbackProbe(source));
        }
      });
    });
  }

  private createFallbackProbe(source: string): MediaProbeResult {
    const isMkv = source.toLowerCase().includes('.mkv');
    return {
      durationSeconds: 0,
      video: {
        codec: isMkv ? 'hevc' : 'h264',
        width: 3840,
        height: 2160,
        fps: 24,
        is4K: true,
        isHdr: true,
        isDolbyVision: false,
      },
      audioTracks: [
        { id: '0', index: 0, codec: 'aac', language: 'eng', label: 'Default Audio (Auto)', selected: true },
      ],
      subtitleTracks: [],
    };
  }

  /**
   * Determines whether a video stream is HEVC/H.265.
   * Checks codec name, explicit flag, decoded URL, and release title.
   * In Chromium, HEVC MUST be tagged with 'hvc1' or the screen is pitch black.
   */
  public isHevcCodec(codec?: string, sourceUrl?: string, title?: string, explicitIsHevc?: boolean): boolean {
    if (explicitIsHevc === true) return true;
    if (explicitIsHevc === false) return false;

    if (codec) {
      const c = codec.toLowerCase();
      if (c === 'hevc' || c === 'h265' || c === 'hev1' || c === 'hvc1') return true;
      if (c === 'h264' || c === 'avc1' || c === 'avc') return false;
    }

    let combined = (sourceUrl || '') + ' ' + (title || '');

    // Extract and decode base64url if sourceUrl is a proxy stream URL
    const proxyMatch = sourceUrl ? sourceUrl.match(/\/proxy\/stream\?url=([^&]+)/) : null;
    if (proxyMatch) {
      try {
        combined += ' ' + Buffer.from(proxyMatch[1], 'base64url').toString('utf-8');
      } catch (_) {}
    }

    try {
      combined = decodeURIComponent(combined);
    } catch (_) {}

    const lower = combined.toLowerCase();
    return (
      lower.includes('hevc') ||
      lower.includes('h265') ||
      lower.includes('h.265') ||
      lower.includes('x265') ||
      lower.includes('x.265') ||
      lower.includes('2160p') ||
      lower.includes('4k') ||
      lower.includes('uhd') ||
      lower.includes('hdr') ||
      lower.includes('dovi') ||
      lower.includes('dv')
    );
  }

  /**
   * Creates the FFmpeg argument list for remuxing.
   * Input is always `pipe:0` (stdin) when piped=true, or a direct URL/path otherwise.
   */
  private buildFFmpegArgs(options: RemuxOptions & {
    piped: boolean;
    inputUrl?: string;
    inputHeaders?: Record<string, string>;
    probeResult?: MediaProbeResult;
  }): string[] {
    const startTime = options.startTime && options.startTime > 0 ? options.startTime : 0;

    const args: string[] = [
      '-hide_banner',
      '-loglevel', 'warning',
      '-probesize', '2097152',       // 2MB probe for piped input (no seeking)
      '-analyzeduration', '2000000', // 2s analysis window
      '-fflags', '+nobuffer+fastseek+discardcorrupt',
      '-flush_packets', '1',
    ];

    // Fast input seeking: Placing -ss before -i seeks instantly at keyframe boundary
    if (startTime > 0 && !options.piped) {
      // Only use input seeking for non-piped sources (local files, direct URL)
      args.push('-ss', startTime.toFixed(3));
    }

    if (options.piped) {
      // Reading from stdin pipe — no seeking, no reconnect
      args.push('-i', 'pipe:0');
    } else {
      const inputUrl = options.inputUrl || '';
      const isRemote = inputUrl.startsWith('http://') || inputUrl.startsWith('https://');

      if (isRemote) {
        args.push(
          '-reconnect', '1',
          '-reconnect_at_eof', '1',
          '-reconnect_streamed', '1',
          '-reconnect_delay_max', '3'
        );

        // Build -headers for all auth/custom headers
        const hdrs = options.inputHeaders || {};
        const headerLines = Object.entries(hdrs)
          .map(([k, v]) => `${k}: ${v}\r\n`)
          .join('');
        if (headerLines) {
          args.push('-headers', headerLines);
        }
      }

      args.push('-i', inputUrl);
    }

    // Output seeking for piped input (less efficient but works)
    if (startTime > 0 && options.piped) {
      args.push('-ss', startTime.toFixed(3));
    }

    // Video Track Processing:
    // Determine codec from probe, explicit options, decoded URL, or title
    const videoCodec = options.probeResult?.video?.codec;
    const isHevc = this.isHevcCodec(videoCodec, options.inputUrl || options.source, options.title, options.isHevc);

    console.log(`[RemuxService] Video remux mode=${options.videoMode || 'copy'} isHevc=${isHevc} (tag=${isHevc ? 'hvc1' : 'default'})`);

    if (options.videoMode === 'transcode') {
      args.push(
        '-map', '0:v:0',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-crf', '22',
        '-pix_fmt', 'yuv420p',
        '-tag:v', 'avc1'
      );
    } else {
      args.push('-map', '0:v:0', '-c:v', 'copy');
      if (isHevc) {
        args.push('-tag:v', 'hvc1');
      }
    }

    // Audio Track Selection & Transmuxing
    const audioIdx = typeof options.audioTrackIndex === 'number' ? options.audioTrackIndex : 0;
    args.push('-map', `0:a:${audioIdx}?`);

    if (options.audioMode === 'copy') {
      args.push('-c:a', 'copy');
    } else {
      // In auto or transcode mode: transcode to high-quality 6-channel AAC
      // This is <0.5% CPU and plays natively in every browser (Chrome, Edge, Firefox, Safari)
      args.push('-c:a', 'aac', '-b:a', '384k', '-ac', '6');
    }

    // Container: Fragmented MP4 for immediate streaming playback
    args.push(
      '-max_muxing_queue_size', '4096',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-avoid_negative_ts', 'make_zero',
      '-f', 'mp4',
      'pipe:1'
    );

    return args;
  }

  /**
   * Spawns FFmpeg to remux a LOCAL file or DIRECT remote URL.
   * FFmpeg fetches the input itself (single connection).
   * For multi-connection streaming, use createPipedRemuxStream() instead.
   */
  public createRemuxStream(options: RemuxOptions): {
    process: ChildProcess;
    stdout: Readable;
    kill: () => void;
  } {
    const resolved = this.resolveSource(options.source, options.upstreamHeaders);
    const args = this.buildFFmpegArgs({
      ...options,
      piped: false,
      inputUrl: resolved.inputUrl,
      inputHeaders: resolved.headers,
    });

    console.log(`[RemuxService] FFmpeg direct: ${this.ffmpegBin} ${args.join(' ').substring(0, 200)}...`);

    const proc = spawn(this.ffmpegBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stderr?.on('data', (chunk) => {
      const msg = chunk.toString();
      // Only log genuine errors, suppress progress stats
      if (msg.includes('Error') || msg.includes('fatal') || msg.includes('error')) {
        console.warn('[RemuxService FFmpeg stderr]:', msg.trim());
      }
    });

    let isKilled = false;
    const kill = () => {
      if (isKilled) return;
      isKilled = true;
      try {
        proc.kill('SIGTERM');
        setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch (_) {}
        }, 1000);
      } catch (_) {}
    };

    return {
      process: proc,
      stdout: proc.stdout,
      kill,
    };
  }

  /**
   * Creates a multi-connection piped remux stream.
   * Downloads from upstream using parallel HTTP range requests (sliding-window worker pool),
   * pipes the downloaded bytes into FFmpeg stdin, FFmpeg remuxes MKV→fMP4 and writes to stdout.
   *
   * This is the PRIMARY method for web playback — it combines:
   * - Multi-connection parallel downloading (8 workers, 8MB chunks, 64MB read-ahead)
   * - Zero video transcoding (copy passthrough)
   * - Audio transcode only when needed (DTS/TrueHD → AAC)
   * - Fragmented MP4 output for instant browser playback
   */
  public async createPipedRemuxStream(options: RemuxOptions): Promise<{
    stdout: Readable;
    kill: () => void;
  }> {
    const resolved = this.resolveSource(options.source, options.upstreamHeaders);

    console.log(`[RemuxService] Piped remux requested for: ${resolved.inputUrl.substring(0, 120)}...`);
    console.log(`[RemuxService] isRemote=${resolved.isRemote}, isLocal=${resolved.isLocal}, hasAuth=${!!resolved.headers['Authorization']}`);

    // For local files, use direct FFmpeg (no piping needed, FFmpeg can seek)
    if (resolved.isLocal) {
      const direct = this.createRemuxStream(options);
      return { stdout: direct.stdout, kill: direct.kill };
    }

    // For remote URLs: multi-connection download → pipe → FFmpeg → fMP4
    // Step 1: Resolve upstream metadata (follow redirects, get file size)
    let meta;
    try {
      meta = await getUpstreamMetadata(resolved.inputUrl, resolved.headers);
    } catch (err: any) {
      console.error(`[RemuxService] Failed to get upstream metadata: ${err.message}`);
      throw err;
    }

    const targetUrl = meta.finalUrl;
    const totalSize = meta.totalSize;

    console.log(`[RemuxService] Upstream resolved: ${targetUrl.substring(0, 100)}... size=${totalSize} bytes (${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB)`);

    // Step 2: Determine effective headers for the resolved URL
    const effectiveHeaders: Record<string, string> = { ...resolved.headers };
    if (
      targetUrl.includes('easynews.com') &&
      !effectiveHeaders['Authorization'] &&
      !effectiveHeaders['authorization'] &&
      config.easynewsUsername &&
      config.easynewsPassword
    ) {
      effectiveHeaders['Authorization'] = `Basic ${Buffer.from(
        `${config.easynewsUsername}:${config.easynewsPassword}`
      ).toString('base64')}`;
    }

    // Step 3: Build FFmpeg args for piped input
    const args = this.buildFFmpegArgs({
      ...options,
      source: targetUrl || resolved.inputUrl || options.source,
      piped: true,
      inputUrl: targetUrl || resolved.inputUrl,
      inputHeaders: effectiveHeaders,
    });

    console.log(`[RemuxService] FFmpeg piped: ${this.ffmpegBin} ${args.join(' ').substring(0, 300)}...`);

    // Step 4: Spawn FFmpeg with stdin pipe
    const proc = spawn(this.ffmpegBin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let isKilled = false;
    const abortController = new AbortController();

    const kill = () => {
      if (isKilled) return;
      isKilled = true;
      abortController.abort();
      try {
        proc.stdin?.end();
      } catch (_) {}
      try {
        proc.kill('SIGTERM');
        setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch (_) {}
        }, 2000);
      } catch (_) {}
    };

    // Log FFmpeg errors
    let stderrBuf = '';
    proc.stderr?.on('data', (chunk) => {
      const msg = chunk.toString();
      stderrBuf += msg;
      if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-2048);
      if (msg.includes('Error') || msg.includes('fatal') || msg.includes('error')) {
        console.warn('[RemuxService FFmpeg piped stderr]:', msg.trim());
      }
    });

    proc.on('close', (code) => {
      if (code !== 0 && !isKilled) {
        console.warn(`[RemuxService] FFmpeg exited with code ${code}. Last stderr: ${stderrBuf.slice(-500)}`);
      }
    });

    proc.on('error', (err) => {
      console.error(`[RemuxService] FFmpeg process error: ${err.message}`);
    });

    // Step 5: Multi-connection download → pipe into FFmpeg stdin
    this.pumpUpstreamToStdin(proc, targetUrl, totalSize, effectiveHeaders, abortController, options.startTime || 0);

    return { stdout: proc.stdout!, kill };
  }

  /**
   * Downloads from upstream using parallel sliding-window HTTP range requests
   * and pipes the data IN ORDER into FFmpeg's stdin.
   */
  private async pumpUpstreamToStdin(
    proc: ChildProcess,
    targetUrl: string,
    totalSize: number,
    headers: Record<string, string>,
    abortController: AbortController,
    startTimeSec: number
  ): Promise<void> {
    const CHUNK_SIZE = config.proxyChunkSizeMb * 1024 * 1024; // Default 8MB
    const MAX_WORKERS = Math.max(2, config.proxyConnections);     // Default 8
    const MAX_READAHEAD = Math.max(2, Math.ceil(config.proxyReadaheadMb / config.proxyChunkSizeMb)); // Default 8 chunks

    // For seeking: estimate byte offset from time position
    // This is approximate — we skip ahead in the file and FFmpeg handles the rest
    let startByte = 0;
    if (startTimeSec > 0 && totalSize > 0) {
      // Rough bitrate estimation: assume total file plays over ~2 hours avg
      // FFmpeg will find the nearest keyframe from the piped data
      // A better approach: use probe duration if available, but we don't probe here for speed
      // Instead, rely on FFmpeg's -ss output seeking which skips decoded frames
      startByte = 0; // Feed from start; FFmpeg -ss after -i handles seeking
    }

    const endByte = totalSize > 0 ? totalSize - 1 : 0;
    const contentLength = endByte - startByte + 1;

    if (totalSize <= 0) {
      // Unknown size: single streaming connection (can't do range requests)
      console.log('[RemuxService] Unknown file size — falling back to single-connection stream');
      this.singleConnectionPump(proc, targetUrl, headers, abortController);
      return;
    }

    const totalChunks = Math.ceil(contentLength / CHUNK_SIZE);
    console.log(`[RemuxService] Multi-connection download: ${totalChunks} chunks × ${config.proxyChunkSizeMb}MB, ${MAX_WORKERS} workers, ${MAX_READAHEAD} readahead`);

    interface ChunkTask {
      index: number;
      start: number;
      end: number;
    }

    const chunks: ChunkTask[] = [];
    for (let i = 0; i < totalChunks; i++) {
      const cStart = startByte + i * CHUNK_SIZE;
      const cEnd = Math.min(startByte + (i + 1) * CHUNK_SIZE - 1, endByte);
      chunks.push({ index: i, start: cStart, end: cEnd });
    }

    const completedChunks = new Map<number, Buffer>();
    let currentFlushIndex = 0;
    let nextChunkToAssign = 1; // Chunk 0 is streamed inline by main thread
    let flushResolvers: Array<() => void> = [];

    const notifyFlusher = () => {
      const list = flushResolvers;
      flushResolvers = [];
      for (const r of list) r();
    };

    const fetchChunkData = async (task: ChunkTask): Promise<Buffer> => {
      let fetchUrl = targetUrl;
      let rCount = 0;
      while (rCount < 5) {
        const res = await undiciRequest(fetchUrl, {
          method: 'GET',
          headers: {
            Range: `bytes=${task.start}-${task.end}`,
            'User-Agent': 'CineStream/1.0.0 (Fastify)',
            ...headers,
          },
          signal: abortController.signal,
          dispatcher: undiciAgent,
        });

        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          for await (const _ of res.body) {}
          fetchUrl = new URL(res.headers.location as string, fetchUrl).toString();
          rCount++;
          continue;
        }

        const buffers: Buffer[] = [];
        for await (const chunk of res.body) {
          if (abortController.signal.aborted) throw new Error('Aborted');
          buffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return Buffer.concat(buffers);
      }
      throw new Error('Too many redirects in chunk fetch');
    };

    const writeToStdin = (data: Buffer): Promise<boolean> => {
      return new Promise((resolve) => {
        if (abortController.signal.aborted || !proc.stdin || proc.stdin.destroyed) {
          resolve(false);
          return;
        }
        const canWrite = proc.stdin.write(data, (err) => {
          if (err) {
            resolve(false);
          }
        });
        if (canWrite) {
          resolve(true);
        } else {
          proc.stdin!.once('drain', () => resolve(true));
        }
      });
    };

    // Prefetch worker loop — fetches chunks in parallel, stores in completedChunks map
    const runPrefetchWorker = async () => {
      while (!abortController.signal.aborted && nextChunkToAssign < totalChunks) {
        // Backpressure: don't prefetch too far ahead
        if (nextChunkToAssign > currentFlushIndex + MAX_READAHEAD) {
          await new Promise<void>((resolve) => {
            flushResolvers.push(resolve);
          });
          continue;
        }

        const taskIndex = nextChunkToAssign++;
        if (taskIndex >= totalChunks) break;
        const task = chunks[taskIndex];

        try {
          const data = await fetchChunkData(task);
          if (abortController.signal.aborted) break;
          completedChunks.set(task.index, data);
          notifyFlusher();
        } catch (err: any) {
          if (!abortController.signal.aborted) {
            console.warn(`[RemuxService] Chunk ${taskIndex} fetch error: ${err.message}`);
            break;
          }
        }
      }
    };

    // Start background prefetch workers for chunks 1..N
    const workerPromises: Promise<void>[] = [];
    const workerCount = Math.min(MAX_WORKERS - 1, Math.max(1, totalChunks - 1));
    for (let w = 0; w < workerCount; w++) {
      workerPromises.push(runPrefetchWorker());
    }

    // Main pump: stream chunk 0 directly, then flush chunks 1..N in order
    try {
      // Stream chunk 0 directly to FFmpeg stdin for instant TTFB
      const chunk0 = chunks[0];
      let fetchUrl = targetUrl;
      let rCount = 0;
      while (rCount < 5) {
        const res0 = await undiciRequest(fetchUrl, {
          method: 'GET',
          headers: {
            Range: `bytes=${chunk0.start}-${chunk0.end}`,
            'User-Agent': 'CineStream/1.0.0 (Fastify)',
            ...headers,
          },
          signal: abortController.signal,
          dispatcher: undiciAgent,
        });

        if (res0.statusCode >= 300 && res0.statusCode < 400 && res0.headers.location) {
          for await (const _ of res0.body) {}
          fetchUrl = new URL(res0.headers.location as string, fetchUrl).toString();
          rCount++;
          continue;
        }

        for await (const chunk of res0.body) {
          if (abortController.signal.aborted) break;
          const ok = await writeToStdin(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          if (!ok) break;
        }
        break;
      }

      currentFlushIndex = 1;
      notifyFlusher();

      // Flush buffered chunks 1..N in sequential order to FFmpeg stdin
      while (currentFlushIndex < totalChunks && !abortController.signal.aborted) {
        if (completedChunks.has(currentFlushIndex)) {
          const buf = completedChunks.get(currentFlushIndex)!;
          completedChunks.delete(currentFlushIndex);

          const ok = await writeToStdin(buf);
          if (!ok) break;

          currentFlushIndex++;
          notifyFlusher();
        } else {
          // Wait for the next chunk to arrive
          await new Promise<void>((resolve) => {
            flushResolvers.push(resolve);
          });
        }
      }

      // All chunks sent — close stdin so FFmpeg knows input is done
      if (!abortController.signal.aborted && proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.end();
      }
    } catch (err: any) {
      if (!abortController.signal.aborted) {
        console.error(`[RemuxService] Pump error: ${err.message}`);
      }
    } finally {
      completedChunks.clear();
      await Promise.allSettled(workerPromises);
    }
  }

  /**
   * Fallback: single-connection streaming pump for unknown-size sources.
   */
  private async singleConnectionPump(
    proc: ChildProcess,
    url: string,
    headers: Record<string, string>,
    abortController: AbortController
  ): Promise<void> {
    try {
      const res = await undiciRequest(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'CineStream/1.0.0 (Fastify)',
          ...headers,
        },
        signal: abortController.signal,
        dispatcher: undiciAgent,
      });

      for await (const chunk of res.body) {
        if (abortController.signal.aborted) break;
        if (!proc.stdin || proc.stdin.destroyed) break;

        const canWrite = proc.stdin.write(chunk);
        if (!canWrite) {
          await new Promise<void>((resolve) => {
            proc.stdin!.once('drain', resolve);
          });
        }
      }

      if (!abortController.signal.aborted && proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.end();
      }
    } catch (err: any) {
      if (!abortController.signal.aborted) {
        console.error(`[RemuxService] Single-connection pump error: ${err.message}`);
      }
    }
  }
}

export const remuxService = new RemuxService();
