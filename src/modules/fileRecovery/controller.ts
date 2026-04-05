import { FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();

function serializeBigInt(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(item => serializeBigInt(item));
  if (typeof obj === 'object') {
    const result: any = {};
    for (const key of Object.keys(obj)) {
      result[key] = serializeBigInt(obj[key]);
    }
    return result;
  }
  return obj;
}

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
const VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.webm'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a'];
const DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf'];
const ARCHIVE_EXTENSIONS = ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'];

const previewSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  type: z.string().optional(),
  recoverable: z.enum(['true', 'false']).optional(),
  search: z.string().optional(),
  sortBy: z.enum(['name', 'size', 'createdAt', 'modifiedAt', 'recoveryProbability']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

const recoverSchema = z.object({
  fileIds: z.array(z.string()).min(1, "At least one file must be selected"),
  destination: z.object({
    type: z.enum(['local', 's3', 'ftp', 'network']),
    path: z.string().min(1),
    config: z.record(z.string()).optional(),
  }),
});

const FILE_TYPE_CATEGORIES = {
  images: IMAGE_EXTENSIONS,
  videos: VIDEO_EXTENSIONS,
  audio: AUDIO_EXTENSIONS,
  documents: DOCUMENT_EXTENSIONS,
  archives: ARCHIVE_EXTENSIONS,
};

function getFileCategory(extension: string): string {
  const ext = extension.toLowerCase();
  for (const [category, extensions] of Object.entries(FILE_TYPE_CATEGORIES)) {
    if (extensions.includes(ext)) {
      return category;
    }
  }
  return 'other';
}

function getMimeType(extension: string): string {
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain',
    '.zip': 'application/zip',
  };
  return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
}

export async function listFilesHandler(
  request: FastifyRequest<{ Params: { jobId: string } }>,
  reply: FastifyReply,
) {
  try {
    const { jobId } = request.params;
    const query = previewSchema.parse(request.query);
    const { page, limit, type, recoverable, search, sortBy, sortOrder } = query;
    const skip = (page - 1) * limit;

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { tenantId: true },
    });

    if (!job) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        message: 'Job not found',
      });
    }

    if (request.tenantId && job.tenantId !== request.tenantId) {
      return reply.status(403).send({
        code: 'FORBIDDEN',
        message: 'Access denied to this job',
      });
    }

    const where: any = { jobId };

    if (recoverable === 'true') {
      where.recoverable = true;
    } else if (recoverable === 'false') {
      where.recoverable = false;
    }

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    if (type && type !== 'all') {
      if (type === 'images' || type === 'videos' || type === 'audio' || type === 'documents' || type === 'archives') {
        const extensions = FILE_TYPE_CATEGORIES[type as keyof typeof FILE_TYPE_CATEGORIES];
        where.extension = { in: extensions };
      } else {
        where.extension = type;
      }
    }

    const orderBy: any = {};
    orderBy[sortBy] = sortOrder;

    const [files, total] = await Promise.all([
      prisma.recoveredFile.findMany({
        where,
        skip,
        take: limit,
        orderBy,
      }),
      prisma.recoveredFile.count({ where }),
    ]);

    const filesWithCategories = files.map(file => ({
      ...file,
      category: getFileCategory(file.extension),
      mimeType: getMimeType(file.extension),
    }));

    return reply.send({
      data: serializeBigInt(filesWithCategories),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      stats: {
        totalFiles: total,
        recoverable: await prisma.recoveredFile.count({ where: { jobId, recoverable: true } }),
        byCategory: await getCategoryStats(jobId),
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to fetch files',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

async function getCategoryStats(jobId: string): Promise<Record<string, number>> {
  const files = await prisma.recoveredFile.findMany({
    where: { jobId },
    select: { extension: true },
  });

  const stats: Record<string, number> = {
    images: 0,
    videos: 0,
    audio: 0,
    documents: 0,
    archives: 0,
    other: 0,
  };

  for (const file of files) {
    const category = getFileCategory(file.extension);
    stats[category] = (stats[category] || 0) + 1;
  }

  return stats;
}

export async function getFilePreviewHandler(
  request: FastifyRequest<{ Params: { jobId: string; fileId: string } }>,
  reply: FastifyReply,
) {
  try {
    const { jobId, fileId } = request.params;

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { tenantId: true },
    });

    if (!job) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        message: 'Job not found',
      });
    }

    const file = await prisma.recoveredFile.findFirst({
      where: { id: fileId, jobId },
    });

    if (!file) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        message: 'File not found',
      });
    }

    const extension = file.extension.toLowerCase();
    const mimeType = getMimeType(extension);
    const category = getFileCategory(extension);

    const isPreviewable = [
      ...IMAGE_EXTENSIONS,
      '.pdf',
      '.txt',
      '.json',
      '.xml',
      '.html',
      '.css',
      '.js',
    ].includes(extension);

    return reply.send({
      data: {
        id: file.id,
        name: file.name,
        originalPath: file.originalPath,
        size: file.size,
        type: file.type,
        extension: file.extension,
        mimeType,
        category,
        hash: file.hash,
        recoverable: file.recoverable,
        recoveryProbability: file.recoveryProbability,
        isFragmented: file.isFragmented,
        createdAt: file.createdAt,
        modifiedAt: file.modifiedAt,
        deletedAt: file.deletedAt,
        previewAvailable: isPreviewable,
        metadata: file.metadata || {},
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to fetch file preview',
    });
  }
}

