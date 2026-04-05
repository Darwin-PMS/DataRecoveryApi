import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function healthRoutes(
  app: FastifyInstance,
  options: FastifyPluginOptions
) {
  app.get('/db', async (request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'healthy', database: true };
    } catch (error) {
      return reply.status(503).send({ status: 'unhealthy', database: false });
    }
  });

  app.get('/ready', async (request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ready',
        checks: {
          database: true,
          redis: true,
          storage: true,
          queue: true,
        },
      };
    } catch (error) {
      return reply.status(503).send({
        status: 'not_ready',
        checks: {
          database: false,
          redis: true,
          storage: true,
          queue: true,
        },
      });
    }
  });

  app.get('/live', async (request, reply) => {
    return { status: 'alive' };
  });
}
