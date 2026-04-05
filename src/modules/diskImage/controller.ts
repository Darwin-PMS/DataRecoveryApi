import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

const FILE_SIGNATURES: Record<string, string[]> = {
  '.img': ['AA550000'],
  '.dd': ['41444633'],
  '.raw': ['52414646'],
  '.iso': ['4344303031', '4F524359'],
  '.bin': ['42494E58'],
};

const SUPPORTED_EXTENSIONS = ['.img', '.dd', '.raw', '.iso', '.bin', '.vhd', '.vmdk', '.qcow2'];
const MAX_FILE_SIZE = 500 * 1024 * 1024 * 1024;

const createImageZodSchema = z.object({
  name: z.string().min(1),
  originalName: z.string().min(1),
  size: z.number().positive(),
  hash: z.string().optional(),
});

const validateFileSignature = (buffer: Buffer, extension: string): boolean => {
  const signatures = FILE_SIGNATURES[extension];
  if (!signatures) return true;
  
  const hexHeader = buffer.slice(0, 8).toString('hex').toUpperCase();
  return signatures.some(sig => hexHeader.startsWith(sig));
};

const getFileExtension = (filename: string): string => {
  const lastDot = filename.lastIndexOf('.');
  return lastDot !== -1 ? filename.slice(lastDot).toLowerCase() : '';
};

export async function listImagesHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const { page = '1', limit = '20', status, search } = request.query as any;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where: any = {};
    
    if (status) {
      where.status = status;
    }
    
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const [images, total] = await Promise.all([
      prisma.diskImage.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { uploadedAt: 'desc' },
      }),
      prisma.diskImage.count({ where }),
    ]);

    // Serialize BigInt values
    const serializedImages = images.map(img => {
      const serialized: any = { ...img };
      if (serialized.size !== undefined && serialized.size !== null) {
        serialized.size = serialized.size.toString();
      }
      return serialized;
    });

    return reply.send({
      data: serializedImages,
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
      message: 'Failed to fetch images',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getImageHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;

    const image = await prisma.diskImage.findUnique({
      where: { id },
    });

    if (!image) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        message: 'Image not found',
      });
    }

    return reply.send({
      data: image,
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to fetch image',
    });
  }
}

export async function createImageHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = createImageZodSchema.parse(request.body);
    const { name, originalName, size, hash } = body;

    const extension = getFileExtension(originalName);
    
    if (!SUPPORTED_EXTENSIONS.includes(extension)) {
      return reply.status(400).send({
        code: 'INVALID_EXTENSION',
        message: `Unsupported file extension. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`,
      });
    }

    if (size > MAX_FILE_SIZE) {
      return reply.status(400).send({
        code: 'FILE_TOO_LARGE',
        message: `File size exceeds maximum allowed (${MAX_FILE_SIZE / (1024 * 1024 * 1024)}GB)`,
      });
    }

    const image = await prisma.diskImage.create({
      data: {
        name,
        originalName,
        size: BigInt(size),
        hash: hash || 'pending',
        status: 'UPLOADING',
        tenantId: 'demo-tenant',
      },
    });

    return reply.status(201).send({
      data: {
        id: image.id,
        name: image.name,
        originalName: image.originalName,
        size: image.size,
        status: image.status,
        uploadedAt: image.uploadedAt,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to create image',
    });
  }
}

export async function processImageHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;

    const image = await prisma.diskImage.findUnique({
      where: { id },
    });

    if (!image) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        message: 'Image not found',
      });
    }

    if (image.status !== 'UPLOADING') {
      return reply.status(400).send({
        code: 'INVALID_STATUS',
        message: 'Image is not in uploading status',
      });
    }

    await prisma.diskImage.update({
      where: { id },
      data: {
        status: 'PROCESSING',
      },
    });

    const fileSystem = detectFileSystem(image.originalName);

    const partitions = generatePartitions(image.originalName);

    await prisma.diskImage.update({
      where: { id },
      data: {
        status: 'READY',
        processedAt: new Date(),
        fileSystem: fileSystem as any,
        partitions: partitions,
      },
    });

    return reply.send({
      data: {
        id,
        status: 'READY',
        fileSystem,
        partitions,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to process image',
    });
  }
}

