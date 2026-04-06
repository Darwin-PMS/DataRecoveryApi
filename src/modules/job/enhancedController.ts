import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// Schema validators
const createJobSchema = z.object({
  name: z.string().min(1, 'Job name is required').max(255),
  description: z.string().max(2000).optional(),
  type: z.enum([
    'QUICK_SCAN', 'DEEP_SCAN', 'SIGNATURE_SCAN', 'CARVING',
    'RAID_RECOVERY', 'PARTITION_RECOVERY', 'CLOUD_BACKUP', 'FORENSIC',
    'CORRUPTED_DISK_ANALYSIS', 'CLONE_DAMAGED_DISK', 'FILESYSTEM_REPAIR',
    'SSD_ANALYSIS', 'MEMORY_FORENSICS', 'TIMELINE_GENERATION',
    'REGISTRY_ANALYSIS', 'BROWSER_FORENSICS', 'EMAIL_ANALYSIS',
    'NETWORK_ANALYSIS', 'YARA_SCAN', 'IOC_EXTRACTION',
    'STEGANALYSIS', 'ENCRYPTION_DETECTION', 'MOBILE_FORENSICS'
  ]),
  sourceType: z.enum(['UPLOAD', 'AGENT', 'CLOUD', 'CORRUPTED_DISK', 'RAID_ARRAY', 'SSD_NVME', 'MOBILE_DEVICE', 'MEMORY_DUMP']),
  sourcePath: z.string().optional(),
  diskImageId: z.string().optional(),
  settings: z.record(z.any()).optional(),
  caseId: z.string().optional(),
});

const updateJobSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  settings: z.record(z.any()).optional(),
});

const updateJobStatusSchema = z.object({
  status: z.enum(['PENDING', 'QUEUED', 'SCANNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED']),
  progress: z.number().min(0).max(100).optional(),
  filesFound: z.number().optional(),
  filesRecovered: z.number().optional(),
  error: z.string().optional(),
});

const searchJobsSchema = z.object({
  query: z.string().optional(),
  type: z.array(z.string()).optional(),
  status: z.array(z.string()).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20),
});

const generateReportSchema = z.object({
  caseId: z.string().optional(),
  jobId: z.string().optional(),
  reportType: z.enum(['CASE_SUMMARY', 'JOB_REPORT', 'EVIDENCE_REPORT', 'FORENSIC_REPORT', 'EXECUTIVE_SUMMARY']).default('CASE_SUMMARY'),
  format: z.enum(['JSON', 'PDF']).default('JSON'),
  includeMetadata: z.boolean().default(true),
  includeTimeline: z.boolean().default(true),
  includeEvidence: z.boolean().default(true),
});

