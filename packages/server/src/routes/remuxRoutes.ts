import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { remuxService } from '../services/remuxService';

export async function remuxRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  /**
   * Probe media container for tracks, codecs, HDR, and duration
   * GET /api/remux/probe?url=<encoded_url_or_nas_id>&headers=<base64url_json_headers>
   */
  fastify.get('/api/remux/probe', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { url?: string; headers?: string };
    if (!query.url) {
      return reply.status(400).send({ error: 'Missing url parameter' });
    }

    // Decode custom headers if provided (base64url-encoded JSON, same format as proxy)
    let customHeaders: Record<string, string> | undefined;
    if (query.headers) {
      try {
        const jsonStr = Buffer.from(query.headers, 'base64url').toString('utf-8');
        customHeaders = JSON.parse(jsonStr);
      } catch (_) {}
    }

    try {
      const probe = await remuxService.probeMedia(query.url, customHeaders);
      return reply.send(probe);
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || 'Media probe failed' });
    }
  });

  /**
   * Stream remuxed fragmented MP4 directly to browser using multi-connection download pipeline.
   *
   * GET /api/remux/stream?url=<encoded_url_or_nas_id>&start=0&audioTrack=0&videoMode=copy&headers=<base64url_json>
   *
   * Flow:
   *   1. Resolves upstream URL from proxy path, NAS ID, or direct URL
   *   2. Downloads from upstream via parallel HTTP range workers (8 connections, 8MB chunks)
   *   3. Pipes download into FFmpeg stdin (-i pipe:0)
   *   4. FFmpeg remuxes MKV → fragmented MP4 (video=copy, audio=auto-transcode)
   *   5. FFmpeg stdout piped to HTTP response → Browser
   */
  fastify.get('/api/remux/stream', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as {
      url?: string;
      start?: string;
      audioTrack?: string;
      audioCopy?: string;
      videoMode?: string;
      headers?: string;
      isHevc?: string;
      title?: string;
    };

    if (!query.url) {
      return reply.status(400).send({ error: 'Missing url parameter' });
    }

    const startTime = query.start ? Math.max(0, parseFloat(query.start) || 0) : 0;
    const audioTrackIndex = query.audioTrack !== undefined ? parseInt(query.audioTrack, 10) : 0;
    const audioMode = query.audioCopy === 'true' || query.audioCopy === '1' ? 'copy' : 'auto';
    const videoMode = query.videoMode === 'transcode' ? 'transcode' : 'copy';
    const isHevc = query.isHevc === '1' || query.isHevc === 'true' ? true : undefined;
    const title = query.title;

    // Decode custom headers if provided (base64url-encoded JSON, same format as proxy)
    let upstreamHeaders: Record<string, string> | undefined;
    if (query.headers) {
      try {
        const jsonStr = Buffer.from(query.headers, 'base64url').toString('utf-8');
        upstreamHeaders = JSON.parse(jsonStr);
      } catch (_) {}
    }

    console.log(`[RemuxRoute] Stream request: url=${query.url.substring(0, 80)}... start=${startTime} video=${videoMode} audio=${audioMode} isHevc=${isHevc}`);

    try {
      const { stdout, kill } = await remuxService.createPipedRemuxStream({
        source: query.url,
        startTime,
        audioTrackIndex,
        audioMode,
        videoMode,
        upstreamHeaders,
        isHevc,
        title,
      });

      // Cleanup FFmpeg process as soon as client closes connection or navigates away
      req.raw.on('close', () => {
        kill();
      });

      req.raw.on('end', () => {
        kill();
      });

      reply.raw.setHeader('Content-Type', 'video/mp4');
      reply.raw.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      reply.raw.setHeader('Pragma', 'no-cache');
      reply.raw.setHeader('Expires', '0');
      reply.raw.setHeader('Access-Control-Allow-Origin', '*');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('Transfer-Encoding', 'chunked');

      reply.raw.statusCode = 200;
      stdout.pipe(reply.raw);

      return reply;
    } catch (err: any) {
      console.error(`[RemuxRoute] Stream error: ${err.message}`);
      return reply.status(502).send({ error: `Remux failed: ${err.message}` });
    }
  });
}
