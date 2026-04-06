import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { createWriteStream, createReadStream, existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import { pipeline } from 'stream';
import { promisify } from 'util';

const pipelineAsync = promisify(pipeline);
const prisma = new PrismaClient();

// Schema validators
const createCaseSchema = z.object({
  name: z.string().min(1, 'Case name is required').max(255),
  description: z.string().max(5000).optional(),
  caseNumber: z.string().max(100).optional(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CLOSED']).default('OPEN'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  investigatorId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.any()).optional(),
});

const updateCaseSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CLOSED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.any()).optional(),
});

const addEvidenceSchema = z.object({
  caseId: z.string().min(1, 'Case ID is required'),
  fileName: z.string().min(1, 'File name is required'),
  description: z.string().max(2000).optional(),
  evidenceType: z.enum(['FILE', 'DISK_IMAGE', 'MEMORY_DUMP', 'NETWORK_CAPTURE', 'DOCUMENT', 'PHOTO', 'AUDIO', 'VIDEO', 'OTHER']).default('FILE'),
  collectedBy: z.string().min(1, 'Collected by is required'),
  collectionDate: z.string().optional(),
  location: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  chainOfCustody: z.array(z.object({
    action: z.string(),
    performedBy: z.string(),
    timestamp: z.string(),
    notes: z.string().optional(),
  })).optional(),
});

const linkEvidenceToCaseSchema = z.object({
  caseId: z.string().min(1, 'Case ID is required'),
  evidenceId: z.string().min(1, 'Evidence ID is required'),
  relationship: z.enum(['PRIMARY', 'SECONDARY', 'SUPPORTING', 'REFERENCE']).default('PRIMARY'),
  notes: z.string().optional(),
});

const searchCasesSchema = z.object({
  query: z.string().optional(),
  status: z.array(z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CLOSED'])).optional(),
  priority: z.array(z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])).optional(),
  investigatorId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  tags: z.array(z.string()).optional(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20),
});

// Helper: Calculate file hash
async function calculateFileHash(filePath: string): Promise<{
  md5: string;
  sha256: string;
}> {
  const md5Hash = createHash('md5');
  const sha256Hash = createHash('sha256');

  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    
    stream.on('data', (data) => {
      md5Hash.update(data);
      sha256Hash.update(data);
    });
    
    stream.on('end', () => {
      resolve({
        md5: md5Hash.digest('hex'),
        sha256: sha256Hash.digest('hex'),
      });
    });
    
    stream.on('error', reject);
  });
}

// Helper: Generate unique case number
function generateCaseNumber(): string {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
  return `CASE-${year}-${random}`;
}

// Helper: Create audit log entry
async function createAuditLog(data: {
  tenantId: string;
  userId?: string;
  action: string;
  resource: string;
  resourceId: string;
  metadata?: any;
  ipAddress?: string;
  userAgent?: string;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: data.tenantId,
        userId: data.userId || null,
        action: data.action,
        resource: data.resource,
        resourceId: data.resourceId,
        metadata: data.metadata || {},
        ipAddress: data.ipAddress || null,
        userAgent: data.userAgent || null,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    console.error('Failed to create audit log:', error);
  }
}

