import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { 
  createTenantHandler, 
  getTenantsHandler, 
  getTenantHandler, 
  updateTenantHandler,
  switchTenantHandler,
} from './controller';

export async function tenantRoutes(
  app: FastifyInstance,
  options: FastifyPluginOptions
) {
  app.post('/', createTenantHandler);

  app.get('/', getTenantsHandler);

  app.get('/:id', getTenantHandler);

  app.patch('/:id', updateTenantHandler);

  app.post('/:id/switch', switchTenantHandler);
}
