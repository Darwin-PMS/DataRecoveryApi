import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Schema validators
const searchAuditLogsSchema = z.object({
  action: z.string().optional(),
  resource: z.string().optional(),
  userId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  ipAddress: z.string().optional(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(500).default(100),
});

// Handler: List audit logs
export async function listAuditLogsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const query = searchAuditLogsSchema.parse(request.query);

    const where: any = {
      tenantId: user.tenantId,
    };

    if (query.action) {
      where.action = { contains: query.action, mode: 'insensitive' };
    }

    if (query.resource) {
      where.resource = { contains: query.resource, mode: 'insensitive' };
    }

    if (query.userId) {
      where.userId = query.userId;
    }

    if (query.ipAddress) {
      where.ipAddress = query.ipAddress;
    }

    if (query.dateFrom || query.dateTo) {
      where.timestamp = {};
      if (query.dateFrom) where.timestamp.gte = new Date(query.dateFrom);
      if (query.dateTo) where.timestamp.lte = new Date(query.dateTo);
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return reply.send({
      code: 'AUDIT_LOGS_RETRIEVED',
      data: {
        logs: logs.map(log => ({
          ...log,
          user: log.user ? {
            id: log.user.id,
            email: log.user.email,
            name: `${log.user.firstName} ${log.user.lastName}`,
          } : null,
        })),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
        filters: {
          action: query.action,
          resource: query.resource,
          userId: query.userId,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          ipAddress: query.ipAddress,
        },
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'AUDIT_LOGS_RETRIEVAL_FAILED',
      message: 'Failed to retrieve audit logs',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Handler: Export audit logs to CSV
export async function exportAuditLogsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const query = searchAuditLogsSchema.parse(request.query);

    const where: any = {
      tenantId: user.tenantId,
    };

    // Apply same filters
    if (query.action) where.action = { contains: query.action, mode: 'insensitive' };
    if (query.resource) where.resource = { contains: query.resource, mode: 'insensitive' };
    if (query.userId) where.userId = query.userId;
    if (query.ipAddress) where.ipAddress = query.ipAddress;
    if (query.dateFrom || query.dateTo) {
      where.timestamp = {};
      if (query.dateFrom) where.timestamp.gte = new Date(query.dateFrom);
      if (query.dateTo) where.timestamp.lte = new Date(query.dateTo);
    }

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      include: {
        user: {
          select: {
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    // Generate CSV
    const headers = ['Timestamp', 'Action', 'Resource', 'Resource ID', 'User', 'IP Address', 'User Agent', 'Metadata'];
    const csvRows = [headers.join(',')];

    for (const log of logs) {
      const row = [
        log.timestamp.toISOString(),
        `"${log.action}"`,
        `"${log.resource}"`,
        `"${log.resourceId || ''}"`,
        `"${log.user ? `${log.user.firstName} ${log.user.lastName} (${log.user.email})` : 'System'}"`,
        `"${log.ipAddress || ''}"`,
        `"${log.userAgent || ''}"`,
        `"${log.metadata ? JSON.stringify(log.metadata).replace(/"/g, '""') : ''}"`,
      ];
      csvRows.push(row.join(','));
    }

    const csvContent = csvRows.join('\n');

    // Set headers for CSV download
    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', `attachment; filename="audit-logs-${Date.now()}.csv"`);

    return reply.send(csvContent);
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'AUDIT_LOGS_EXPORT_FAILED',
      message: 'Failed to export audit logs',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Handler: Get audit log statistics
export async function getAuditLogStatsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;

    // Get counts by action
    const byAction = await prisma.auditLog.groupBy({
      by: ['action'],
      where: { tenantId: user.tenantId },
      _count: true,
      orderBy: {
        _count: {
          action: 'desc',
        },
      },
    });

    // Get counts by resource
    const byResource = await prisma.auditLog.groupBy({
      by: ['resource'],
      where: { tenantId: user.tenantId },
      _count: true,
      orderBy: {
        _count: {
          resource: 'desc',
        },
      },
    });

    // Get counts by user
    const byUser = await prisma.auditLog.groupBy({
      by: ['userId'],
      where: {
        tenantId: user.tenantId,
        userId: { not: null },
      },
      _count: true,
      orderBy: {
        _count: {
          userId: 'desc',
        },
      },
    });

    // Get recent activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentCount = await prisma.auditLog.count({
      where: {
        tenantId: user.tenantId,
        timestamp: { gte: sevenDaysAgo },
      },
    });

    return reply.send({
      code: 'AUDIT_LOG_STATS_RETRIEVED',
      data: {
        byAction: byAction.map(item => ({
          action: item.action,
          count: item._count,
        })),
        byResource: byResource.map(item => ({
          resource: item.resource,
          count: item._count,
        })),
        byUser: byUser.map(item => ({
          userId: item.userId,
          count: item._count,
        })),
        recentActivity: {
          period: 'Last 7 days',
          count: recentCount,
        },
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'AUDIT_LOG_STATS_RETRIEVAL_FAILED',
      message: 'Failed to retrieve audit log statistics',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Register routes
export async function auditLogRoutes(fastify: FastifyInstance) {
  fastify.get('/', listAuditLogsHandler);
  fastify.get('/export', exportAuditLogsHandler);
  fastify.get('/stats', getAuditLogStatsHandler);
}
