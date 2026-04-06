import { FastifyInstance } from 'fastify';
import { caseManagementRoutes } from './controller';

export async function caseManagementModule(fastify: FastifyInstance) {
  await caseManagementRoutes(fastify);
}
