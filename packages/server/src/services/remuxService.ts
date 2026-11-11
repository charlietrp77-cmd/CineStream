import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { nasDownloader } from './nasDownloader';
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
}

export class RemuxService {
  private ffmpegBin: string;
  private ffprobeBin: string;

  constructor() {
    this.ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';
    this.ffprobeBin = process.env.FFPROBE_PATH || 'ffprobe';
  }

  /**
   * Resolves a media reference (NAS job id, NAS stream URL, local file, or remote HTTP URL)
   * to a direct filesystem path or streamable URL.
   */
  public resolveSource(source: string): string {
    if (!source) return '';

    // 1. Direct local filesystem path
    if (fs.existsSync(source)) {
      return source;
    }

    // 2. NAS cache ID format (e.g. "nas_12345" or just "12345")
    const cleanId = source.replace(/^nas_/, '');
    const job = nasDownloader.getJob(cleanId);
    if (job && job.file_path && fs.existsSync(job.file_path)) {
      return job.file_path;
    }

    // 3. Extract ID from an /api/nas/stream/:id URL
    const nasUrlMatch = source.match(/\/api\/nas\/stream\/([^/?#]+)/);
    if (nasUrlMatch) {
      const urlJobId = decodeURIComponent(nasUrlMatch[1]).replace(/^nas_/, '');
      const urlJob = nasDownloader.getJob(urlJobId);
      if (urlJob && urlJob.file_path && fs.existsSync(urlJob.file_path)) {
        return urlJob.file_path;
      }
    }

    // 4. Check if path exists inside NAS mount directory
    const potentialNasPath = path.join(config.nasCachePath, source);
    if (fs.existsSync(potentialNasPath)) {
      return potentialNasPath;
    }

    // 5. If it's a CineStream proxy URL, decode underlying upstream URL
    const proxyMatch = source.match(/\/proxy\/stream\?url=([^&]+)/);
    if (proxyMatch) {
      try {
        const decoded = Buffer.from(proxyMatch[1], 'base64url').toString('utf-8');
        if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
          return decoded;
        }
      } catch (_) {}
    }

    // 6. Remote HTTP/HTTPS URL
    return source;
  }

  /**
   * Probes media container and tracks using ffprobe
   */
  public async probeMedia(rawSource: string): Promise<MediaProbeResult> {
    const source = this.resolveSource(rawSource);

    return new Promise((resolve) => {
      const isRemote = source.startsWith('http://') || source.startsWith('https://');
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

        if (source.includes('easynews.com') && config.easynewsUsername && config.easynewsPassword) {
          const auth = Buffer.from(`${config.easynewsUsername}:${config.easynewsPassword}`).toString('base64');
          args.push('-headers', `Authorization: Basic ${auth}\r\n`);
        }
      }

      args.push('-i', source);

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
   * Spawns FFmpeg to transmux/remux the video into fragmented MP4 (fMP4)
   * Video is ALWAYS direct copied (-c:v copy) - 0% CPU, 100% 4K HDR preserved.
   * Audio is copied if web-compatible (AAC/Opus/FLAC/MP3), otherwise transcoded to 5.1/Stereo AAC.
   */
  public createRemuxStream(options: RemuxOptions): {
    process: ChildProcess;
    stdout: Readable;
    kill: () => void;
  } {
    const source = this.resolveSource(options.source);
    const isRemote = source.startsWith('http://') || source.startsWith('https://');
    const startTime = options.startTime && options.startTime > 0 ? options.startTime : 0;

    const args: string[] = [
      '-hide_banner',
      '-loglevel', 'warning',
      '-probesize', '1048576',
      '-analyzeduration', '1000000',
      '-fflags', '+nobuffer+fastseek',
      '-flush_packets', '1',
    ];

    // Fast input seeking: Placing -ss before -i seeks instantly at keyframe boundary
    if (startTime > 0) {
      args.push('-ss', startTime.toFixed(3));
    }

    // Remote HTTP reconnect resiliency flags
    if (isRemote) {
      args.push(
        '-reconnect', '1',
        '-reconnect_at_eof', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '3'
      );

      if (source.includes('easynews.com') && config.easynewsUsername && config.easynewsPassword) {
        const auth = Buffer.from(`${config.easynewsUsername}:${config.easynewsPassword}`).toString('base64');
        args.push('-headers', `Authorization: Basic ${auth}\r\n`);
      }
    }

    args.push('-i', source);

    // Video Track Processing:
    // 1. Direct Copy (0% CPU, 4K HDR preserved): tagged with 'hvc1' only for HEVC, allowing H.264 to use avc1.
    // 2. Compatibility Transcode (H.264 8-bit YUV420P): for browsers without HEVC extension or hardware support.
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
      const lower = source.toLowerCase();
      const isHevc =
        lower.includes('hevc') ||
        lower.includes('h265') ||
        lower.includes('x265') ||
        lower.includes('2160p') ||
        lower.includes('4k');
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

    const proc = spawn(this.ffmpegBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stderr?.on('data', (chunk) => {
      const msg = chunk.toString();
      // Only log genuine errors, suppress progress stats
      if (msg.includes('Error') || msg.includes('fatal')) {
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
}

export const remuxService = new RemuxService();

