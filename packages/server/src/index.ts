import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import fs from 'fs';
import path from 'path';
import { config } from './config';
import { nasDownloader } from './services/nasDownloader';
import { profileRoutes } from './routes/profiles';
import { catalogRoutes } from './routes/catalog';
import { streamRoutes } from './routes/streams';
import { nasRoutes } from './routes/nas';
import { progressRoutes } from './routes/progress';
import { streamProxyRoutes } from './routes/streamProxy';
import { diagnosticsRoutes } from './routes/diagnostics';
import { providerRoutes } from './routes/providerRoutes';
import { arrRoutes } from './routes/arrRoutes';
import { backupRoutes } from './routes/backupRoutes';
import { bootstrapService } from './services/bootstrapService';
import { backupService } from './services/backupService';

async function bootstrap() {
  // Execute zero-touch environment & Servarr auto-provisioning
  await bootstrapService.run().catch((err) => {
    console.warn('[Bootstrap] Initial auto-provisioning notice:', err?.message || err);
  });

  // Start automated configuration backup engine
  backupService.init();

  const fastify = Fastify({
    logger: config.nodeEnv === 'development',
    trustProxy: true,
  });

  // Enable CORS
  await fastify.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'X-Profile-Id'],
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
  });

  // Register WebSockets
  await fastify.register(fastifyWebsocket);

  // Health check endpoint
  fastify.get('/api/health', async (_req, reply) => {
    return reply.send({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: Date.now(),
      version: '1.0.0',
    });
  });

  // WebSocket endpoint for real-time NAS downloads progress
  fastify.get('/ws/downloads', { websocket: true }, (socket: any, _req) => {
    const ws = socket?.socket || socket;
    nasDownloader.addWsClient(ws);
  });

  // Register API routes
  await fastify.register(profileRoutes);
  await fastify.register(catalogRoutes);
  await fastify.register(streamRoutes);
  await fastify.register(nasRoutes);
  await fastify.register(progressRoutes);
  await fastify.register(streamProxyRoutes);
  await fastify.register(diagnosticsRoutes);
  await fastify.register(providerRoutes);
  await fastify.register(arrRoutes);
  await fastify.register(backupRoutes);

  // Serve static frontend in production
  const webDistPath = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(webDistPath)) {
    await fastify.register(fastifyStatic, {
      root: webDistPath,
      prefix: '/',
    });

    fastify.setNotFoundHandler((req, reply) => {
      if (req.raw.url && (req.raw.url.startsWith('/api') || req.raw.url.startsWith('/proxy') || req.raw.url.startsWith('/ws'))) {
        return reply.status(404).send({ error: 'Route not found' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    fastify.get('/', async (_req, reply) => {
      return reply.send({
        name: 'CineStream API Server',
        status: 'running',
        note: 'Frontend bundle not yet generated at packages/web/dist',
      });
    });
  }

  try {
    const address = await fastify.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`🚀 CineStream server running on ${address}`);
    console.log(`⚡ Public URL: ${config.publicServerUrl}`);
  } catch (err) {
    console.error('Fatal server startup error:', err);
    process.exit(1);
  }
}

bootstrap();