// Helper: Generate report data
async function generateReportData(options: {
  caseId?: string;
  jobId?: string;
  reportType: string;
  includeMetadata: boolean;
  includeTimeline: boolean;
  includeEvidence: boolean;
}): Promise<any> {
  const report: any = {
    reportType: options.reportType,
    generatedAt: new Date(),
    version: '1.0',
  };

  // If case report
  if (options.caseId) {
    const caseData = await prisma.forensicCase.findUnique({
      where: { id: options.caseId },
      include: {
        evidence: options.includeEvidence,
        auditLogs: options.includeTimeline ? {
          orderBy: { timestamp: 'desc' },
          take: 100,
        } : false,
      },
    });

    if (caseData) {
      report.case = {
        id: caseData.id,
        caseNumber: caseData.caseNumber,
        name: caseData.name,
        description: caseData.description,
        status: caseData.status,
        priority: caseData.priority,
        createdAt: caseData.createdAt,
        updatedAt: caseData.updatedAt,
        metadata: options.includeMetadata ? caseData.metadata : undefined,
      };

      if (options.includeEvidence && caseData.evidence) {
        report.evidence = {
          total: caseData.evidence.length,
          byType: {} as Record<string, number>,
          byStatus: {} as Record<string, number>,
          items: caseData.evidence.map(e => ({
            id: e.id,
            filename: e.filename,
            evidenceType: e.evidenceType,
            status: e.status,
            collectedBy: e.collectedBy,
            collectedAt: e.collectedAt,
            fileSize: e.fileSize,
            hashMD5: e.hashMD5,
            hashSHA256: e.hashSHA256,
          })),
        };

        // Calculate statistics
        for (const ev of caseData.evidence) {
          report.evidence.byType[ev.evidenceType] = 
            (report.evidence.byType[ev.evidenceType] || 0) + 1;
          report.evidence.byStatus[ev.status] = 
            (report.evidence.byStatus[ev.status] || 0) + 1;
        }
      }

      if (options.includeTimeline && caseData.auditLogs) {
        report.timeline = {
          totalEvents: caseData.auditLogs.length,
          events: caseData.auditLogs.map(log => ({
            timestamp: log.timestamp,
            action: log.action,
            resource: log.resource,
            userId: log.userId,
            ipAddress: log.ipAddress,
          })),
        };
      }
    }
  }

  // If job report
  if (options.jobId) {
    const job = await prisma.job.findUnique({
      where: { id: options.jobId },
      include: {
        files: true,
        recoveryJobs: true,
      },
    });

    if (job) {
      report.job = {
        id: job.id,
        name: job.name,
        description: job.description,
        type: job.type,
        status: job.status,
        progress: job.progress,
        filesFound: job.filesFound,
        filesRecovered: job.filesRecovered,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        createdAt: job.createdAt,
        metadata: options.includeMetadata ? job.settings : undefined,
      };

      if (job.files) {
        report.recoveredFiles = {
          total: job.files.length,
          files: job.files.map(f => ({
            id: f.id,
            name: f.name,
            originalPath: f.originalPath,
            size: f.size,
            type: f.type,
            extension: f.extension,
            recoverable: f.recoverable,
            recoveryProbability: f.recoveryProbability,
          })),
        };
      }
    }
  }

  return report;
}

// Helper: Format report as JSON
function formatReportAsJSON(report: any): string {
  return JSON.stringify(report, null, 2);
}

// Helper: Format report as PDF (simplified - would use PDFKit in production)
function formatReportAsPDF(report: any): Buffer {
  // In production, use PDFKit or similar library
  // For now, return a placeholder
  const content = `
DATAVAULT PRO - FORENSIC REPORT
================================

Report Type: ${report.reportType}
Generated: ${report.generatedAt.toISOString()}
Version: ${report.version}

${report.case ? `
CASE INFORMATION
================
Case Number: ${report.case.caseNumber}
Name: ${report.case.name}
Status: ${report.case.status}
Priority: ${report.case.priority}
Created: ${report.case.createdAt.toISOString()}
` : ''}

${report.evidence ? `
EVIDENCE SUMMARY
================
Total Evidence: ${report.evidence.total}
By Type: ${JSON.stringify(report.evidence.byType, null, 2)}
By Status: ${JSON.stringify(report.evidence.byStatus, null, 2)}
` : ''}

${report.job ? `
JOB INFORMATION
===============
Name: ${report.job.name}
Type: ${report.job.type}
Status: ${report.job.status}
Progress: ${report.job.progress}%
Files Found: ${report.job.filesFound}
Files Recovered: ${report.job.filesRecovered}
` : ''}

${report.timeline ? `
TIMELINE
========
Total Events: ${report.timeline.totalEvents}
` : ''}

================================
END OF REPORT
  `;
  
  return Buffer.from(content, 'utf-8');
}

