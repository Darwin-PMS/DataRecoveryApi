import { FastifyInstance } from 'fastify';
import { reportsRoutes } from './controller';

export async function reportsModule(fastify: FastifyInstance) {
  await reportsRoutes(fastify);
}
