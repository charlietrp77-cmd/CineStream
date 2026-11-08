import { FastifyRequest, FastifyReply } from 'fastify';
import { Agent, request as undiciRequest } from 'undici';
import { config } from '../config';

const undiciAgent = new Agent({
  connections: 64,
  keepAliveTimeout: 30000,
  keepAliveMaxTimeout: 60000,
});

interface UpstreamMetadata {
  totalSize: number;
  contentType: string;
  acceptsRanges: boolean;
  expiresAt: number;
}

const metadataCache = new Map<string, UpstreamMetadata>();

export async function getUpstreamMetadata(
  url: string,
  customHeaders?: Record<string, string>
): Promise<UpstreamMetadata> {
  const cached = metadataCache.get(url);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached;
  }

  const reqHeaders: Record<string, string> = {
    Range: 'bytes=0-1',
    'User-Agent': 'CineStream/1.0.0 (Fastify)',
    ...customHeaders,
  };

  const response = await undiciRequest(url, {
    method: 'GET',
    headers: reqHeaders,
    dispatcher: undiciAgent,
  });

  const headers = response.headers;
  const contentRange = headers['content-range'] as string | undefined;
  const contentType = (headers['content-type'] as string) || 'video/x-matroska';
  const acceptRanges = headers['accept-ranges'] as string | undefined;

  let totalSize = 0;
  let acceptsRanges = acceptRanges === 'bytes' || Boolean(contentRange);

  if (contentRange) {
    const match = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(contentRange);
    if (match && match[3] !== '*') {
      totalSize = parseInt(match[3], 10);
    }
  }

  if (!totalSize) {
    const contentLength = headers['content-length'] as string | undefined;
    if (contentLength) {
      totalSize = parseInt(contentLength, 10);
    }
  }

  // Drain body to free connection
  for await (const _ of response.body) {
    // consume
  }

  const meta: UpstreamMetadata = {
    totalSize,
    contentType,
    acceptsRanges,
    expiresAt: now + 30 * 60 * 1000, // 30 mins TTL
  };

  metadataCache.set(url, meta);
  return meta;
}

