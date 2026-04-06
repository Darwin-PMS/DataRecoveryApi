import { FastifyInstance } from 'fastify';
import { corruptedDiskRoutes } from './controller';

export async function corruptedDiskModule(fastify: FastifyInstance) {
  await corruptedDiskRoutes(fastify);
}
