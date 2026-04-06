import { FastifyInstance } from 'fastify';
import { evidenceRoutes } from './controller';

export async function evidenceModule(fastify: FastifyInstance) {
  await evidenceRoutes(fastify);
}
