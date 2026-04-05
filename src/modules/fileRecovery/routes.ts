import { FastifyInstance, FastifyPluginOptions } from "fastify";
import {
  listFilesHandler,
  getFilePreviewHandler,
  recoverFilesHandler,
  getRecoveryStatusHandler,
} from "./controller";
import { authenticate, tenantIsolation } from "../../plugins/auth";

export async function fileRecoveryRoutes(
  app: FastifyInstance,
  options: FastifyPluginOptions,
) {
  app.addHook("onRequest", authenticate);
  app.addHook("preHandler", tenantIsolation());

  app.get("/:jobId/files", listFilesHandler);

  app.get("/:jobId/files/:fileId", getFilePreviewHandler);

  app.post("/:jobId/recover", recoverFilesHandler);

  app.get("/recoveries/:recoveryId", getRecoveryStatusHandler);
}
