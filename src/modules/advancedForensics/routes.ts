import { FastifyInstance } from 'fastify';
import { advancedForensicsRoutes } from './controller';

export async function advancedForensicsModule(fastify: FastifyInstance) {
  await advancedForensicsRoutes(fastify);
}
