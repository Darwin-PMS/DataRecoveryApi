import { FastifyInstance, FastifyPluginOptions } from "fastify";
import {
  listTeamMembersHandler,
  inviteMemberHandler,
  inviteBulkHandler,
  updateMemberRoleHandler,
  removeMemberHandler,
  resendInviteHandler,
  cancelInviteHandler,
} from "./controller";
import { authenticate, tenantIsolation, requireRole } from "../../plugins/auth";

export async function teamRoutes(
  app: FastifyInstance,
  options: FastifyPluginOptions,
) {
  app.addHook("onRequest", authenticate);
  app.addHook("preHandler", tenantIsolation());

  app.get("/", listTeamMembersHandler);

  app.post("/invite", {
    preHandler: [requireRole("TENANT_ADMIN", "SUPER_ADMIN")],
  }, inviteMemberHandler);

  app.post("/invite/bulk", {
    preHandler: [requireRole("TENANT_ADMIN", "SUPER_ADMIN")],
  }, inviteBulkHandler);

  app.patch<{ Params: { userId: string } }>("/:userId/role", {
    preHandler: [requireRole("TENANT_ADMIN", "SUPER_ADMIN")],
  }, updateMemberRoleHandler);

  app.delete<{ Params: { userId: string } }>("/:userId", {
    preHandler: [requireRole("TENANT_ADMIN", "SUPER_ADMIN")],
  }, removeMemberHandler);

  app.post<{ Params: { inviteId: string } }>("/invites/:inviteId/resend", {
    preHandler: [requireRole("TENANT_ADMIN", "SUPER_ADMIN")],
  }, resendInviteHandler);

  app.delete<{ Params: { inviteId: string } }>("/invites/:inviteId", {
    preHandler: [requireRole("TENANT_ADMIN", "SUPER_ADMIN")],
  }, cancelInviteHandler);
}
