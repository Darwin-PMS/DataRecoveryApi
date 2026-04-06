import { FastifyInstance } from 'fastify';
import { auditLogRoutes } from './controller';

export async function auditLogModule(fastify: FastifyInstance) {
  await auditLogRoutes(fastify);
}
