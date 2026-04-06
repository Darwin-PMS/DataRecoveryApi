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
const DISK_IMAGES_DIR = process.env.DISK_IMAGES_DIR || path.join(process.cwd(), 'disk-images');
const MAX_IMAGE_SIZE = parseInt(process.env.MAX_IMAGE_SIZE || '10737418240'); // 10GB default for disk images

// Schema validators
const uploadDiskImageSchema = z.object({
  name: z.string().min(1, 'Image name is required').max(255),
  description: z.string().max(2000).optional(),
  fileSystem: z.enum(['NTFS', 'FAT32', 'EXFAT', 'EXT2', 'EXT3', 'EXT4', 'XFS', 'BTRFS', 'HFS_PLUS', 'APFS', 'UNKNOWN']).optional(),
});

const searchDiskImagesSchema = z.object({
  query: z.string().optional(),
  fileSystem: z.array(z.string()).optional(),
  status: z.array(z.string()).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20),
});

// Helper: Calculate file hash
async function calculateFileHash(filePath: string): Promise<string> {
  const sha256Hash = createHash('sha256');

  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', (data) => {
      sha256Hash.update(data);
    });
    
    stream.on('end', () => {
      resolve(sha256Hash.digest('hex'));
    });
    
    stream.on('error', reject);
  });
}

// Helper: Generate unique filename
function generateUniqueFilename(originalName: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const ext = path.extname(originalName);
  return `${timestamp}-${random}${ext}`;
}

