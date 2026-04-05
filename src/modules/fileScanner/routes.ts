import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  scanFileHandler,
  analyzeImageHandler,
  encodeHandler,
  decodeHandler,
  steganalysisHandler,
  carveHandler,
  analyzeTextHandler,
} from './controller';
import { authenticate } from '../../plugins/auth';

export async function fileScannerRoutes(
  app: FastifyInstance,
  options: FastifyPluginOptions
) {
  app.addHook("onRequest", authenticate);

  app.post('/scan', scanFileHandler);
  
  app.post('/analyze-image', analyzeImageHandler);
  
  app.post('/steganalysis', steganalysisHandler);
  
  app.post('/carve', carveHandler);
  
  app.post('/carve-upload', carveHandler);
  
  app.post('/analyze-text', analyzeTextHandler);
  
  app.post('/encode', encodeHandler);
  
  app.post('/decode', decodeHandler);
}