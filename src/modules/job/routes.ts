import { FastifyInstance, FastifyPluginOptions } from "fastify";
import {
  listJobsHandler,
  createJobHandler,
  getJobHandler,
  updateJobHandler,
  startJobHandler,
  pauseJobHandler,
  cancelJobHandler,
  deleteJobHandler,
  getJobFilesHandler,
} from "./controller";
import { createJobSchema } from "./schemas";
import { authenticate, tenantIsolation, requireTenant } from "../../plugins/auth";

console.log('[JOB ROUTES] Module loaded');

export async function jobRoutes(
  app: FastifyInstance,
  options: FastifyPluginOptions,
) {
  console.log('[JOB ROUTES] Registering routes');
  
  app.addHook("onRequest", authenticate);
  app.addHook("preHandler", tenantIsolation());

  app.get("/", {
    preHandler: [requireTenant()],
  }, listJobsHandler);

  app.post(
    "/",
    {
      schema: createJobSchema,
      preHandler: [requireTenant()],
    },
    createJobHandler,
  );

  app.get("/:id", getJobHandler);

  app.patch("/:id", updateJobHandler);

  app.post("/:id/start", startJobHandler);

  app.post("/:id/pause", pauseJobHandler);

  app.post("/:id/cancel", cancelJobHandler);

  app.delete("/:id", deleteJobHandler);

  app.get("/:id/files", getJobFilesHandler);
}
