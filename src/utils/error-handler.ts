import type { FastifyError, FastifyRequest, FastifyReply } from 'fastify';

export async function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  request.log.error(error);

  if (error.validation) {
    return reply.status(400).send({
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: error.validation,
    });
  }

  if (error.statusCode) {
    return reply.status(error.statusCode).send({
      code: error.code || 'ERROR',
      message: error.message,
    });
  }

  return reply.status(500).send({
    code: 'INTERNAL_ERROR',
    message: error?.message || 'An unexpected error occurred',
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
  });
}