export async function handleProxyStream(
  req: FastifyRequest,
  reply: FastifyReply,
  upstreamUrl: string,
  upstreamHeaders?: Record<string, string>
): Promise<void> {
  const meta = await getUpstreamMetadata(upstreamUrl, upstreamHeaders);

  const totalSize = meta.totalSize;
  const rawRange = req.headers.range;

  let startByte = 0;
  let endByte = totalSize > 0 ? totalSize - 1 : 0;

  if (rawRange) {
    const rangeMatch = /bytes=(\d*)-(\d*)/.exec(rawRange);
    if (rangeMatch) {
      if (rangeMatch[1]) {
        startByte = parseInt(rangeMatch[1], 10);
      }
      if (rangeMatch[2]) {
        endByte = parseInt(rangeMatch[2], 10);
      } else if (totalSize > 0) {
        endByte = totalSize - 1;
      }
    }
  }

  if (totalSize > 0 && startByte >= totalSize) {
    reply.status(416).headers({
      'Content-Range': `bytes */${totalSize}`,
    }).send('Requested range not satisfiable');
    return;
  }

  const contentLength = endByte - startByte + 1;

  // Set 206 Partial Content headers
  reply.raw.statusCode = 206;
  reply.raw.setHeader('Accept-Ranges', 'bytes');
  reply.raw.setHeader('Content-Type', meta.contentType || 'video/x-matroska');
  reply.raw.setHeader('Content-Length', contentLength.toString());
  if (totalSize > 0) {
    reply.raw.setHeader('Content-Range', `bytes ${startByte}-${endByte}/${totalSize}`);
  }
  reply.raw.setHeader('Connection', 'keep-alive');

  const abortController = new AbortController();
  const onClientClose = () => {
    abortController.abort();
  };
  req.raw.on('close', onClientClose);

  // 1. Small Metadata Tail-Seek Fast Path
  const isSmallRange = contentLength <= 2 * 1024 * 1024;
  const isTailSeek = totalSize > 0 && startByte > totalSize - 4 * 1024 * 1024;

  if (isSmallRange || isTailSeek) {
    try {
      const response = await undiciRequest(upstreamUrl, {
        method: 'GET',
        headers: {
          Range: `bytes=${startByte}-${endByte}`,
          'User-Agent': 'CineStream/1.0.0 (Fastify)',
          ...upstreamHeaders,
        },
        signal: abortController.signal,
        dispatcher: undiciAgent,
      });

      for await (const chunk of response.body) {
        if (abortController.signal.aborted) break;
        const canWrite = reply.raw.write(chunk);
        if (!canWrite) {
          await new Promise<void>((res) => reply.raw.once('drain', res));
        }
      }
      reply.raw.end();
    } catch (err: any) {
      if (!abortController.signal.aborted) {
        reply.raw.destroy(err);
      }
    } finally {
      req.raw.off('close', onClientClose);
    }
    return;
  }

  // 2. Sliding-Window Parallel Worker Pool
  const CHUNK_SIZE = config.proxyChunkSizeMb * 1024 * 1024;
  const MAX_WORKERS = Math.max(2, config.proxyConnections);
  const MAX_READAHEAD_CHUNKS = Math.max(2, Math.ceil(config.proxyReadaheadMb / config.proxyChunkSizeMb));

  const totalChunks = Math.ceil(contentLength / CHUNK_SIZE);

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
  let nextChunkToAssign = 1; // Chunk 0 is streamed immediately by worker 0
  let isFlushing = false;
  let flushResolvers: Array<() => void> = [];

  const notifyFlusher = () => {
    const list = flushResolvers;
    flushResolvers = [];
    for (const r of list) r();
  };

  const fetchChunkData = async (task: ChunkTask): Promise<Buffer> => {
    const response = await undiciRequest(upstreamUrl, {
      method: 'GET',
      headers: {
        Range: `bytes=${task.start}-${task.end}`,
        'User-Agent': 'CineStream/1.0.0 (Fastify)',
        ...upstreamHeaders,
      },
      signal: abortController.signal,
      dispatcher: undiciAgent,
    });

    const buffers: Buffer[] = [];
    for await (const chunk of response.body) {
      if (abortController.signal.aborted) throw new Error('Aborted');
      buffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(buffers);
  };

  // Prefetch worker loop
  const runPrefetchWorker = async () => {
    while (!abortController.signal.aborted && nextChunkToAssign < totalChunks) {
      if (nextChunkToAssign > currentFlushIndex + MAX_READAHEAD_CHUNKS) {
        // Wait until flusher moves forward
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
      } catch (err) {
        if (!abortController.signal.aborted) {
          // Put chunk back to retry or break
          break;
        }
      }
    }
  };

  // Start background workers for chunks 1..N
  const workerPromises: Promise<void>[] = [];
  const workerCount = Math.min(MAX_WORKERS - 1, Math.max(1, totalChunks - 1));
  for (let w = 0; w < workerCount; w++) {
    workerPromises.push(runPrefetchWorker());
  }

  // Stream Chunk 0 directly to client for instant TTFB
  try {
    const chunk0 = chunks[0];
    const res0 = await undiciRequest(upstreamUrl, {
      method: 'GET',
      headers: {
        Range: `bytes=${chunk0.start}-${chunk0.end}`,
        'User-Agent': 'CineStream/1.0.0 (Fastify)',
        ...upstreamHeaders,
      },
      signal: abortController.signal,
      dispatcher: undiciAgent,
    });

    for await (const chunk of res0.body) {
      if (abortController.signal.aborted) break;
      const canWrite = reply.raw.write(chunk);
      if (!canWrite) {
        await new Promise<void>((res) => reply.raw.once('drain', res));
      }
    }

    currentFlushIndex = 1;
    notifyFlusher();

    // Now flush chunks 1 through totalChunks - 1 in order
    while (currentFlushIndex < totalChunks && !abortController.signal.aborted) {
      if (completedChunks.has(currentFlushIndex)) {
        const buf = completedChunks.get(currentFlushIndex)!;
        completedChunks.delete(currentFlushIndex);

        const canWrite = reply.raw.write(buf);
        if (!canWrite) {
          await new Promise<void>((res) => reply.raw.once('drain', res));
        }

        currentFlushIndex++;
        notifyFlusher();
      } else {
        // Wait for next chunk to complete
        await new Promise<void>((resolve) => {
          flushResolvers.push(resolve);
        });
      }
    }

    if (!abortController.signal.aborted) {
      reply.raw.end();
    }
  } catch (err: any) {
    if (!abortController.signal.aborted) {
      reply.raw.destroy(err);
    }
  } finally {
    abortController.abort();
    completedChunks.clear();
    req.raw.off('close', onClientClose);
    await Promise.allSettled(workerPromises);
  }
}

