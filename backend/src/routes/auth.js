import {
  sendOtp,
  verifyOtp,
  refreshTokens,
  revokeRefreshFamily,
} from '../services/authService.js';
import { authenticate } from '../middleware/auth.js';

const ok = (data) => ({ data });

/** tech.md §6 — every response is `{ data }` or `{ error }`. */
export default async function authRoutes(app) {
  /**
   * tech.md §15 — the OTP endpoints carry their own tighter limits on top of
   * the global one. Rate limiting by IP as well as by phone matters: the
   * per-number limit in authService stops one number being spammed, this
   * stops one host walking the number space.
   */
  const otpLimit = {
    config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
  };

  app.post(
    '/otp/send',
    {
      ...otpLimit,
      schema: {
        body: {
          type: 'object',
          required: ['phone'],
          properties: { phone: { type: 'string', minLength: 6, maxLength: 20 } },
        },
      },
    },
    async (request) => {
      const result = await sendOtp(request.body.phone, { ip: request.ip });
      return ok(result);
    },
  );

  app.post(
    '/otp/verify',
    {
      ...otpLimit,
      schema: {
        body: {
          type: 'object',
          required: ['phone', 'code'],
          properties: {
            phone: { type: 'string' },
            code: { type: 'string', minLength: 4, maxLength: 8 },
          },
        },
      },
    },
    async (request) => {
      const { user, tokens, isNew, needsProfile } = await verifyOtp(
        request.body.phone,
        request.body.code,
        {
          userAgent: request.headers['user-agent'],
          ip: request.ip,
        },
      );
      return ok({ user: user.toPrivateProfile(), tokens, isNew, needsProfile });
    },
  );

  app.post(
    '/refresh',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
      schema: {
        body: {
          type: 'object',
          required: ['refreshToken'],
          properties: { refreshToken: { type: 'string' } },
        },
      },
    },
    async (request) => {
      const { user, tokens } = await refreshTokens(request.body.refreshToken, {
        userAgent: request.headers['user-agent'],
        ip: request.ip,
      });
      return ok({ user: user.toPrivateProfile(), tokens });
    },
  );

  app.post(
    '/logout',
    {
      schema: {
        body: {
          type: 'object',
          properties: { refreshToken: { type: 'string' } },
        },
      },
    },
    async (request) => {
      await revokeRefreshFamily(request.body?.refreshToken);
      return ok({ loggedOut: true });
    },
  );

  /** Cheap probe the client uses to decide whether its access token is still good. */
  app.get('/session', { preHandler: authenticate }, async (request) =>
    ok({ user: request.user.toPrivateProfile() }),
  );
}