// Handler: Create case
export async function createCaseHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const body = createCaseSchema.parse(request.body);
    
    const caseNumber = body.caseNumber || generateCaseNumber();
    
    const newCase = await prisma.forensicCase.create({
      data: {
        caseNumber,
        name: body.name,
        description: body.description || null,
        status: body.status,
        priority: body.priority,
        tenantId: user.tenantId,
        investigatorId: body.investigatorId || user.id,
        tags: body.tags || [],
        metadata: body.metadata || {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Audit log
    await createAuditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'CASE_CREATED',
      resource: 'ForensicCase',
      resourceId: newCase.id,
      metadata: { caseNumber, name: body.name },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    
    return reply.status(201).send({
      code: 'CASE_CREATED',
      data: newCase
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'CASE_CREATION_FAILED',
      message: 'Failed to create case',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: Get case by ID
export async function getCaseHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const { id } = (request.params as any);
    
    const caseData = await prisma.forensicCase.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
      },
      include: {
        evidence: {
          orderBy: { collectedAt: 'desc' },
        },
        auditLogs: {
          orderBy: { timestamp: 'desc' },
          take: 50,
        },
      },
    });
    
    if (!caseData) {
      return reply.status(404).send({
        code: 'CASE_NOT_FOUND',
        message: 'Case not found'
      });
    }
    
    return reply.send({
      code: 'CASE_RETRIEVED',
      data: caseData
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'CASE_RETRIEVAL_FAILED',
      message: 'Failed to retrieve case',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: List cases
export async function listCasesHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const query = searchCasesSchema.parse(request.query);
    
    const where: any = {
      tenantId: user.tenantId,
    };
    
    if (query.query) {
      where.OR = [
        { name: { contains: query.query, mode: 'insensitive' } },
        { caseNumber: { contains: query.query, mode: 'insensitive' } },
        { description: { contains: query.query, mode: 'insensitive' } },
      ];
    }
    
    if (query.status && query.status.length > 0) {
      where.status = { in: query.status };
    }
    
    if (query.priority && query.priority.length > 0) {
      where.priority = { in: query.priority };
    }
    
    if (query.investigatorId) {
      where.investigatorId = query.investigatorId;
    }
    
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }
    
    if (query.tags && query.tags.length > 0) {
      where.tags = { hasSome: query.tags };
    }
    
    const [cases, total] = await Promise.all([
      prisma.forensicCase.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          _count: {
            select: { evidence: true },
          },
        },
      }),
      prisma.forensicCase.count({ where }),
    ]);
    
    return reply.send({
      code: 'CASES_RETRIEVED',
      data: {
        cases,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
      }
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'CASES_RETRIEVAL_FAILED',
      message: 'Failed to retrieve cases',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: Update case
export async function updateCaseHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const { id } = (request.params as any);
    const body = updateCaseSchema.parse(request.body);
    
    const existingCase = await prisma.forensicCase.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    
    if (!existingCase) {
      return reply.status(404).send({
        code: 'CASE_NOT_FOUND',
        message: 'Case not found'
      });
    }
    
    const updatedCase = await prisma.forensicCase.update({
      where: { id },
      data: {
        ...body,
        updatedAt: new Date(),
      },
    });
    
    // Audit log
    await createAuditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'CASE_UPDATED',
      resource: 'ForensicCase',
      resourceId: id,
      metadata: { changes: body },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    
    return reply.send({
      code: 'CASE_UPDATED',
      data: updatedCase
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'CASE_UPDATE_FAILED',
      message: 'Failed to update case',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: Delete case
export async function deleteCaseHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const { id } = (request.params as any);
    
    const existingCase = await prisma.forensicCase.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    
    if (!existingCase) {
      return reply.status(404).send({
        code: 'CASE_NOT_FOUND',
        message: 'Case not found'
      });
    }
    
    // Delete evidence first (cascade)
    await prisma.evidence.deleteMany({
      where: { caseId: id },
    });
    
    // Delete case
    await prisma.forensicCase.delete({
      where: { id },
    });
    
    // Audit log
    await createAuditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'CASE_DELETED',
      resource: 'ForensicCase',
      resourceId: id,
      metadata: { caseNumber: existingCase.caseNumber },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    
    return reply.send({
      code: 'CASE_DELETED',
      message: 'Case deleted successfully'
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'CASE_DELETION_FAILED',
      message: 'Failed to delete case',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: Add evidence to case
export async function addEvidenceHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const body = addEvidenceSchema.parse(request.body);
    
    // Verify case exists
    const existingCase = await prisma.forensicCase.findFirst({
      where: { id: body.caseId, tenantId: user.tenantId },
    });
    
    if (!existingCase) {
      return reply.status(404).send({
        code: 'CASE_NOT_FOUND',
        message: 'Case not found'
      });
    }
    
    const evidence = await prisma.evidence.create({
      data: {
        caseId: body.caseId,
        filename: body.fileName,
        description: body.description || null,
        evidenceType: body.evidenceType,
        collectedBy: body.collectedBy,
        collectedAt: body.collectionDate ? new Date(body.collectionDate) : new Date(),
        location: body.location || null,
        notes: body.notes || null,
        status: 'COLLECTED',
        chainOfCustody: body.chainOfCustody || [{
          action: 'EVIDENCE_COLLECTED',
          performedBy: body.collectedBy,
          timestamp: new Date().toISOString(),
          notes: 'Initial collection',
        }],
      },
    });
    
    // Audit log
    await createAuditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'EVIDENCE_ADDED',
      resource: 'Evidence',
      resourceId: evidence.id,
      metadata: { caseId: body.caseId, fileName: body.fileName },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    
    return reply.status(201).send({
      code: 'EVIDENCE_ADDED',
      data: evidence
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'EVIDENCE_ADDITION_FAILED',
      message: 'Failed to add evidence',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: Get evidence by ID
export async function getEvidenceHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const { id } = (request.params as any);
    
    const evidence = await prisma.evidence.findUnique({
      where: { id },
      include: {
        case: true,
      },
    });
    
    if (!evidence) {
      return reply.status(404).send({
        code: 'EVIDENCE_NOT_FOUND',
        message: 'Evidence not found'
      });
    }
    
    // Verify tenant access
    if (evidence.case.tenantId !== user.tenantId) {
      return reply.status(403).send({
        code: 'ACCESS_DENIED',
        message: 'Access denied'
      });
    }
    
    return reply.send({
      code: 'EVIDENCE_RETRIEVED',
      data: evidence
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'EVIDENCE_RETRIEVAL_FAILED',
      message: 'Failed to retrieve evidence',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: Update chain of custody
export async function updateChainOfCustodyHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const { id } = (request.params as any);
    const { action, performedBy, notes } = (request.body as any);
    
    const evidence = await prisma.evidence.findUnique({
      where: { id },
      include: { case: true },
    });
    
    if (!evidence) {
      return reply.status(404).send({
        code: 'EVIDENCE_NOT_FOUND',
        message: 'Evidence not found'
      });
    }
    
    if (evidence.case.tenantId !== user.tenantId) {
      return reply.status(403).send({
        code: 'ACCESS_DENIED',
        message: 'Access denied'
      });
    }
    
    const chainOfCustody = evidence.chainOfCustody as any[] || [];
    
    chainOfCustody.push({
      action,
      performedBy: performedBy || user.email,
      timestamp: new Date().toISOString(),
      notes: notes || '',
    });
    
    const updatedEvidence = await prisma.evidence.update({
      where: { id },
      data: { chainOfCustody },
    });
    
    // Audit log
    await createAuditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'CHAIN_OF_CUSTODY_UPDATED',
      resource: 'Evidence',
      resourceId: id,
      metadata: { action, performedBy },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    
    return reply.send({
      code: 'CHAIN_OF_CUSTODY_UPDATED',
      data: updatedEvidence
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'CHAIN_OF_CUSTODY_UPDATE_FAILED',
      message: 'Failed to update chain of custody',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: Verify evidence hash
export async function verifyEvidenceHashHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const { id } = (request.params as any);
    const { filePath } = (request.body as any);
    
    const evidence = await prisma.evidence.findUnique({
      where: { id },
      include: { case: true },
    });
    
    if (!evidence) {
      return reply.status(404).send({
        code: 'EVIDENCE_NOT_FOUND',
        message: 'Evidence not found'
      });
    }
    
    if (evidence.case.tenantId !== user.tenantId) {
      return reply.status(403).send({
        code: 'ACCESS_DENIED',
        message: 'Access denied'
      });
    }
    
    if (!existsSync(filePath)) {
      return reply.status(400).send({
        code: 'FILE_NOT_FOUND',
        message: 'File not found'
      });
    }
    
    const hashes = await calculateFileHash(filePath);
    
    const isMatch = evidence.hashMD5 === hashes.md5 || evidence.hashSHA256 === hashes.sha256;
    
    return reply.send({
      code: 'HASH_VERIFIED',
      data: {
        verified: isMatch,
        originalHashes: {
          md5: evidence.hashMD5,
          sha256: evidence.hashSHA256,
        },
        currentHashes: hashes,
      }
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'HASH_VERIFICATION_FAILED',
      message: 'Failed to verify hash',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: Get case statistics
export async function getCaseStatsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const { id } = (request.params as any);
    
    const caseData = await prisma.forensicCase.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        evidence: true,
      },
    });
    
    if (!caseData) {
      return reply.status(404).send({
        code: 'CASE_NOT_FOUND',
        message: 'Case not found'
      });
    }
    
    const stats = {
      caseId: id,
      caseNumber: caseData.caseNumber,
      totalEvidence: caseData.evidence.length,
      evidenceByType: {} as Record<string, number>,
      evidenceByStatus: {} as Record<string, number>,
      totalSize: 0,
      dateRange: {
        firstEvidence: caseData.evidence.length > 0 
          ? caseData.evidence.reduce((earliest, e) => 
              new Date(e.collectedAt) < earliest ? new Date(e.collectedAt) : earliest, 
              new Date(caseData.evidence[0].collectedAt))
          : null,
        lastEvidence: caseData.evidence.length > 0
          ? caseData.evidence.reduce((latest, e) => 
              new Date(e.collectedAt) > latest ? new Date(e.collectedAt) : latest, 
              new Date(caseData.evidence[0].collectedAt))
          : null,
      },
    };
    
    // Group by type
    for (const evidence of caseData.evidence) {
      stats.evidenceByType[evidence.evidenceType] = 
        (stats.evidenceByType[evidence.evidenceType] || 0) + 1;
      
      stats.evidenceByStatus[evidence.status] = 
        (stats.evidenceByStatus[evidence.status] || 0) + 1;
      
      if (evidence.fileSize) {
        stats.totalSize += Number(evidence.fileSize);
      }
    }
    
    return reply.send({
      code: 'STATS_RETRIEVED',
      data: stats
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'STATS_RETRIEVAL_FAILED',
      message: 'Failed to retrieve case statistics',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Register routes
export async function caseManagementRoutes(fastify: FastifyInstance) {
  // Case CRUD
  fastify.post('/', createCaseHandler);
  fastify.get('/', listCasesHandler);
  fastify.get('/:id', getCaseHandler);
  fastify.put('/:id', updateCaseHandler);
  fastify.delete('/:id', deleteCaseHandler);
  fastify.get('/:id/stats', getCaseStatsHandler);
  
  // Evidence management
  fastify.post('/evidence', addEvidenceHandler);
  fastify.get('/evidence/:id', getEvidenceHandler);
  fastify.post('/evidence/:id/custody', updateChainOfCustodyHandler);
  fastify.post('/evidence/:id/verify-hash', verifyEvidenceHashHandler);
}
