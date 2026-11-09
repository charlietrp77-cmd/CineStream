import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { providerQuotas } from '../services/providerQuotas';
import { getProfileById } from './profiles';

export async function providerRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  fastify.get('/api/providers/quotas', async (req: FastifyRequest, reply: FastifyReply) => {
    const profileId = (req.headers['x-profile-id'] as string) || '';
    const profile = profileId ? getProfileById(profileId) : undefined;
    const configOverride = profile?.aiostreams_config_override;

    const quotas = await providerQuotas.getQuotas(configOverride);
    return reply.send(quotas);
  });
}
