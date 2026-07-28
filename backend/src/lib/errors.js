/**
 * Errors carry a stable machine code alongside a human message.
 * design.md §10: errors state what happened and what to do. They do not
 * apologise and they are never vague.
 */

export class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Check the values you sent.', code = 'BAD_REQUEST', details) {
    super(400, code, message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Sign in to continue.', code = 'UNAUTHENTICATED', details) {
    super(401, code, message, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have access to this.', code = 'FORBIDDEN', details) {
    super(403, code, message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found.', code = 'NOT_FOUND', details) {
    super(404, code, message, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'That already exists.', code = 'CONFLICT', details) {
    super(409, code, message, details);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many attempts. Try again shortly.', code = 'RATE_LIMITED', details) {
    super(429, code, message, details);
  }
}

/** Uniform error envelope: `{ error: { code, message, details } }`. */
export function toErrorResponse(err) {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      body: { error: { code: err.code, message: err.message, details: err.details } },
    };
  }
  // Fastify schema validation
  if (err.validation) {
    return {
      statusCode: 400,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Check the values you sent.',
          details: err.validation.map((v) => ({
            field: (v.instancePath || v.params?.missingProperty || '').replace(/^\//, ''),
            problem: v.message,
          })),
        },
      },
    };
  }
  // Mongo duplicate key. Compound unique indexes lead with the tenant key
  // (spaceId + slug, spaceId + name…) — the field worth naming to a human is
  // the last one, not the scope it collided inside.
  if (err.code === 11000) {
    const keys = Object.keys(err.keyPattern ?? {});
    const raw = keys.filter((k) => k !== 'spaceId').pop() ?? keys[0] ?? 'value';
    // Slugs are derived from names; the human typed a name.
    const field = raw === 'slug' ? 'name' : raw;
    return {
      statusCode: 409,
      body: {
        error: { code: 'DUPLICATE', message: `That ${field} is already taken.`, details: { field } },
      },
    };
  }
  if (err.name === 'ValidationError' && err.errors) {
    return {
      statusCode: 400,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Check the values you sent.',
          details: Object.entries(err.errors).map(([field, e]) => ({ field, problem: e.message })),
        },
      },
    };
  }
  if (err.name === 'CastError') {
    return {
      statusCode: 400,
      body: { error: { code: 'BAD_ID', message: 'That identifier is not valid.' } },
    };
  }
  return {
    statusCode: err.statusCode && err.statusCode < 500 ? err.statusCode : 500,
    body: { error: { code: 'INTERNAL', message: 'Something failed on our side. Try again.' } },
  };
}
