import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  listDrivesHandler,
  scanPathHandler,
  analyzePathHandler,
  getFileInfoHandler,
  deepScanHandler,
  searchFilesHandler,
  recoverFilesHandler,
  scanDeletedFilesHandler,
} from './controller';
import { authenticate } from '../../plugins/auth';

export async function forensicRoutes(
  app: FastifyInstance,
  options: FastifyPluginOptions
) {
  app.addHook("onRequest", authenticate);

  app.get('/drives', listDrivesHandler);
  
  app.post('/scan', scanPathHandler);
  
  app.post('/analyze', analyzePathHandler);
  
  app.get('/file/*', getFileInfoHandler);
  
  app.post('/deep-scan', deepScanHandler);
  
  app.post('/search', searchFilesHandler);
  
  app.post('/recover', recoverFilesHandler);
  
  app.post('/scan-deleted', scanDeletedFilesHandler);
}