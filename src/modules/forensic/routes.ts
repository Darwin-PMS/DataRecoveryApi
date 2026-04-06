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
import {
  getDetailedDrivesHandler,
  deepDriveScanHandler,
  usnJournalHandler,
  deletedFileScanHandler,
  timelineReconstructionHandler,
} from './enhancedController';
import { authenticate } from '../../plugins/auth';

export async function forensicRoutes(
  app: FastifyInstance,
  options: FastifyPluginOptions
) {
  app.addHook("onRequest", authenticate);

  // Existing forensic endpoints
  app.get('/drives', listDrivesHandler);

  app.post('/scan', scanPathHandler);

  app.post('/analyze', analyzePathHandler);

  app.get('/file/*', getFileInfoHandler);

  app.post('/deep-scan', deepScanHandler);

  app.post('/search', searchFilesHandler);

  app.post('/recover', recoverFilesHandler);

  app.post('/scan-deleted', scanDeletedFilesHandler);

  // Phase 3: Enhanced forensic endpoints
  app.get('/detailed-drives', getDetailedDrivesHandler);

  app.post('/deep-drive-scan', deepDriveScanHandler);

  app.post('/usn-journal', usnJournalHandler);

  app.post('/deleted-files', deletedFileScanHandler);

  app.post('/timeline', timelineReconstructionHandler);
}