// Helper: Format file size
function formatFileSize(bytes: number): string {
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

// Handler: Upload disk image
export async function uploadDiskImageHandler(
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
    const body = uploadDiskImageSchema.parse({
      name: fields.name || fileData.filename,
      description: fields.description,
      fileSystem: fields.fileSystem || 'UNKNOWN',
    });
    
    // Create upload directory
    if (!existsSync(DISK_IMAGES_DIR)) {
      mkdirSync(DISK_IMAGES_DIR, { recursive: true });
    }
    
    // Generate unique filename
    const uniqueFilename = generateUniqueFilename(fileData.filename);
    const filePath = path.join(DISK_IMAGES_DIR, uniqueFilename);
    
    // Save file
    const writeStream = createWriteStream(filePath);
    await pipelineAsync(fileData.file, writeStream);
    
    // Get file stats
    const stats = statSync(filePath);
    
    // Validate file size
    if (stats.size > MAX_IMAGE_SIZE) {
      unlinkSync(filePath);
      return reply.status(400).send({
        code: 'FILE_TOO_LARGE',
        message: `File size exceeds maximum allowed size (${formatFileSize(MAX_IMAGE_SIZE)})`
      });
    }
    
    // Calculate SHA-256 hash
    const hash = await calculateFileHash(filePath);
    
    // Create disk image record
    const diskImage = await prisma.diskImage.create({
      data: {
        tenantId: user.tenantId,
        name: body.name,
        originalName: fileData.filename,
        size: BigInt(stats.size),
        hash: hash,
        fileSystem: body.fileSystem as any,
        status: 'READY',
        url: filePath,
        uploadedAt: new Date(),
        processedAt: new Date(),
      },
    });
    
    // Update tenant storage
    await prisma.tenant.update({
      where: { id: user.tenantId },
      data: {
        storageUsed: {
          increment: BigInt(stats.size),
        },
      },
    });
    
    // Audit log
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'DISK_IMAGE_UPLOADED',
        resource: 'DiskImage',
        resourceId: diskImage.id,
        metadata: {
          name: body.name,
          originalName: fileData.filename,
          size: stats.size,
          fileSystem: body.fileSystem,
        },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        timestamp: new Date(),
      },
    });
    
    return reply.status(201).send({
      code: 'DISK_IMAGE_UPLOADED',
      data: {
        ...diskImage,
        size: Number(diskImage.size),
        sizeFormatted: formatFileSize(stats.size),
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
      message: 'Failed to upload disk image',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Handler: List disk images
export async function listDiskImagesHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const query = searchDiskImagesSchema.parse(request.query);
    
    const where: any = {
      tenantId: user.tenantId,
    };
    
    if (query.query) {
      where.OR = [
        { name: { contains: query.query, mode: 'insensitive' } },
        { originalName: { contains: query.query, mode: 'insensitive' } },
      ];
    }
    
    if (query.fileSystem && query.fileSystem.length > 0) {
      where.fileSystem = { in: query.fileSystem };
    }
    
    if (query.status && query.status.length > 0) {
      where.status = { in: query.status };
    }
    
    if (query.dateFrom || query.dateTo) {
      where.uploadedAt = {};
      if (query.dateFrom) where.uploadedAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.uploadedAt.lte = new Date(query.dateTo);
    }
    
    const [diskImages, total] = await Promise.all([
      prisma.diskImage.findMany({
        where,
        orderBy: { uploadedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.diskImage.count({ where }),
    ]);
    
    return reply.send({
      code: 'DISK_IMAGES_RETRIEVED',
      data: {
        diskImages: diskImages.map(img => ({
          ...img,
          size: Number(img.size),
          sizeFormatted: formatFileSize(Number(img.size)),
        })),
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
      code: 'RETRIEVAL_FAILED',
      message: 'Failed to retrieve disk images',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Handler: Get disk image details
export async function getDiskImageHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const { id } = (request.params as any);
    
    const diskImage = await prisma.diskImage.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    
    if (!diskImage) {
      return reply.status(404).send({
        code: 'DISK_IMAGE_NOT_FOUND',
        message: 'Disk image not found'
      });
    }
    
    // Get file info if exists
    let fileInfo: any = null;
    if (diskImage.url && existsSync(diskImage.url)) {
      const stats = statSync(diskImage.url);
      fileInfo = {
        exists: true,
        size: stats.size,
        sizeFormatted: formatFileSize(stats.size),
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
      };
    }
    
    return reply.send({
      code: 'DISK_IMAGE_RETRIEVED',
      data: {
        ...diskImage,
        size: Number(diskImage.size),
        sizeFormatted: formatFileSize(Number(diskImage.size)),
        fileInfo,
      }
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'RETRIEVAL_FAILED',
      message: 'Failed to retrieve disk image',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Handler: Delete disk image
export async function deleteDiskImageHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const { id } = (request.params as any);
    
    const diskImage = await prisma.diskImage.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    
    if (!diskImage) {
      return reply.status(404).send({
        code: 'DISK_IMAGE_NOT_FOUND',
        message: 'Disk image not found'
      });
    }
    
    // Delete physical file
    if (diskImage.url && existsSync(diskImage.url)) {
      unlinkSync(diskImage.url);
    }
    
    // Update tenant storage
    await prisma.tenant.update({
      where: { id: user.tenantId },
      data: {
        storageUsed: {
          decrement: BigInt(diskImage.size),
        },
      },
    });
    
    // Delete database record
    await prisma.diskImage.delete({
      where: { id },
    });
    
    // Audit log
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'DISK_IMAGE_DELETED',
        resource: 'DiskImage',
        resourceId: id,
        metadata: {
          name: diskImage.name,
          size: Number(diskImage.size),
        },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        timestamp: new Date(),
      },
    });
    
    return reply.send({
      code: 'DISK_IMAGE_DELETED',
      message: 'Disk image deleted successfully'
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'DELETION_FAILED',
      message: 'Failed to delete disk image',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Handler: Verify disk image integrity
export async function verifyDiskImageHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const user = (request as any).user;
    const { id } = (request.params as any);
    
    const diskImage = await prisma.diskImage.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    
    if (!diskImage) {
      return reply.status(404).send({
        code: 'DISK_IMAGE_NOT_FOUND',
        message: 'Disk image not found'
      });
    }
    
    if (!diskImage.url || !existsSync(diskImage.url)) {
      return reply.status(404).send({
        code: 'FILE_NOT_FOUND',
        message: 'Disk image file not found'
      });
    }
    
    // Calculate current hash
    const currentHash = await calculateFileHash(diskImage.url);
    
    // Compare with stored hash
    const isIntact = diskImage.hash === currentHash;
    
    return reply.send({
      code: 'VERIFICATION_COMPLETE',
      data: {
        diskImageId: id,
        name: diskImage.name,
        verified: isIntact,
        originalHash: diskImage.hash,
        currentHash: currentHash,
        verifiedAt: new Date(),
        verifiedBy: user.email,
      }
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'VERIFICATION_FAILED',
      message: 'Failed to verify disk image',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Register routes
export async function diskImageRoutes(fastify: FastifyInstance) {
  fastify.post('/upload', uploadDiskImageHandler);
  fastify.get('/', listDiskImagesHandler);
  fastify.get('/:id', getDiskImageHandler);
  fastify.delete('/:id', deleteDiskImageHandler);
  fastify.post('/:id/verify', verifyDiskImageHandler);
}
