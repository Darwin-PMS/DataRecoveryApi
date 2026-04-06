import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  listImagesHandler,
  getImageHandler,
  createImageHandler,
  processImageHandler,
  deleteImageHandler,
  validateImageHandler,
  uploadChunkHandler,
} from './controller';
import {
  uploadDiskImageHandler,
  listDiskImagesHandler,
  getDiskImageHandler,
  deleteDiskImageHandler,
  verifyDiskImageHandler,
} from './enhancedController';
import { authenticate, tenantIsolation } from '../../plugins/auth';

export async function diskImageRoutes(
  app: FastifyInstance,
  options: FastifyPluginOptions
) {
  app.addHook('onRequest', authenticate);
  app.addHook('preHandler', tenantIsolation());

  // Existing routes
  app.get('/', listImagesHandler);

  app.post('/', createImageHandler);

  app.post('/upload', uploadChunkHandler);

  app.get('/:id', getImageHandler);

  app.post('/:id/process', processImageHandler);

  app.post('/:id/validate', validateImageHandler);

  app.delete('/:id', deleteImageHandler);

  // Enhanced routes (Phase 6)
  app.post('/upload-multipart', uploadDiskImageHandler);
  app.get('/list', listDiskImagesHandler);
  app.get('/details/:id', getDiskImageHandler);
  app.delete('/delete/:id', deleteDiskImageHandler);
  app.post('/:id/verify', verifyDiskImageHandler);
}
