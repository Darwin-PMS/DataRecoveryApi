import { FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();

const inviteUserSchema = z.object({
  email: z.string().email(),
  role: z.enum([
    'TENANT_ADMIN',
    'FORENSIC_ANALYST',
    'RECOVERY_TECHNICIAN',
    'SUPPORT_ENGINEER',
    'BILLING_ADMIN',
    'TEAM_MANAGER',
    'MEMBER',
    'GUEST',
  ]),
  department: z.string().optional(),
});

const updateUserRoleSchema = z.object({
  role: z.enum([
    'TENANT_ADMIN',
    'FORENSIC_ANALYST',
    'RECOVERY_TECHNICIAN',
    'SUPPORT_ENGINEER',
    'BILLING_ADMIN',
    'TEAM_MANAGER',
    'MEMBER',
    'GUEST',
  ]),
});

const inviteBulkSchema = z.object({
  invites: z.array(inviteUserSchema).min(1).max(10),
});

export async function listTeamMembersHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const tenantId = request.tenantId || request.user?.tenantId;
    
    if (!tenantId) {
      return reply.status(400).send({
        code: 'MISSING_TENANT',
        message: 'Tenant context required',
      });
    }

    const { page = '1', limit = '20', search, role } = request.query as any;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where: any = { tenantId };
    
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }
    
    if (role) {
      where.role = role;
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          emailVerified: true,
          createdAt: true,
          lastLoginAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    const pendingInvites = await prisma.userInvite.findMany({
      where: { tenantId, status: 'PENDING' },
      select: {
        id: true,
        email: true,
        role: true,
        invitedBy: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    return reply.send({
      data: {
        members: users,
        invites: pendingInvites,
      },
      meta: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to fetch team members',
    });
  }
}

export async function inviteMemberHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const tenantId = request.tenantId || request.user?.tenantId;
    const userId = request.user?.id;
    
    if (!tenantId || !userId) {
      return reply.status(400).send({
        code: 'MISSING_CONTEXT',
        message: 'Tenant and user context required',
      });
    }

    const body = inviteUserSchema.parse(request.body);
    const { email, role, department } = body;

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      if (existingUser.tenantId === tenantId) {
        return reply.status(400).send({
          code: 'USER_EXISTS',
          message: 'User is already a member of this team',
        });
      }
    }

    const existingInvite = await prisma.userInvite.findFirst({
      where: { email, tenantId, status: 'PENDING' },
    });

    if (existingInvite) {
      return reply.status(400).send({
        code: 'INVITE_EXISTS',
        message: 'An invitation has already been sent to this email',
      });
    }

    const invite = await prisma.userInvite.create({
      data: {
        email,
        role,
        department,
        tenantId,
        invitedBy: userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return reply.status(201).send({
      data: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        status: invite.status,
        expiresAt: invite.expiresAt,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to send invitation',
    });
  }
}

export async function inviteBulkHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const tenantId = request.tenantId || request.user?.tenantId;
    const userId = request.user?.id;
    
    if (!tenantId || !userId) {
      return reply.status(400).send({
        code: 'MISSING_CONTEXT',
        message: 'Tenant and user context required',
      });
    }

    const body = inviteBulkSchema.parse(request.body);
    const results = {
      invited: [] as any[],
      skipped: [] as any[],
      failed: [] as any[],
    };

    for (const invite of body.invites) {
      try {
        const existingUser = await prisma.user.findUnique({
          where: { email: invite.email },
        });

        if (existingUser && existingUser.tenantId === tenantId) {
          results.skipped.push({ email: invite.email, reason: 'Already a member' });
          continue;
        }

        const existingInvite = await prisma.userInvite.findFirst({
          where: { email: invite.email, tenantId, status: 'PENDING' },
        });

        if (existingInvite) {
          results.skipped.push({ email: invite.email, reason: 'Invite already sent' });
          continue;
        }

        const newInvite = await prisma.userInvite.create({
          data: {
            email: invite.email,
            role: invite.role,
            department: invite.department,
            tenantId,
            invitedBy: userId,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });

        results.invited.push({
          id: newInvite.id,
          email: newInvite.email,
          role: newInvite.role,
        });
      } catch (err) {
        results.failed.push({ email: invite.email, reason: 'Failed to create invite' });
      }
    }

    return reply.status(201).send({
      data: results,
      summary: {
        total: body.invites.length,
        invited: results.invited.length,
        skipped: results.skipped.length,
        failed: results.failed.length,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to process bulk invitations',
    });
  }
}

export async function updateMemberRoleHandler(
  request: FastifyRequest<{ Params: { userId: string } }>,
  reply: FastifyReply,
) {
  try {
    const tenantId = request.tenantId || request.user?.tenantId;
    
    if (!tenantId) {
      return reply.status(400).send({
        code: 'MISSING_TENANT',
        message: 'Tenant context required',
      });
    }

    const { userId } = request.params;
    const body = updateUserRoleSchema.parse(request.body);

    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId },
    });

    if (!user) {
      return reply.status(404).send({
        code: 'USER_NOT_FOUND',
        message: 'Team member not found',
      });
    }

    if (user.role === 'SUPER_ADMIN') {
      return reply.status(403).send({
        code: 'CANNOT_MODIFY',
        message: 'Cannot modify super admin role',
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { role: body.role as any },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
      },
    });

    return reply.send({
      data: updatedUser,
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to update member role',
    });
  }
}

