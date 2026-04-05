import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';

export async function userRoutes(
  app: FastifyInstance,
  options: FastifyPluginOptions
) {
  app.get('/me', async (request, reply) => {
    return reply.send({
      user: {
        id: '1',
        email: 'demo@datavault.pro',
        firstName: 'Demo',
        lastName: 'User',
        role: 'TENANT_ADMIN',
        status: 'ACTIVE',
        emailVerified: true,
        createdAt: new Date().toISOString(),
      },
    });
  });

  app.put('/me', async (request, reply) => {
    return reply.send({
      user: {
        id: '1',
        email: 'demo@datavault.pro',
        firstName: 'Demo',
        lastName: 'User',
        role: 'TENANT_ADMIN',
        status: 'ACTIVE',
        emailVerified: true,
        createdAt: new Date().toISOString(),
      },
    });
  });
}
