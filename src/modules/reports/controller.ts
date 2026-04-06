import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const REPORTS_DIR = process.env.REPORTS_DIR || path.join(process.cwd(), 'reports');

// Schema validators
const generateReportSchema = z.object({
  caseId: z.string().optional(),
  jobId: z.string().optional(),
  reportType: z.enum(['CASE_SUMMARY', 'JOB_REPORT', 'EVIDENCE_REPORT', 'FORENSIC_REPORT', 'EXECUTIVE_SUMMARY']).default('CASE_SUMMARY'),
  format: z.enum(['JSON', 'PDF']).default('JSON'),
  includeMetadata: z.boolean().default(true),
  includeTimeline: z.boolean().default(true),
  includeEvidence: z.boolean().default(true),
  includeAuditLogs: z.boolean().default(false),
});

const searchReportsSchema = z.object({
  caseId: z.string().optional(),
  reportType: z.array(z.string()).optional(),
  format: z.array(z.string()).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20),
});

// Helper: Generate report data
async function generateReportData(options: {
  caseId?: string;
  jobId?: string;
  reportType: string;
  includeMetadata: boolean;
  includeTimeline: boolean;
  includeEvidence: boolean;
  includeAuditLogs: boolean;
  tenantId: string;
}): Promise<any> {
  const report: any = {
    reportType: options.reportType,
    generatedAt: new Date(),
    version: '1.0',
    generatedBy: options.tenantId,
  };

  // Case report
  if (options.caseId) {
    const caseData = await prisma.forensicCase.findFirst({
      where: { id: options.caseId, tenantId: options.tenantId },
      include: {
        evidence: options.includeEvidence ? {
          orderBy: { collectedAt: 'desc' },
        } : false,
        auditLogs: options.includeAuditLogs ? {
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
            fileSize: Number(e.fileSize),
            hashMD5: e.hashMD5,
            hashSHA256: e.hashSHA256,
          })),
        };

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
          })),
        };
      }
    }
  }

  // Job report
  if (options.jobId) {
    const job = await prisma.job.findFirst({
      where: { id: options.jobId, tenantId: options.tenantId },
      include: {
        files: options.includeEvidence,
        recoveryJobs: options.includeEvidence,
      },
    });

    if (job) {
      report.job = {
        id: job.id,
        name: job.name,
        type: job.type,
        status: job.status,
        progress: job.progress,
        filesFound: job.filesFound,
        filesRecovered: job.filesRecovered,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        createdAt: job.createdAt,
      };

      if (options.includeEvidence && job.files) {
        report.recoveredFiles = {
          total: job.files.length,
          files: job.files.map(f => ({
            id: f.id,
            name: f.name,
            type: f.type,
            size: Number(f.size),
            recoverable: f.recoverable,
            recoveryProbability: f.recoveryProbability,
          })),
        };
      }
    }
  }

  return report;
}

// Helper: Generate simple PDF-like buffer
function generatePDFBuffer(report: any): Buffer {
  const content = `
================================================================================
                    DATAVAULT PRO - FORENSIC REPORT
================================================================================

Report Type:    ${report.reportType}
Generated:      ${report.generatedAt.toISOString()}
Version:        ${report.version}

${report.case ? `
--------------------------------------------------------------------------------
                         CASE INFORMATION
--------------------------------------------------------------------------------
Case Number:    ${report.case.caseNumber}
Name:           ${report.case.name}
Status:         ${report.case.status}
Priority:       ${report.case.priority}
Created:        ${report.case.createdAt.toISOString()}
Updated:        ${report.case.updatedAt.toISOString()}
` : ''}

${report.evidence ? `
--------------------------------------------------------------------------------
                        EVIDENCE SUMMARY
--------------------------------------------------------------------------------
Total Evidence: ${report.evidence.total}

By Type:
${Object.entries(report.evidence.byType).map(([type, count]) => `  - ${type}: ${count}`).join('\n')}

By Status:
${Object.entries(report.evidence.byStatus).map(([status, count]) => `  - ${status}: ${count}`).join('\n')}
` : ''}

${report.job ? `
--------------------------------------------------------------------------------
                          JOB INFORMATION
--------------------------------------------------------------------------------
Name:           ${report.job.name}
Type:           ${report.job.type}
Status:         ${report.job.status}
Progress:       ${report.job.progress}%
Files Found:    ${report.job.filesFound}
Recovered:      ${report.job.filesRecovered}
Started:        ${report.job.startedAt?.toISOString() || 'N/A'}
Completed:      ${report.job.completedAt?.toISOString() || 'N/A'}
` : ''}

${report.timeline ? `
--------------------------------------------------------------------------------
                           TIMELINE
--------------------------------------------------------------------------------
Total Events:   ${report.timeline.totalEvents}
` : ''}

================================================================================
                           END OF REPORT
================================================================================
  `;
  
  return Buffer.from(content, 'utf-8');
}

