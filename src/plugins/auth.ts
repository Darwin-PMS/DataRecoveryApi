import { FastifyRequest, FastifyReply } from 'fastify';
import { jwtVerify } from 'jose';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'secret');

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      tenantId: string | null;
      role: string;
    };
    tenantId?: string | null;
  }
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const authHeader = request.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'No token provided',
      });
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await jwtVerify(token, JWT_SECRET);

    if (payload.type === 'refresh') {
      return reply.status(401).send({
        code: 'INVALID_TOKEN',
        message: 'Refresh token cannot be used for authentication',
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId as string },
      select: {
        id: true,
        email: true,
        role: true,
        tenantId: true,
        status: true,
      },
    });

    if (!user) {
      return reply.status(401).send({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    if (user.status !== 'ACTIVE') {
      return reply.status(403).send({
        code: 'ACCOUNT_DISABLED',
        message: 'Your account has been disabled',
      });
    }

    request.user = {
      id: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
    };
    request.tenantId = user.tenantId;
  } catch (error) {
    return reply.status(401).send({
      code: 'INVALID_TOKEN',
      message: 'Invalid or expired token',
    });
  }
}

export async function authenticateOptional(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const authHeader = request.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return;
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await jwtVerify(token, JWT_SECRET);

    if (payload.type === 'refresh') {
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId as string },
      select: {
        id: true,
        email: true,
        role: true,
        tenantId: true,
        status: true,
      },
    });

    if (user && user.status === 'ACTIVE') {
      request.user = {
        id: user.id,
        email: user.email,
        tenantId: user.tenantId,
        role: user.role,
      };
      request.tenantId = user.tenantId;
    }
  } catch (error) {
    // Silently fail for optional auth
  }
}

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    }

    if (!roles.includes(request.user.role)) {
      return reply.status(403).send({
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
      });
    }
  };
}

export function requireTenant() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user?.tenantId) {
      return reply.status(400).send({
        code: 'NO_TENANT',
        message: 'User must belong to a tenant',
      });
    }
  };
}

export function tenantIsolation() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user?.tenantId) {
      return;
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: request.user.tenantId },
      select: { id: true, status: true },
    });

    if (!tenant) {
      return reply.status(403).send({
        code: 'TENANT_NOT_FOUND',
        message: 'Tenant not found',
      });
    }

    if (tenant.status !== 'ACTIVE') {
      return reply.status(403).send({
        code: 'TENANT_INACTIVE',
        message: 'Tenant is not active',
      });
    }
  };
}

export function createScopedQuery(tenantId: string) {
  return {
    where: {
      tenantId,
    },
  };
}
