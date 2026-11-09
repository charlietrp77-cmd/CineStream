import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { handleProxyStream } from '../services/proxy';

export async function streamProxyRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  fastify.options('/proxy/stream', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
      .header('Access-Control-Allow-Headers', '*')
      .header('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length, Content-Type')
      .status(204)
      .send();
  });

  fastify.get('/proxy/stream', async (req: FastifyRequest, reply: FastifyReply) => {
    const { url: encodedUrl, headers: encodedHeaders } = req.query as {
      url?: string;
      headers?: string;
    };

    if (!encodedUrl) {
      return reply.status(400).send({ error: 'Missing url parameter' });
    }

    let decodedUrl = '';
    try {
      decodedUrl = Buffer.from(encodedUrl, 'base64url').toString('utf-8');
      new URL(decodedUrl); // Validate valid URL
    } catch (e) {
      return reply.status(400).send({ error: 'Invalid base64url stream url' });
    }

    let customHeaders: Record<string, string> | undefined;
    if (encodedHeaders) {
      try {
        const jsonStr = Buffer.from(encodedHeaders, 'base64url').toString('utf-8');
        customHeaders = JSON.parse(jsonStr);
      } catch (_) {}
    }

    await handleProxyStream(req, reply, decodedUrl, customHeaders);
  });
}

