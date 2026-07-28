import { resolveScope, assertSpaceAdmin, assertPermission } from '../services/spaceService.js';
import { UnauthorizedError } from '../lib/errors.js';

/**
 * tech.md §4 — the highest-risk area in the system. A leak between institutes
 * is not a bug, it is an incident.
 *
 * **Rule: the client never supplies a `spaceId` that is trusted.** This
 * resolves the caller's memberships server-side and replaces whatever they
 * asked for with a validated scope object at `request.scope`. Handlers must
 * read `request.scope.spaceId` and never `request.params.spaceId`.
 *
 * The lint rule in eslint.config.js flags any space-scoped model query that
 * does not include a spaceId filter, so this cannot be quietly bypassed
 * downstream.
 */
export async function tenantGuard(request) {
  if (!request.user) throw new UnauthorizedError('Sign in to continue.');

  const requested =
    request.params?.spaceId ??
    request.body?.spaceId ??
    request.query?.spaceId ??
    request.headers['x-space-id'] ??
    null;

  request.scope = await resolveScope(request.user, requested);
}

/** tenantGuard, then admin-or-better. */
export async function spaceAdminGuard(request) {
  await tenantGuard(request);
  assertSpaceAdmin(request.scope);
}

/** tenantGuard, then a specific granular permission (prd.md F8.7.3). */
export function spacePermissionGuard(permission) {
  return async function guard(request) {
    await tenantGuard(request);
    assertPermission(request.scope, permission);
  };
}
