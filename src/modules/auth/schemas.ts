import { z } from 'zod';

export const registerSchema = {
  body: {
    type: 'object',
    required: ['email', 'password', 'firstName', 'lastName'],
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 8 },
      firstName: { type: 'string', minLength: 1 },
      lastName: { type: 'string', minLength: 1 },
      acceptTerms: { type: 'boolean' },
    },
  },
  response: {
    201: {
      type: 'object',
      properties: {
        user: { type: 'object' },
        tokens: { type: 'object' },
      },
    },
  },
};

export const loginSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string' },
      rememberMe: { type: 'boolean' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        user: { type: 'object' },
        tokens: { type: 'object' },
      },
    },
  },
};

export const refreshSchema = {
  body: {
    type: 'object',
    required: ['refreshToken'],
    properties: {
      refreshToken: { type: 'string' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        tokens: { type: 'object' },
      },
    },
  },
};

export const registerZodSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  acceptTerms: z.boolean().refine((val) => val === true),
});

export const loginZodSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  rememberMe: z.boolean().optional(),
});

export const refreshZodSchema = z.object({
  refreshToken: z.string().min(1),
});

export const forgotPasswordZodSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordZodSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/),
});

export const forgotPasswordSchema = {
  body: {
    type: 'object',
    required: ['email'],
    properties: {
      email: { type: 'string', format: 'email' },
    },
  },
};

export const resetPasswordSchema = {
  body: {
    type: 'object',
    required: ['token', 'password'],
    properties: {
      token: { type: 'string' },
      password: { type: 'string', minLength: 8 },
    },
  },
};
