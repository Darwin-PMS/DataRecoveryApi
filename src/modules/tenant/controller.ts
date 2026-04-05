import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { jwtVerify } from 'jose';

const prisma = new PrismaClient();

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'secret');

const updateTenantSchema = z.object({
  name: z.string().min(1).optional(),
  website: z.string().url().optional().nullable(),
  timezone: z.string().optional(),
  country: z.string().optional().nullable(),
  logo: z.string().optional().nullable(),
});

export async function createTenantHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = request.body as { name: string; slug?: string };
    
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = payload.userId as string;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'User not found' });
    }

    const slug = body.slug || body.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');

    const existingTenant = await prisma.tenant.findUnique({
      where: { slug },
    });

    if (existingTenant) {
      return reply.status(400).send({ code: 'TENANT_EXISTS', message: 'A workspace with this name already exists' });
    }

    const tenant = await prisma.tenant.create({
      data: {
        name: body.name,
        slug,
        plan: 'FREE',
        userLimit: 1,
      },
    });

    await prisma.user.update({
      where: { id: userId },
      data: { 
        tenantId: tenant.id,
        role: 'TENANT_ADMIN',
      },
    });

    return reply.status(201).send({ tenant });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'An error occurred' });
  }
}

export async function getTenantsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = payload.userId as string;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true },
    });

    if (!user || !user.tenantId) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'Tenant not found' });
    }

    const tenants = await prisma.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        status: true,
      },
      orderBy: { name: 'asc' },
    });

    return reply.send({ tenants });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'An error occurred' });
  }
}

export async function getTenantHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = payload.userId as string;
    const { id } = request.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true },
    });

    if (!user || !user.tenantId) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'Tenant not found' });
    }

    if (user.tenantId !== id && user.role !== 'SUPER_ADMIN') {
      return reply.status(403).send({ code: 'FORBIDDEN', message: 'Access denied' });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        _count: {
          select: { users: true },
        },
      },
    });

    if (!tenant) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'Tenant not found' });
    }

    return reply.send({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        plan: tenant.plan,
        logo: tenant.logo,
        website: tenant.website,
        country: tenant.country,
        timezone: tenant.timezone,
        storageUsed: tenant.storageUsed,
        storageLimit: tenant.storageLimit,
        userCount: tenant._count.users,
        userLimit: tenant.userLimit,
        createdAt: tenant.createdAt,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'An error occurred' });
  }
}

export async function updateTenantHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = payload.userId as string;
    const { id } = request.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.tenantId) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'Tenant not found' });
    }

    if (user.tenantId !== id && user.role !== 'SUPER_ADMIN') {
      return reply.status(403).send({ code: 'FORBIDDEN', message: 'Access denied' });
    }

    const body = updateTenantSchema.parse(request.body);

    const tenant = await prisma.tenant.update({
      where: { id },
      data: body,
    });

    return reply.send({ tenant });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'An error occurred' });
  }
}

export async function switchTenantHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = payload.userId as string;
    const { id } = request.params;

    const tenant = await prisma.tenant.findUnique({
      where: { id },
    });

    if (!tenant || tenant.status !== 'ACTIVE') {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'Tenant not found or inactive' });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { tenantId: id },
      include: { tenant: true },
    });

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        tenantId: user.tenantId,
        tenant: user.tenant,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'An error occurred' });
  }
}