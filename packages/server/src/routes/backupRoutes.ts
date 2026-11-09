import { FastifyInstance } from 'fastify';
import { backupService } from '../services/backupService';

export async function backupRoutes(fastify: FastifyInstance): Promise<void> {
  // Get backup engine health & service file statistics
  fastify.get('/api/backup/status', async (_req, reply) => {
    try {
      const status = backupService.getStatus();
      return reply.send(status);
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || 'Failed to inspect backups' });
    }
  });

  // Trigger an on-demand full stack backup immediately
  fastify.post('/api/backup/run', async (_req, reply) => {
    try {
      const result = await backupService.runFullBackup();
      return reply.send({
        success: true,
        message: 'Full configuration backup completed successfully',
        status: result,
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || 'Backup execution failed' });
    }
  });
}