// Handler: Generate report
export async function generateReportHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const body = generateReportSchema.parse(request.body);

    // Verify at least one source
    if (!body.caseId && !body.jobId) {
      return reply.status(400).send({
        code: 'INVALID_REQUEST',
        message: 'Either caseId or jobId is required',
      });
    }

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
      includeAuditLogs: body.includeAuditLogs,
      tenantId: user.tenantId,
    });

    // Create reports directory
    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }

    // Save report
    const reportFilename = `report-${Date.now()}-${body.reportType.toLowerCase()}.${body.format.toLowerCase()}`;
    const reportPath = path.join(REPORTS_DIR, reportFilename);

    if (body.format === 'PDF') {
      const pdfBuffer = generatePDFBuffer(report);
      fs.writeFileSync(reportPath, pdfBuffer);
    } else {
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    }

    // Audit log
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'REPORT_GENERATED',
        resource: 'Report',
        resourceId: reportFilename,
        metadata: {
          reportType: body.reportType,
          format: body.format,
          caseId: body.caseId,
          jobId: body.jobId,
        },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        timestamp: new Date(),
      },
    });

    // Return report
    if (body.format === 'PDF') {
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="${reportFilename}"`);
      return reply.send(fs.readFileSync(reportPath));
    }

    return reply.send({
      code: 'REPORT_GENERATED',
      data: report,
      metadata: {
        filename: reportFilename,
        generatedAt: report.generatedAt,
        format: body.format,
      },
    });
  } catch (error) {
    request.log.error(error);
    
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: error.errors,
      });
    }

    return reply.status(500).send({
      code: 'REPORT_GENERATION_FAILED',
      message: 'Failed to generate report',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Handler: List reports
export async function listReportsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const query = searchReportsSchema.parse(request.query);

    // For now, return generated reports from filesystem
    const reports: any[] = [];
    
    if (fs.existsSync(REPORTS_DIR)) {
      const files = fs.readdirSync(REPORTS_DIR);
      
      for (const file of files) {
        const stats = fs.statSync(path.join(REPORTS_DIR, file));
        reports.push({
          filename: file,
          size: stats.size,
          createdAt: stats.birthtime,
          modifiedAt: stats.mtime,
          format: file.endsWith('.pdf') ? 'PDF' : 'JSON',
        });
      }
    }

    // Sort by creation date
    reports.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // Apply filters
    let filtered = reports;
    if (query.reportType && query.reportType.length > 0) {
      filtered = filtered.filter(r => 
        query.reportType?.some(type => r.filename.toLowerCase().includes(type.toLowerCase()))
      );
    }
    if (query.format && query.format.length > 0) {
      filtered = filtered.filter(r => query.format?.includes(r.format));
    }

    return reply.send({
      code: 'REPORTS_RETRIEVED',
      data: {
        reports: filtered.slice(0, query.limit),
        total: filtered.length,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'REPORTS_RETRIEVAL_FAILED',
      message: 'Failed to retrieve reports',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Handler: Get report details
export async function getReportHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const { filename } = (request.params as any);

    const reportPath = path.join(REPORTS_DIR, filename);

    if (!fs.existsSync(reportPath)) {
      return reply.status(404).send({
        code: 'REPORT_NOT_FOUND',
        message: 'Report not found',
      });
    }

    const stats = fs.statSync(reportPath);
    const content = fs.readFileSync(reportPath, 'utf-8');

    let reportData: any;
    if (filename.endsWith('.json')) {
      reportData = JSON.parse(content);
    } else {
      reportData = { filename, size: stats.size };
    }

    return reply.send({
      code: 'REPORT_RETRIEVED',
      data: {
        filename,
        size: stats.size,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
        content: reportData,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'REPORT_RETRIEVAL_FAILED',
      message: 'Failed to retrieve report',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Handler: Download report
export async function downloadReportHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const { filename } = (request.params as any);

    const reportPath = path.join(REPORTS_DIR, filename);

    if (!fs.existsSync(reportPath)) {
      return reply.status(404).send({
        code: 'REPORT_NOT_FOUND',
        message: 'Report not found',
      });
    }

    const stats = fs.statSync(reportPath);

    // Set headers for download
    reply.header('Content-Type', filename.endsWith('.pdf') ? 'application/pdf' : 'application/json');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('Content-Length', stats.size);

    return reply.send(fs.readFileSync(reportPath));
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'REPORT_DOWNLOAD_FAILED',
      message: 'Failed to download report',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Register routes
export async function reportsRoutes(fastify: FastifyInstance) {
  fastify.post('/generate', generateReportHandler);
  fastify.get('/', listReportsHandler);
  fastify.get('/:filename', getReportHandler);
  fastify.get('/:filename/download', downloadReportHandler);
}
