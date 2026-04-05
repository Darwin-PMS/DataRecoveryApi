import { FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import {
  createJobZodSchema,
  updateJobZodSchema,
  jobQueryZodSchema,
} from "./schemas";

type JobStatusType = "PENDING" | "QUEUED" | "SCANNING" | "PAUSED" | "COMPLETED" | "FAILED" | "CANCELLED";

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

export async function listJobsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const tenantId = request.tenantId || request.user?.tenantId;
    const query = jobQueryZodSchema.parse(request.query);
    const { page, limit, status, type, search } = query;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };

    if (status) {
      where.status = status;
    }

    if (type) {
      where.type = type;
    }

    if (search) {
      where.name = { contains: search, mode: "insensitive" };
    }

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          diskImage: {
            select: {
              id: true,
              name: true,
              size: true,
            },
          },
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      }),
      prisma.job.count({ where }),
    ]);

    return reply.send({
      data: jobs.map((job) => serializeBigInt({
        id: job.id,
        name: job.name,
        description: job.description,
        status: job.status,
        type: job.type,
        sourceType: job.sourceType,
        sourceId: job.sourceId,
        progress: job.progress,
        filesFound: job.filesFound,
        filesRecovered: job.filesRecovered,
        storageUsed: job.storageUsed,
        fileSystem: job.fileSystem,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        error: job.error,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        diskImage: job.diskImage,
        user: job.user,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: "INTERNAL_ERROR",
      message: "Failed to fetch jobs",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createJobHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const body = createJobZodSchema.parse(request.body);
    const tenantId = request.tenantId || request.user?.tenantId;
    const userId = request.user?.id;

    if (!tenantId || !userId) {
      return reply.status(400).send({
        code: "MISSING_CONTEXT",
        message: "Tenant and user context required",
      });
    }

    const job = await prisma.job.create({
      data: {
        name: body.name,
        description: body.description,
        type: body.type as any,
        sourceType: (body.sourceType || "UPLOAD") as any,
        sourceId: body.sourceId,
        settings: body.settings || {},
        status: "PENDING" as JobStatusType,
        tenantId,
        userId,
      },
    });

    return reply.status(201).send({
      data: {
        id: job.id,
        name: job.name,
        description: job.description,
        status: job.status,
        type: job.type,
        sourceType: job.sourceType,
        progress: job.progress,
        filesFound: job.filesFound,
        filesRecovered: job.filesRecovered,
        storageUsed: job.storageUsed,
        createdAt: job.createdAt,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: "INTERNAL_ERROR",
      message: "Failed to create job",
    });
  }
}

export async function getJobHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  try {
    const { id } = request.params;

    const job = await prisma.job.findUnique({
      where: { id },
      include: {
        diskImage: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        files: {
          take: 100,
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!job) {
      return reply.status(404).send({
        code: "NOT_FOUND",
        message: "Job not found",
      });
    }

    return reply.send({
      data: {
        id: job.id,
        name: job.name,
        description: job.description,
        status: job.status,
        type: job.type,
        sourceType: job.sourceType,
        sourceId: job.sourceId,
        progress: job.progress,
        filesFound: job.filesFound,
        filesRecovered: job.filesRecovered,
        storageUsed: job.storageUsed,
        fileSystem: job.fileSystem,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        error: job.error,
        settings: job.settings,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        diskImage: job.diskImage,
        user: job.user,
        files: job.files,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: "INTERNAL_ERROR",
      message: "Failed to fetch job",
    });
  }
}

export async function updateJobHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  try {
    const { id } = request.params;
    const body = updateJobZodSchema.parse(request.body);

    const job = await prisma.job.update({
      where: { id },
      data: {
        ...(body.name && { name: body.name }),
        ...(body.description !== undefined && {
          description: body.description,
        }),
        ...(body.settings && { settings: body.settings }),
      },
    });

    return reply.send({
      data: {
        id: job.id,
        name: job.name,
        description: job.description,
        status: job.status,
        type: job.type,
        progress: job.progress,
        filesFound: job.filesFound,
        filesRecovered: job.filesRecovered,
        storageUsed: job.storageUsed,
        updatedAt: job.updatedAt,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: "INTERNAL_ERROR",
      message: "Failed to update job",
    });
  }
}

export async function startJobHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  try {
    const { id } = request.params;

    const job = await prisma.job.update({
      where: { id },
      data: {
        status: "QUEUED",
        startedAt: new Date(),
      },
    });

    return reply.send({
      data: {
        id: job.id,
        status: job.status,
        startedAt: job.startedAt,
        progress: job.progress,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: "INTERNAL_ERROR",
      message: "Failed to start job",
    });
  }
}

export async function pauseJobHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  try {
    const { id } = request.params;

    const job = await prisma.job.update({
      where: { id },
      data: {
        status: "PAUSED",
      },
    });

    return reply.send({
      data: {
        id: job.id,
        status: job.status,
        progress: job.progress,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: "INTERNAL_ERROR",
      message: "Failed to pause job",
    });
  }
}

export async function cancelJobHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  try {
    const { id } = request.params;

    const job = await prisma.job.update({
      where: { id },
      data: {
        status: "CANCELLED",
      },
    });

    return reply.send({
      data: {
        id: job.id,
        status: job.status,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: "INTERNAL_ERROR",
      message: "Failed to cancel job",
    });
  }
}

export async function deleteJobHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  try {
    const { id } = request.params;

    await prisma.job.delete({
      where: { id },
    });

    return reply.status(204).send();
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: "INTERNAL_ERROR",
      message: "Failed to delete job",
    });
  }
}

export async function getJobFilesHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  try {
    const { id } = request.params;
    const {
      page = "1",
      limit = "20",
      recoverable,
      type,
    } = request.query as any;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where: any = { jobId: id };

    if (recoverable !== undefined) {
      where.recoverable = recoverable === "true";
    }

    if (type) {
      where.type = type;
    }

    const [files, total] = await Promise.all([
      prisma.recoveredFile.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: "desc" },
      }),
      prisma.recoveredFile.count({ where }),
    ]);

    return reply.send({
      data: files,
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
      code: "INTERNAL_ERROR",
      message: "Failed to fetch job files",
    });
  }
}
