import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { 
  registerHandler, 
  loginHandler, 
  logoutHandler, 
  refreshHandler,
  getSessionsHandler,
  revokeSessionHandler,
  revokeAllSessionsHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
} from './controller';
import { registerSchema, loginSchema, refreshSchema, forgotPasswordSchema, resetPasswordSchema } from './schemas';

export async function authRoutes(
  app: FastifyInstance,
  options: FastifyPluginOptions
) {
  app.post('/register', {
    schema: registerSchema,
  }, registerHandler);

  app.post('/login', loginHandler);

  app.post('/logout', {
    schema: refreshSchema,
  }, logoutHandler);

  app.post('/refresh', {
    schema: refreshSchema,
  }, refreshHandler);

  app.get('/sessions', getSessionsHandler);

  app.delete('/sessions/:id', revokeSessionHandler);

  app.post('/sessions/revoke-all', revokeAllSessionsHandler);

  app.post('/forgot-password', {
    schema: forgotPasswordSchema,
  }, forgotPasswordHandler);

  app.post('/reset-password', {
    schema: resetPasswordSchema,
  }, resetPasswordHandler);
}
