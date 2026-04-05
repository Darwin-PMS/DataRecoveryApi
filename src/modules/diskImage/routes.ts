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

export async function diskImageRoutes(
  app: FastifyInstance,
  options: FastifyPluginOptions
) {
  app.get('/', listImagesHandler);

  app.post('/', createImageHandler);

  app.post('/upload', uploadChunkHandler);

  app.get('/:id', getImageHandler);

  app.post('/:id/process', processImageHandler);

  app.post('/:id/validate', validateImageHandler);

  app.delete('/:id', deleteImageHandler);
}
