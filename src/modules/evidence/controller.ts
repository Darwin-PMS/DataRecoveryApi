import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream';
import { promisify } from 'util';
import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'fs';

const pipelineAsync = promisify(pipeline);
const prisma = new PrismaClient();

// Configuration
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '1073741824'); // 1GB default

// Schema validators
const uploadEvidenceSchema = z.object({
  caseId: z.string().min(1, 'Case ID is required'),
  description: z.string().max(2000).optional(),
  evidenceType: z.enum(['FILE', 'DISK_IMAGE', 'MEMORY_DUMP', 'NETWORK_CAPTURE', 'DOCUMENT', 'PHOTO', 'AUDIO', 'VIDEO', 'OTHER']).default('FILE'),
  collectedBy: z.string().min(1, 'Collected by is required'),
  location: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
});

const linkEvidenceSchema = z.object({
  caseId: z.string().min(1, 'Case ID is required'),
  relationship: z.enum(['PRIMARY', 'SECONDARY', 'SUPPORTING', 'REFERENCE']).default('PRIMARY'),
  notes: z.string().optional(),
});

// Helper: Calculate file hash
async function calculateFileHash(filePath: string): Promise<{
  md5: string;
  sha256: string;
}> {
  const md5Hash = createHash('md5');
  const sha256Hash = createHash('sha256');

  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    
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

// Helper: Generate unique filename
function generateUniqueFilename(originalName: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const ext = path.extname(originalName);
  const baseName = path.basename(originalName, ext);
  return `${timestamp}-${random}-${baseName}${ext}`;
}

// Helper: Format file size
function formatFileSize(bytes: number): string {
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

// Handler: Upload evidence file
export async function uploadEvidenceHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    
    // Check if request is multipart
    if (!request.isMultipart()) {
      return reply.status(400).send({
        code: 'INVALID_REQUEST',
        message: 'Request must be multipart/form-data'
      });
    }
    
    // Parse multipart data
    const parts = request.parts();
    let fileData: any = null;
    let fields: any = {};
    
    for await (const part of parts) {
      if (part.type === 'file') {
        fileData = part;
      } else {
        fields[part.fieldname] = part.value;
      }
    }
    
    if (!fileData) {
      return reply.status(400).send({
        code: 'FILE_REQUIRED',
        message: 'No file uploaded'
      });
    }
    
    // Validate fields
    const body = uploadEvidenceSchema.parse({
      caseId: fields.caseId,
      description: fields.description,
      evidenceType: fields.evidenceType || 'FILE',
      collectedBy: fields.collectedBy || user.email,
      location: fields.location,
      notes: fields.notes,
    });
    
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
    
    // Create upload directory
    const caseDir = path.join(UPLOAD_DIR, body.caseId);
    if (!existsSync(caseDir)) {
      mkdirSync(caseDir, { recursive: true });
    }
    
    // Generate unique filename
    const uniqueFilename = generateUniqueFilename(fileData.filename);
    const filePath = path.join(caseDir, uniqueFilename);
    
    // Save file
    const writeStream = createWriteStream(filePath);
    await pipelineAsync(fileData.file, writeStream);
    
    // Get file stats
    const stats = statSync(filePath);
    
    // Validate file size
    if (stats.size > MAX_FILE_SIZE) {
      unlinkSync(filePath);
      return reply.status(400).send({
        code: 'FILE_TOO_LARGE',
        message: `File size exceeds maximum allowed size (${formatFileSize(MAX_FILE_SIZE)})`
      });
    }
    
    // Calculate file hashes
    const hashes = await calculateFileHash(filePath);
    
    // Create evidence record
    const evidence = await prisma.evidence.create({
      data: {
        caseId: body.caseId,
        filename: fileData.filename,
        description: body.description || null,
        evidenceType: body.evidenceType,
        filePath: filePath,
        fileSize: BigInt(stats.size),
        hashMD5: hashes.md5,
        hashSHA256: hashes.sha256,
        collectedBy: body.collectedBy,
        collectedAt: new Date(),
        location: body.location || null,
        notes: body.notes || null,
        status: 'COLLECTED',
        chainOfCustody: [{
          action: 'EVIDENCE_UPLOADED',
          performedBy: user.email,
          timestamp: new Date().toISOString(),
          notes: `File uploaded: ${fileData.filename} (${formatFileSize(stats.size)})`,
        }],
        metadata: {
          mimeType: fileData.mimetype,
          originalFilename: fileData.filename,
          uploadTimestamp: new Date().toISOString(),
          fileSize: stats.size,
          fileSizeFormatted: formatFileSize(stats.size),
        },
      },
    });
    
    // Audit log
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'EVIDENCE_UPLOADED',
        resource: 'Evidence',
        resourceId: evidence.id,
        metadata: {
          caseId: body.caseId,
          filename: fileData.filename,
          fileSize: stats.size,
          evidenceType: body.evidenceType,
        },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        timestamp: new Date(),
      },
    });
    
    return reply.status(201).send({
      code: 'EVIDENCE_UPLOADED',
      data: {
        ...evidence,
        fileSize: Number(evidence.fileSize),
        chainOfCustody: evidence.chainOfCustody,
        metadata: evidence.metadata,
      }
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
      code: 'UPLOAD_FAILED',
      message: 'Failed to upload evidence',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Handler: Get evidence details with file info
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
    
    // Get file info if exists
    let fileInfo: any = null;
    if (evidence.filePath && existsSync(evidence.filePath)) {
      const stats = statSync(evidence.filePath);
      fileInfo = {
        exists: true,
        size: stats.size,
        sizeFormatted: formatFileSize(stats.size),
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
      };
    }
    
    return reply.send({
      code: 'EVIDENCE_RETRIEVED',
      data: {
        ...evidence,
        fileSize: Number(evidence.fileSize),
        chainOfCustody: evidence.chainOfCustody,
        metadata: evidence.metadata,
        fileInfo,
      }
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'EVIDENCE_RETRIEVAL_FAILED',
      message: 'Failed to retrieve evidence',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Handler: Verify evidence integrity
export async function verifyEvidenceHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const { id } = (request.params as any);
    
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
    
    if (!evidence.filePath || !existsSync(evidence.filePath)) {
      return reply.status(404).send({
        code: 'FILE_NOT_FOUND',
        message: 'Evidence file not found'
      });
    }
    
    // Calculate current hashes
    const currentHashes = await calculateFileHash(evidence.filePath);
    
    // Compare with stored hashes
    const md5Match = evidence.hashMD5 === currentHashes.md5;
    const sha256Match = evidence.hashSHA256 === currentHashes.sha256;
    
    const isIntact = md5Match && sha256Match;
    
    // Update chain of custody
    const chainOfCustody = evidence.chainOfCustody as any[] || [];
    chainOfCustody.push({
      action: 'INTEGRITY_VERIFIED',
      performedBy: user.email,
      timestamp: new Date().toISOString(),
      notes: `Hash verification: ${isIntact ? 'PASSED' : 'FAILED'}`,
    });
    
    await prisma.evidence.update({
      where: { id },
      data: { chainOfCustody },
    });
    
    return reply.send({
      code: 'VERIFICATION_COMPLETE',
      data: {
        evidenceId: id,
        filename: evidence.filename,
        verified: isIntact,
        md5Match,
        sha256Match,
        originalHashes: {
          md5: evidence.hashMD5,
          sha256: evidence.hashSHA256,
        },
        currentHashes: currentHashes,
        verifiedAt: new Date(),
        verifiedBy: user.email,
      }
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'VERIFICATION_FAILED',
      message: 'Failed to verify evidence',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Handler: Delete evidence file
export async function deleteEvidenceHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const { id } = (request.params as any);
    
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
    
    // Delete physical file
    if (evidence.filePath && existsSync(evidence.filePath)) {
      unlinkSync(evidence.filePath);
    }
    
    // Delete database record
    await prisma.evidence.delete({
      where: { id },
    });
    
    // Audit log
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'EVIDENCE_DELETED',
        resource: 'Evidence',
        resourceId: id,
        metadata: {
          caseId: evidence.caseId,
          filename: evidence.filename,
        },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        timestamp: new Date(),
      },
    });
    
    return reply.send({
      code: 'EVIDENCE_DELETED',
      message: 'Evidence deleted successfully'
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'DELETION_FAILED',
      message: 'Failed to delete evidence',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Handler: Link evidence to case
export async function linkEvidenceHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const { id } = (request.params as any);
    const body = linkEvidenceSchema.parse(request.body);
    
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
    
    // Verify case exists
    const targetCase = await prisma.forensicCase.findFirst({
      where: { id: body.caseId, tenantId: user.tenantId },
    });
    
    if (!targetCase) {
      return reply.status(404).send({
        code: 'CASE_NOT_FOUND',
        message: 'Target case not found'
      });
    }
    
    // Update chain of custody
    const chainOfCustody = evidence.chainOfCustody as any[] || [];
    chainOfCustody.push({
      action: 'EVIDENCE_LINKED',
      performedBy: user.email,
      timestamp: new Date().toISOString(),
      notes: `Linked to case ${targetCase.caseNumber}: ${targetCase.name}`,
    });
    
    await prisma.evidence.update({
      where: { id },
      data: { chainOfCustody },
    });
    
    // Audit log
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'EVIDENCE_LINKED',
        resource: 'Evidence',
        resourceId: id,
        metadata: {
          targetCaseId: body.caseId,
          targetCaseNumber: targetCase.caseNumber,
          relationship: body.relationship,
        },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        timestamp: new Date(),
      },
    });
    
    return reply.send({
      code: 'EVIDENCE_LINKED',
      message: 'Evidence linked to case successfully',
      data: {
        evidenceId: id,
        caseId: body.caseId,
        caseNumber: targetCase.caseNumber,
        relationship: body.relationship,
      }
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
      code: 'LINK_FAILED',
      message: 'Failed to link evidence',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Handler: Get chain of custody
export async function getChainOfCustodyHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const { id } = (request.params as any);
    
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
    
    return reply.send({
      code: 'CHAIN_OF_CUSTODY_RETRIEVED',
      data: {
        evidenceId: id,
        filename: evidence.filename,
        chainOfCustody: evidence.chainOfCustody,
        totalEntries: Array.isArray(evidence.chainOfCustody) ? evidence.chainOfCustody.length : 0,
      }
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'CHAIN_RETRIEVAL_FAILED',
      message: 'Failed to retrieve chain of custody',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Register routes
export async function evidenceRoutes(fastify: FastifyInstance) {
  fastify.post('/upload', uploadEvidenceHandler);
  fastify.get('/:id', getEvidenceHandler);
  fastify.post('/:id/verify', verifyEvidenceHandler);
  fastify.delete('/:id', deleteEvidenceHandler);
  fastify.post('/:id/link', linkEvidenceHandler);
  fastify.get('/:id/chain', getChainOfCustodyHandler);
}