// Handler: Create job
export async function createJobHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const body = createJobSchema.parse(request.body);

    const job = await prisma.job.create({
      data: {
        name: body.name,
        description: body.description || null,
        type: body.type,
        sourceType: body.sourceType,
        sourceId: body.sourcePath || null,
        status: 'PENDING',
        progress: 0,
        filesFound: 0,
        filesRecovered: 0,
        tenantId: user.tenantId,
        userId: user.id,
        diskImageId: body.diskImageId || null,
        settings: body.settings || {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'JOB_CREATED',
        resource: 'Job',
        resourceId: job.id,
        metadata: { jobType: body.type, name: body.name },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        timestamp: new Date(),
      },
    });

    return reply.status(201).send({
      code: 'JOB_CREATED',
      data: job,
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'JOB_CREATION_FAILED',
      message: 'Failed to create job',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Handler: List jobs
export async function listJobsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const query = searchJobsSchema.parse(request.query);

    const where: any = {
      tenantId: user.tenantId,
    };

    if (query.query) {
      where.OR = [
        { name: { contains: query.query, mode: 'insensitive' } },
        { description: { contains: query.query, mode: 'insensitive' } },
      ];
    }

    if (query.type && query.type.length > 0) {
      where.type = { in: query.type };
    }

    if (query.status && query.status.length > 0) {
      where.status = { in: query.status };
    }

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          _count: {
            select: { files: true, recoveryJobs: true },
          },
        },
      }),
      prisma.job.count({ where }),
    ]);

    return reply.send({
      code: 'JOBS_RETRIEVED',
      data: {
        jobs,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'JOBS_RETRIEVAL_FAILED',
      message: 'Failed to retrieve jobs',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Handler: Get job by ID
export async function getJobHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const { id } = (request.params as any);

    const job = await prisma.job.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        files: {
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
        recoveryJobs: true,
      },
    });

    if (!job) {
      return reply.status(404).send({
        code: 'JOB_NOT_FOUND',
        message: 'Job not found',
      });
    }

    return reply.send({
      code: 'JOB_RETRIEVED',
      data: job,
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'JOB_RETRIEVAL_FAILED',
      message: 'Failed to retrieve job',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Handler: Update job
export async function updateJobHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const { id } = (request.params as any);
    const body = updateJobSchema.parse(request.body);

    const existingJob = await prisma.job.findFirst({
      where: { id, tenantId: user.tenantId },
    });

    if (!existingJob) {
      return reply.status(404).send({
        code: 'JOB_NOT_FOUND',
        message: 'Job not found',
      });
    }

    const updatedJob = await prisma.job.update({
      where: { id },
      data: {
        ...body,
        updatedAt: new Date(),
      },
    });

    return reply.send({
      code: 'JOB_UPDATED',
      data: updatedJob,
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'JOB_UPDATE_FAILED',
      message: 'Failed to update job',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Handler: Update job status
export async function updateJobStatusHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const { id } = (request.params as any);
    const body = updateJobStatusSchema.parse(request.body);

    const existingJob = await prisma.job.findFirst({
      where: { id, tenantId: user.tenantId },
    });

    if (!existingJob) {
      return reply.status(404).send({
        code: 'JOB_NOT_FOUND',
        message: 'Job not found',
      });
    }

    const updateData: any = {
      status: body.status,
      updatedAt: new Date(),
    };

    if (body.progress !== undefined) updateData.progress = body.progress;
    if (body.filesFound !== undefined) updateData.filesFound = body.filesFound;
    if (body.filesRecovered !== undefined) updateData.filesRecovered = body.filesRecovered;
    if (body.error !== undefined) updateData.error = body.error;
    if (body.status === 'SCANNING' && !existingJob.startedAt) {
      updateData.startedAt = new Date();
    }
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(body.status) && !existingJob.completedAt) {
      updateData.completedAt = new Date();
    }

    const updatedJob = await prisma.job.update({
      where: { id },
      data: updateData,
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'JOB_STATUS_UPDATED',
        resource: 'Job',
        resourceId: id,
        metadata: { status: body.status, progress: body.progress },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        timestamp: new Date(),
      },
    });

    return reply.send({
      code: 'JOB_STATUS_UPDATED',
      data: updatedJob,
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'JOB_STATUS_UPDATE_FAILED',
      message: 'Failed to update job status',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Handler: Cancel job
export async function cancelJobHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const { id } = (request.params as any);

    const existingJob = await prisma.job.findFirst({
      where: { id, tenantId: user.tenantId },
    });

    if (!existingJob) {
      return reply.status(404).send({
        code: 'JOB_NOT_FOUND',
        message: 'Job not found',
      });
    }

    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(existingJob.status)) {
      return reply.status(400).send({
        code: 'JOB_NOT_CANCELLABLE',
        message: 'Job cannot be cancelled in current status',
      });
    }

    const updatedJob = await prisma.job.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        completedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'JOB_CANCELLED',
        resource: 'Job',
        resourceId: id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        timestamp: new Date(),
      },
    });

    return reply.send({
      code: 'JOB_CANCELLED',
      data: updatedJob,
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'JOB_CANCELLATION_FAILED',
      message: 'Failed to cancel job',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Handler: Generate report
export async function generateReportHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const body = generateReportSchema.parse(request.body);

    // Verify access
    if (body.caseId) {
      const caseData = await prisma.forensicCase.findFirst({
        where: { id: body.caseId, tenantId: user.tenantId },
      });
      if (!caseData) {
        return reply.status(404).send({
          code: 'CASE_NOT_FOUND',
          message: 'Case not found',
        });
      }
    }

    if (body.jobId) {
      const job = await prisma.job.findFirst({
        where: { id: body.jobId, tenantId: user.tenantId },
      });
      if (!job) {
        return reply.status(404).send({
          code: 'JOB_NOT_FOUND',
          message: 'Job not found',
        });
      }
    }

    const report = await generateReportData({
      caseId: body.caseId,
      jobId: body.jobId,
      reportType: body.reportType,
      includeMetadata: body.includeMetadata,
      includeTimeline: body.includeTimeline,
      includeEvidence: body.includeEvidence,
    });

    // Format output
    if (body.format === 'PDF') {
      const pdfBuffer = formatReportAsPDF(report);
      
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="report-${Date.now()}.pdf"`);
      
      return reply.send(pdfBuffer);
    }

    return reply.send({
      code: 'REPORT_GENERATED',
      data: report,
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'REPORT_GENERATION_FAILED',
      message: 'Failed to generate report',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Handler: Get job statistics
export async function getJobStatsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;

    const [totalJobs, byStatus, byType, recentJobs] = await Promise.all([
      prisma.job.count({
        where: { tenantId: user.tenantId },
      }),
      prisma.job.groupBy({
        by: ['status'],
        where: { tenantId: user.tenantId },
        _count: true,
      }),
      prisma.job.groupBy({
        by: ['type'],
        where: { tenantId: user.tenantId },
        _count: true,
      }),
      prisma.job.findMany({
        where: { tenantId: user.tenantId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          name: true,
          type: true,
          status: true,
          progress: true,
          createdAt: true,
        },
      }),
    ]);

    return reply.send({
      code: 'STATS_RETRIEVED',
      data: {
        totalJobs,
        byStatus: byStatus.reduce((acc, item) => {
          acc[item.status] = item._count;
          return acc;
        }, {} as Record<string, number>),
        byType: byType.reduce((acc, item) => {
          acc[item.type] = item._count;
          return acc;
        }, {} as Record<string, number>),
        recentJobs,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'STATS_RETRIEVAL_FAILED',
      message: 'Failed to retrieve job statistics',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Register routes
export async function jobEnhancementRoutes(fastify: FastifyInstance) {
  fastify.post('/', createJobHandler);
  fastify.get('/', listJobsHandler);
  fastify.get('/stats', getJobStatsHandler);
  fastify.get('/:id', getJobHandler);
  fastify.put('/:id', updateJobHandler);
  fastify.put('/:id/status', updateJobStatusHandler);
  fastify.post('/:id/cancel', cancelJobHandler);
  fastify.post('/report', generateReportHandler);
}
