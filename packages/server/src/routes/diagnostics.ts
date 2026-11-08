import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { fetch as undiciFetch } from 'undici';
import { config } from '../config';
import { db } from '../db';
import { ProfileRow } from '../db/schema';
import { aioStreams, buildStreamUrls, cleanConfigToken } from '../services/aiostreams';

export async function diagnosticsRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  fastify.get('/api/diagnostics', async (_req: FastifyRequest, reply: FastifyReply) => {
    const rawEnvConfig = config.aiostreamsUserConfig || '';
    const report: any = {
      timestamp: new Date().toISOString(),
      publicServerUrl: config.publicServerUrl,
      aiostreamsInternalUrl: config.aiostreamsInternalUrl,
      tmdbConfigured: Boolean(config.tmdbApiKey),
      serverEnvConfigRaw: rawEnvConfig,
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
        rawConfigOverride: p.aiostreams_config_override || null,
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
    const profileOverride = report.profiles.find((p: any) => p.rawConfigOverride)?.rawConfigOverride;
    const testConfigInput = profileOverride || rawEnvConfig || '';

    if (!testConfigInput) {
      report.testStreamResult = {
        error: 'No AIOStreams configuration found. Please paste your full manifest URL from AIOStreams into Profile Settings or AIOSTREAMS_USER_CONFIG.',
      };
    } else {
      const candidateUrls = buildStreamUrls(config.aiostreamsInternalUrl, testConfigInput, 'movie', 'tt15239678');
      const attemptedResults: any[] = [];

      for (const url of candidateUrls) {
        try {
          const rawRes = await undiciFetch(url, { signal: AbortSignal.timeout(8000) });
          const rawText = await rawRes.text();
          let parsed: any = null;
          try {
            parsed = JSON.parse(rawText);
          } catch (_) {}

          attemptedResults.push({
            url,
            statusCode: rawRes.status,
            streamCount: parsed?.streams ? parsed.streams.length : 0,
            sample: parsed?.streams ? parsed.streams.slice(0, 1) : rawText.slice(0, 150),
          });
        } catch (e: any) {
          attemptedResults.push({ url, error: e.message });
        }
      }

      const resolvedStreams = await aioStreams.resolveStreams('movie', 'tt15239678', testConfigInput);

      report.testStreamResult = {
        activeConfigUsed: testConfigInput,
        candidateUrlsAttempted: attemptedResults,
        resolvedStreamCount: resolvedStreams.length,
        bestStreamFound: resolvedStreams.length > 0 ? {
          name: resolvedStreams[0].name,
          title: resolvedStreams[0].title,
          badges: resolvedStreams[0].badges,
        } : null,
      };
    }

    return reply.send(report);
  });
}

