import { verifyAccessToken, loadAuthenticatedUser } from '../services/authService.js';
import { UnauthorizedError, ForbiddenError } from '../lib/errors.js';
import { PLATFORM_ROLE } from '../shared/constants.js';

function bearerFrom(request) {
  const header = request.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/** Requires a valid access token. Attaches `request.user` (a Mongoose doc). */
export async function authenticate(request) {
  const token = bearerFrom(request);
  if (!token) throw new UnauthorizedError('Sign in to continue.');
  const claims = verifyAccessToken(token);
  const user = await loadAuthenticatedUser(claims);
  request.user = user;
  request.auth = { id: String(user._id), role: user.role };
}

/** Attaches `request.user` when a token is present, but never rejects. */
export async function optionalAuthenticate(request) {
  const token = bearerFrom(request);
  if (!token) return;
  try {
    const claims = verifyAccessToken(token);
    const user = await loadAuthenticatedUser(claims);
    request.user = user;
    request.auth = { id: String(user._id), role: user.role };
  } catch {
    // An expired token on a public endpoint is not an error — the caller is
    // simply treated as anonymous.
  }
}

export function requireRole(...roles) {
  return async function roleGuard(request) {
    if (!request.user) throw new UnauthorizedError('Sign in to continue.');
    if (!roles.includes(request.user.role)) {
      throw new ForbiddenError('You do not have access to this.');
    }
  };
}

export const requireSuperadmin = requireRole(PLATFORM_ROLE.SUPERADMIN);
