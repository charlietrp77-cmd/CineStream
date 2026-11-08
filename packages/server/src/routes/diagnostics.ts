import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { fetch as undiciFetch } from 'undici';
import { config } from '../config';
import { db } from '../db';
import { ProfileRow } from '../db/schema';
import { aioStreams, cleanConfigToken } from '../services/aiostreams';

export async function diagnosticsRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  fastify.get('/api/diagnostics', async (_req: FastifyRequest, reply: FastifyReply) => {
    const report: any = {
      timestamp: new Date().toISOString(),
      publicServerUrl: config.publicServerUrl,
      aiostreamsInternalUrl: config.aiostreamsInternalUrl,
      tmdbConfigured: Boolean(config.tmdbApiKey),
      serverEnvConfig: cleanConfigToken(config.aiostreamsUserConfig) || null,
      profiles: [],
      aiostreamsHealth: null,
      testStreamResult: null,
    };

    // 1. Check Profiles in DB
    try {
      const profiles = db.prepare('SELECT id, name, aiostreams_config_override FROM profiles').all() as Partial<ProfileRow>[];
      report.profiles = profiles.map((p) => ({
        id: p.id,
        name: p.name,
        hasConfigOverride: Boolean(p.aiostreams_config_override),
        cleanedTokenPreview: p.aiostreams_config_override ? cleanConfigToken(p.aiostreams_config_override).slice(0, 16) + '...' : null,
      }));
    } catch (err: any) {
      report.profilesError = err.message;
    }

    // 2. Ping AIOStreams Internal URL
    try {
      const healthUrl = `${config.aiostreamsInternalUrl}/api/v1/health`;
      const res = await undiciFetch(healthUrl, { signal: AbortSignal.timeout(3000) });
      report.aiostreamsHealth = {
        url: healthUrl,
        statusCode: res.status,
        statusText: res.statusText,
        ok: res.ok,
      };
    } catch (err: any) {
      // Also try root
      try {
        const rootRes = await undiciFetch(config.aiostreamsInternalUrl, { signal: AbortSignal.timeout(3000) });
        report.aiostreamsHealth = {
          url: config.aiostreamsInternalUrl,
          statusCode: rootRes.status,
          statusText: rootRes.statusText,
          ok: rootRes.ok,
        };
      } catch (rootErr: any) {
        report.aiostreamsHealth = {
          reachable: false,
          error: err.message,
        };
      }
    }

    // 3. Test Stream Resolution for Dune 2 (tt15239678)
    const testToken =
      cleanConfigToken(config.aiostreamsUserConfig) ||
      (report.profiles.length > 0 && report.profiles[0].hasConfigOverride
        ? cleanConfigToken((db.prepare('SELECT aiostreams_config_override FROM profiles WHERE id = ?').get(report.profiles[0].id) as any)?.aiostreams_config_override || '')
        : '');

    if (!testToken) {
      report.testStreamResult = {
        error: 'No AIOStreams config token found in either AIOSTREAMS_USER_CONFIG or Profile settings. See Step 3 in setup instructions.',
      };
    } else {
      const directAioUrl = `${config.aiostreamsInternalUrl}/${testToken}/stream/movie/tt15239678.json`;
      try {
        const rawRes = await undiciFetch(directAioUrl, { signal: AbortSignal.timeout(8000) });
        const rawText = await rawRes.text();
        let parsedJson: any = null;
        try {
          parsedJson = JSON.parse(rawText);
        } catch (_) {}

        const resolvedStreams = await aioStreams.resolveStreams('movie', 'tt15239678', testToken);

        report.testStreamResult = {
          queriedUrl: directAioUrl,
          httpStatus: rawRes.status,
          rawStreamCount: parsedJson?.streams ? parsedJson.streams.length : 0,
          resolvedStreamCount: resolvedStreams.length,
          bestStreamFound: resolvedStreams.length > 0 ? {
            name: resolvedStreams[0].name,
            title: resolvedStreams[0].title,
            badges: resolvedStreams[0].badges,
          } : null,
          rawResponseSample: parsedJson?.streams ? parsedJson.streams.slice(0, 2) : rawText.slice(0, 300),
        };
      } catch (err: any) {
        report.testStreamResult = {
          queriedUrl: directAioUrl,
          error: err.message,
        };
      }
    }

    return reply.send(report);
  });
}