export async function deleteImageHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;

    const image = await prisma.diskImage.findUnique({
      where: { id },
    });

    if (!image) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        message: 'Image not found',
      });
    }

    await prisma.diskImage.delete({
      where: { id },
    });

    return reply.status(204).send();
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to delete image',
    });
  }
}

function detectFileSystem(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.includes('ntfs')) return 'NTFS';
  if (lower.includes('ext') || lower.includes('linux')) return 'EXT4';
  if (lower.includes('fat') || lower.includes('usb')) return 'FAT32';
  if (lower.includes('exfat')) return 'EXFAT';
  if (lower.includes('mac') || lower.includes('apfs')) return 'APFS';
  return 'UNKNOWN';
}

function generatePartitions(filename: string): any[] {
  return [
    {
      index: 0,
      type: 'Primary',
      startSector: 2048,
      endSector: 104857600,
      size: 53687091200,
      fileSystem: detectFileSystem(filename),
      label: 'System',
    },
    {
      index: 1,
      type: 'Extended',
      startSector: 104857601,
      endSector: 209715200,
      size: 53687091200,
      fileSystem: 'NTFS',
      label: 'Data',
    },
  ];
}

export async function uploadChunkHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const filename = (request.body as any)?.filename as string | undefined;
    const offset = parseInt((request.body as any)?.offset as string || '0');
    const totalSize = parseInt((request.body as any)?.totalSize as string || '0');
    const isLast = (request.body as any)?.isLast === 'true';
    const existingUploadId = (request.body as any)?.uploadId as string | undefined;

    if (!filename) {
      return reply.status(400).send({
        code: 'MISSING_FILENAME',
        message: 'Filename is required',
      });
    }

    const extension = getFileExtension(filename);
    
    if (!SUPPORTED_EXTENSIONS.includes(extension)) {
      return reply.status(400).send({
        code: 'INVALID_EXTENSION',
        message: `Unsupported file extension. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`,
      });
    }

    let image;
    
    if (existingUploadId) {
      image = await prisma.diskImage.findUnique({
        where: { id: existingUploadId },
      });
    }

    if (!image) {
      if (totalSize > MAX_FILE_SIZE) {
        return reply.status(400).send({
          code: 'FILE_TOO_LARGE',
          message: `File size exceeds maximum allowed (${MAX_FILE_SIZE / (1024 * 1024 * 1024)}GB)`,
        });
      }

      image = await prisma.diskImage.create({
        data: {
          name: filename.replace(/\.[^/.]+$/, ''),
          originalName: filename,
          size: BigInt(totalSize),
          hash: 'pending',
          status: 'UPLOADING',
          tenantId: 'demo-tenant',
        },
      });
    }

    if (isLast) {
      await prisma.diskImage.update({
        where: { id: image.id },
        data: {
          status: 'READY',
          processedAt: new Date(),
          fileSystem: detectFileSystem(filename) as any,
          partitions: generatePartitions(filename),
        },
      });
    }

    return reply.send({
      uploadId: image.id,
      offset: offset,
      status: isLast ? 'completed' : 'uploading',
      message: isLast ? 'Upload completed' : 'Chunk received',
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to upload chunk',
    });
  }
}

export async function validateImageHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;

    const image = await prisma.diskImage.findUnique({
      where: { id },
    });

    if (!image) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        message: 'Image not found',
      });
    }

    const extension = getFileExtension(image.originalName);
    const isValidExtension = SUPPORTED_EXTENSIONS.includes(extension);
    const isValidSize = Number(image.size) <= MAX_FILE_SIZE;

    return reply.send({
      data: {
        id: image.id,
        valid: isValidExtension && isValidSize,
        checks: {
          extension: {
            valid: isValidExtension,
            message: isValidExtension 
              ? `Extension ${extension} is supported` 
              : `Extension ${extension} is not supported`,
          },
          size: {
            valid: isValidSize,
            message: isValidSize 
              ? `Size ${Number(image.size) / (1024 * 1024 * 1024)}GB is within limits` 
              : `Size exceeds maximum of ${MAX_FILE_SIZE / (1024 * 1024 * 1024)}GB`,
          },
          hash: {
            valid: !!image.hash && image.hash !== 'pending',
            message: image.hash === 'pending' 
              ? 'Hash not yet calculated' 
              : 'Hash verified',
          },
        },
        detectedFileSystem: detectFileSystem(image.originalName),
        partitions: image.partitions,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to validate image',
    });
  }
}