export async function removeMemberHandler(
  request: FastifyRequest<{ Params: { userId: string } }>,
  reply: FastifyReply,
) {
  try {
    const tenantId = request.tenantId || request.user?.tenantId;
    const currentUserId = request.user?.id;
    
    if (!tenantId) {
      return reply.status(400).send({
        code: 'MISSING_TENANT',
        message: 'Tenant context required',
      });
    }

    const { userId } = request.params;

    if (userId === currentUserId) {
      return reply.status(400).send({
        code: 'CANNOT_REMOVE_SELF',
        message: 'You cannot remove yourself from the team',
      });
    }

    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId },
    });

    if (!user) {
      return reply.status(404).send({
        code: 'USER_NOT_FOUND',
        message: 'Team member not found',
      });
    }

    if (user.role === 'SUPER_ADMIN' || user.role === 'TENANT_ADMIN') {
      const adminCount = await prisma.user.count({
        where: { tenantId, role: { in: ['SUPER_ADMIN', 'TENANT_ADMIN'] } },
      });

      if (adminCount <= 1) {
        return reply.status(400).send({
          code: 'LAST_ADMIN',
          message: 'Cannot remove the last admin',
        });
      }
    }

    await prisma.user.delete({
      where: { id: userId },
    });

    return reply.status(204).send();
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to remove team member',
    });
  }
}

export async function resendInviteHandler(
  request: FastifyRequest<{ Params: { inviteId: string } }>,
  reply: FastifyReply,
) {
  try {
    const tenantId = request.tenantId || request.user?.tenantId;
    
    if (!tenantId) {
      return reply.status(400).send({
        code: 'MISSING_TENANT',
        message: 'Tenant context required',
      });
    }

    const { inviteId } = request.params;

    const invite = await prisma.userInvite.findFirst({
      where: { id: inviteId, tenantId, status: 'PENDING' },
    });

    if (!invite) {
      return reply.status(404).send({
        code: 'INVITE_NOT_FOUND',
        message: 'Invitation not found or already accepted',
      });
    }

    const updatedInvite = await prisma.userInvite.update({
      where: { id: inviteId },
      data: {
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return reply.send({
      data: {
        id: updatedInvite.id,
        email: updatedInvite.email,
        expiresAt: updatedInvite.expiresAt,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to resend invitation',
    });
  }
}

export async function cancelInviteHandler(
  request: FastifyRequest<{ Params: { inviteId: string } }>,
  reply: FastifyReply,
) {
  try {
    const tenantId = request.tenantId || request.user?.tenantId;
    
    if (!tenantId) {
      return reply.status(400).send({
        code: 'MISSING_TENANT',
        message: 'Tenant context required',
      });
    }

    const { inviteId } = request.params;

    const invite = await prisma.userInvite.findFirst({
      where: { id: inviteId, tenantId },
    });

    if (!invite) {
      return reply.status(404).send({
        code: 'INVITE_NOT_FOUND',
        message: 'Invitation not found',
      });
    }

    await prisma.userInvite.delete({
      where: { id: inviteId },
    });

    return reply.status(204).send();
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to cancel invitation',
    });
  }
}
