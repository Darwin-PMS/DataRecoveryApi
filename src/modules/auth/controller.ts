import { FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import { SignJWT, jwtVerify } from 'jose';
import { PrismaClient } from '@prisma/client';
import { registerZodSchema, loginZodSchema, refreshZodSchema, forgotPasswordZodSchema, resetPasswordZodSchema } from './schemas';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'secret');
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const PASSWORD_RESET_TOKEN_EXPIRY = 60 * 60 * 1000; // 1 hour

async function generateTokens(userId: string, email: string) {
  const accessToken = await new SignJWT({ userId, email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(JWT_SECRET);

  const refreshToken = await new SignJWT({ userId, email, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(JWT_SECRET);

  return { accessToken, refreshToken, expiresIn: 900 };
}

export async function registerHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = registerZodSchema.parse(request.body);

    const existingUser = await prisma.user.findUnique({
      where: { email: body.email },
    });

    if (existingUser) {
      return reply.status(400).send({
        code: 'EMAIL_EXISTS',
        message: 'An account with this email already exists',
      });
    }

    const passwordHash = await bcrypt.hash(body.password, 12);

    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
        firstName: body.firstName,
        lastName: body.lastName,
      },
    });

    const { accessToken, refreshToken, expiresIn } = await generateTokens(user.id, user.email);

    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshTokenHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return reply.status(201).send({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        status: user.status,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn,
        tokenType: 'Bearer',
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'An error occurred during registration',
    });
  }
}

console.log('[AUTH CONTROLLER] Loaded at', new Date().toISOString(), 'UNIQUE_MARKER_12345');

export async function loginHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = loginZodSchema.parse(request.body);

    const user = await prisma.user.findUnique({
      where: { email: body.email },
    });

    if (!user) {
      return reply.status(401).send({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    if (user.status !== 'ACTIVE') {
      return reply.status(403).send({
        code: 'ACCOUNT_DISABLED',
        message: 'Your account has been disabled',
      });
    }

    const isValidPassword = await bcrypt.compare(body.password, user.passwordHash);

    if (!isValidPassword) {
      return reply.status(401).send({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const { accessToken, refreshToken, expiresIn } = await generateTokens(user.id, user.email);

    request.log.info({ userId: user.id, accessToken: accessToken?.substring(0, 20) }, 'Login successful, tokens generated');

    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshTokenHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await prisma.session.create({
      data: {
        userId: user.id,
        ipAddress: request.ip || 'unknown',
        userAgent: request.headers['user-agent'] || 'unknown',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    request.log.info({ user: { id: user.id, email: user.email }, tokensGenerated: true }, 'Login complete, sending response');

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        status: user.status,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn,
        tokenType: 'Bearer',
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'An error occurred during login',
    });
  }
}

export async function logoutHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = refreshZodSchema.parse(request.body);

    const { payload } = await jwtVerify(body.refreshToken, JWT_SECRET);

    await prisma.refreshToken.updateMany({
      where: {
        userId: payload.userId as string,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return reply.send({
      message: 'Successfully logged out',
    });
  } catch (error) {
    return reply.status(400).send({
      code: 'INVALID_TOKEN',
      message: 'Invalid refresh token',
    });
  }
}

export async function refreshHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = refreshZodSchema.parse(request.body);

    const { payload } = await jwtVerify(body.refreshToken, JWT_SECRET);

    if (payload.type !== 'refresh') {
      return reply.status(400).send({
        code: 'INVALID_TOKEN',
        message: 'Invalid token type',
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId as string },
    });

    if (!user || user.status !== 'ACTIVE') {
      return reply.status(401).send({
        code: 'INVALID_TOKEN',
        message: 'User not found or inactive',
      });
    }

    const tokens = await generateTokens(user.id, user.email);

    return reply.send({
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        tokenType: 'Bearer',
      },
    });
  } catch (error) {
    return reply.status(400).send({
      code: 'INVALID_TOKEN',
      message: 'Invalid refresh token',
    });
  }
}

export async function getSessionsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'No token provided',
      });
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = payload.userId as string;

    const sessions = await prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const currentTokenExpiry = new Date(Date.now() + 15 * 60 * 1000);

    return reply.send({
      data: sessions.map((session) => ({
        id: session.id,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        isCurrent: session.expiresAt > currentTokenExpiry,
      })),
    });
  } catch (error) {
    return reply.status(401).send({
      code: 'INVALID_TOKEN',
      message: 'Invalid or expired token',
    });
  }
}

export async function revokeSessionHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'No token provided',
      });
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = payload.userId as string;
    const { id } = request.params;

    const session = await prisma.session.findFirst({
      where: { id, userId },
    });

    if (!session) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        message: 'Session not found',
      });
    }

    await prisma.session.delete({
      where: { id },
    });

    return reply.send({
      message: 'Session revoked successfully',
    });
  } catch (error) {
    return reply.status(400).send({
      code: 'ERROR',
      message: 'Failed to revoke session',
    });
  }
}

export async function revokeAllSessionsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'No token provided',
      });
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = payload.userId as string;

    const result = await prisma.session.deleteMany({
      where: { userId },
    });

    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return reply.send({
      message: `Successfully revoked ${result.count} sessions`,
    });
  } catch (error) {
    return reply.status(400).send({
      code: 'ERROR',
      message: 'Failed to revoke sessions',
    });
  }
}

export async function forgotPasswordHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = forgotPasswordZodSchema.parse(request.body);

    const user = await prisma.user.findUnique({
      where: { email: body.email },
    });

    if (!user) {
      return reply.send({
        message: 'If an account exists with this email, a password reset link has been sent',
      });
    }

    const resetToken = randomBytes(32).toString('hex');
    const resetTokenHash = await bcrypt.hash(resetToken, 10);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_EXPIRY);

    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: resetTokenHash,
        expiresAt,
      },
    });

    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}&email=${encodeURIComponent(user.email)}`;
    
    request.log.info({ resetLink }, 'Password reset link generated');

    return reply.send({
      message: 'If an account exists with this email, a password reset link has been sent',
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'An error occurred while processing your request',
    });
  }
}

export async function resetPasswordHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = resetPasswordZodSchema.parse(request.body);

    const resetRecord = await prisma.passwordReset.findFirst({
      where: {
        tokenHash: await bcrypt.hash(body.token, 10),
        usedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      include: { user: true },
    });

    if (!resetRecord) {
      return reply.status(400).send({
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired reset token',
      });
    }

    if (resetRecord.expiresAt < new Date()) {
      return reply.status(400).send({
        code: 'EXPIRED_TOKEN',
        message: 'Reset token has expired',
      });
    }

    const newPasswordHash = await bcrypt.hash(body.password, 12);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetRecord.userId },
        data: { passwordHash: newPasswordHash },
      }),
      prisma.passwordReset.update({
        where: { id: resetRecord.id },
        data: { usedAt: new Date() },
      }),
      prisma.session.deleteMany({
        where: { userId: resetRecord.userId },
      }),
      prisma.refreshToken.updateMany({
        where: { userId: resetRecord.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return reply.send({
      message: 'Password has been reset successfully',
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'An error occurred while resetting password',
    });
  }
}