export async function recoverFilesHandler(
  request: FastifyRequest<{ Params: { jobId: string } }>,
  reply: FastifyReply,
) {
  try {
    const { jobId } = request.params;
    const body = recoverSchema.parse(request.body);
    const { fileIds, destination } = body;

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { tenantId: true, status: true },
    });

    if (!job) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        message: 'Job not found',
      });
    }

    if (job.status !== 'COMPLETED') {
      return reply.status(400).send({
        code: 'JOB_NOT_COMPLETED',
        message: 'Recovery can only be performed on completed jobs',
      });
    }

    const files = await prisma.recoveredFile.findMany({
      where: { id: { in: fileIds }, jobId },
    });

    const recoverableFiles = files.filter(f => f.recoverable);
    const nonRecoverableFiles = files.filter(f => !f.recoverable);

    const recovery = await prisma.recoveryJob.create({
      data: {
        sourceJobId: jobId,
        userId: request.user?.id || 'unknown',
        status: 'PENDING',
        destination: destination as any,
        totalSize: recoverableFiles.reduce((acc, f) => acc + Number(f.size), 0),
        tenantId: request.tenantId || '',
      },
    });

    for (const file of recoverableFiles) {
      await prisma.recoveredFile.update({
        where: { id: file.id },
        data: { currentPath: destination.path },
      });
    }

    return reply.status(201).send({
      data: {
        id: recovery.id,
        status: recovery.status,
        filesRequested: fileIds.length,
        filesRecoverable: recoverableFiles.length,
        filesNotRecoverable: nonRecoverableFiles.length,
        totalSize: recovery.totalSize,
        destination: destination,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to start recovery',
    });
  }
}

export async function getRecoveryStatusHandler(
  request: FastifyRequest<{ Params: { recoveryId: string } }>,
  reply: FastifyReply,
) {
  try {
    const { recoveryId } = request.params;

    const recovery = await prisma.recoveryJob.findUnique({
      where: { id: recoveryId },
    });

    if (!recovery) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        message: 'Recovery job not found',
      });
    }

    return reply.send({
      data: {
        id: recovery.id,
        sourceJobId: recovery.sourceJobId,
        status: recovery.status,
        totalSize: recovery.totalSize,
        destination: recovery.destination,
        createdAt: recovery.createdAt,
        completedAt: recovery.completedAt,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to fetch recovery status',
    });
  }
}
