import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { toErrorResponse } from './lib/errors.js';
import { registerRoutes } from './routes/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function buildApp({ orchestratorRef } = {}) {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
    // tech.md §15 — schema validation on every route. Coercion off so a
    // string never silently becomes a number in a filter.
    ajv: { customOptions: { removeAdditional: 'all', coerceTypes: false, allErrors: true } },
  });

  await app.register(helmet, {
    // The API serves JSON and uploaded images; the strict CSP belongs on the
    // admin portal's own host, where HSTS is set too.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await app.register(cors, {
    origin(origin, cb) {
      // Mobile clients send no Origin header at all.
      if (!origin || env.CORS_ORIGINS.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });

  await app.register(rateLimit, {
    global: true,
    max: 500,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.user?._id?.toString() ?? request.ip,
    /**
     * Every request in the test suite originates from one loopback address, so
     * the HTTP limiter would otherwise count unrelated tests against each other
     * and fail whichever happens to run last. The limits that carry real
     * product meaning are asserted independently and are not skipped here:
     * the per-number OTP throttle (services/authService.js) and the
     * queue-join limiter (game/socketGateway.js).
     */
    allowList: () => env.isTest,
    errorResponseBuilder: () => ({
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again shortly.' },
    }),
  });

  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });

  if (env.STORAGE_DRIVER === 'local') {
    const uploadRoot = path.resolve(here, '..', env.STORAGE_LOCAL_DIR);
    await app.register(fastifyStatic, {
      root: uploadRoot,
      prefix: '/uploads/',
      decorateReply: false,
      setHeaders: (res) => res.setHeader('cache-control', 'public, max-age=31536000, immutable'),
    });
  }

  app.decorate('orchestrator', null);
  if (orchestratorRef) app.orchestrator = orchestratorRef;

  app.setErrorHandler((err, request, reply) => {
    const { statusCode, body } = toErrorResponse(err);
    if (statusCode >= 500) request.log.error({ err }, 'unhandled error');
    else request.log.debug({ err: err.message, code: body.error.code }, 'request rejected');
    return reply.code(statusCode).send(body);
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No such endpoint.' } }),
  );

  await registerRoutes(app);

  return app;
}
