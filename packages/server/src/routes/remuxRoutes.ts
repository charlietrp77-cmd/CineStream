import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { remuxService } from '../services/remuxService';

export async function remuxRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  /**
   * Probe media container for tracks, codecs, HDR, and duration
   * GET /api/remux/probe?url=<encoded_url_or_nas_id>
   */
  fastify.get('/api/remux/probe', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { url?: string };
    if (!query.url) {
      return reply.status(400).send({ error: 'Missing url parameter' });
    }

    try {
      const probe = await remuxService.probeMedia(query.url);
      return reply.send(probe);
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || 'Media probe failed' });
    }
  });

  /**
   * Stream remuxed fragmented MP4 directly to browser
   * GET /api/remux/stream?url=<encoded_url_or_nas_id>&start=0&audioTrack=0
   */
  fastify.get('/api/remux/stream', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as {
      url?: string;
      start?: string;
      audioTrack?: string;
      audioCopy?: string;
      videoMode?: string;
    };

    if (!query.url) {
      return reply.status(400).send({ error: 'Missing url parameter' });
    }

    const startTime = query.start ? Math.max(0, parseFloat(query.start) || 0) : 0;
    const audioTrackIndex = query.audioTrack !== undefined ? parseInt(query.audioTrack, 10) : 0;
    const audioMode = query.audioCopy === 'true' || query.audioCopy === '1' ? 'copy' : 'auto';
    const videoMode = query.videoMode === 'transcode' ? 'transcode' : 'copy';

    const { stdout, kill } = remuxService.createRemuxStream({
      source: query.url,
      startTime,
      audioTrackIndex,
      audioMode,
      videoMode,
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

    reply.raw.statusCode = 200;
    stdout.pipe(reply.raw);

    return reply;
  });
}

