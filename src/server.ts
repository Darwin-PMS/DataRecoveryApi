import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { join } from 'path';
import { fileURLToPath } from 'url';

import { authRoutes } from './modules/auth/routes';
import { userRoutes } from './modules/user/routes';
import { tenantRoutes } from './modules/tenant/routes';
import { jobRoutes } from './modules/job/routes';
import { billingRoutes } from './modules/billing/routes';
import { diskImageRoutes } from './modules/diskImage/routes';
import { fileRecoveryRoutes } from './modules/fileRecovery/routes';
import { teamRoutes } from './modules/team/routes';
import { healthRoutes } from './routes/health';
import { errorHandler } from './utils/error-handler';
import { requestLogger } from './utils/logger';
import { forensicRoutes } from './modules/forensic/routes';
import { fileScannerRoutes } from './modules/fileScanner/routes';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport:
        process.env.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                colorize: true,
              },
            }
          : undefined,
    },
  });

  await app.register(cors, {
    origin: process.env.APP_URL || 'http://localhost:3000',
    credentials: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(rateLimit, {
    max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'DataVault Pro API',
        description: 'AI-Powered Data Recovery & Digital Forensics API',
        version: '1.0.0',
      },
      servers: [
        {
          url: process.env.API_URL || 'http://localhost:4000',
          description: 'Development server',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  });

  app.addHook('onRequest', requestLogger);

  app.setErrorHandler(errorHandler);

  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  await app.register(healthRoutes, { prefix: '/api/v1/health' });
  await app.register(forensicRoutes, { prefix: '/api/v1/forensic' });
  await app.register(fileScannerRoutes, { prefix: '/api/v1/scanner' });
  
  console.log('[SERVER] Registering auth routes...');
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  console.log('[SERVER] Auth routes registered');
  await app.register(userRoutes, { prefix: '/api/v1/users' });
  await app.register(tenantRoutes, { prefix: '/api/v1/tenants' });
  await app.register(jobRoutes, { prefix: '/api/v1/jobs' });
  await app.register(billingRoutes, { prefix: '/api/v1/billing' });
  await app.register(diskImageRoutes, { prefix: '/api/v1/disk-images' });
  await app.register(fileRecoveryRoutes, { prefix: '/api/v1/files' });
  await app.register(teamRoutes, { prefix: '/api/v1/team' });

  return app;
}

async function start() {
  const app = await buildApp();

  const port = parseInt(process.env.PORT || '4000');
  const host = process.env.HOST || '0.0.0.0';

  try {
    await app.listen({ port, host });
    app.log.info(`Server running at http://${host}:${port}`);
    app.log.info(`API Documentation at http://${host}:${port}/docs`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();

export { buildApp };
