import { useMemo } from 'react';
import { useAuth } from '../state/auth.jsx';
import { PLATFORM_ROLE, SPACE_ROLE } from '../shared/constants.js';

/**
 * The space this user administers, or null.
 *
 * Every `/admin/*` endpoint scopes by an explicit `spaceId` and the server
 * re-checks the caller's membership role on every request (tenantGuard), so
 * this hook only decides what to SHOW — it cannot grant anything. If the user
 * administers several spaces, the active one wins so the admin area always
 * matches the world the switcher says they are standing in.
 */
export function useAdminSpace() {
  const { spaces, activeSpaceId } = useAuth();

  return useMemo(() => {
    const administered = spaces.filter(
      (s) =>
        s.status === 'active' &&
        (s.role === SPACE_ROLE.ADMIN || s.role === SPACE_ROLE.SUB_ADMIN),
    );
    if (administered.length === 0) return null;
    return administered.find((s) => s.id === activeSpaceId) ?? administered[0];
  }, [spaces, activeSpaceId]);
}

/**
 * Per-capability visibility, mirroring the server's spacePermissionGuard: a
 * full admin can do everything; a sub-admin only what was granted. Like
 * useAdminSpace, this decides what to SHOW — the server re-checks on every
 * request.
 */
export function useAdminPermissions(space) {
  const isFullAdmin = space?.role === SPACE_ROLE.ADMIN;
  const granted = (key) => isFullAdmin || Boolean(space?.permissions?.[key]);
  return {
    canWrite: granted('createQuestions'),
    canPublish: granted('publishQuestions'),
    canManageTopics: granted('manageTopics'),
    canManageSettings: granted('manageSettings'),
    /**
     * The two the server enforces and this hook did not model.
     *
     * `manageStudents` gates approve/reject/suspend and the batch endpoints;
     * `manageContests` gates contests and assignments. Without them the console
     * showed a sub-admin fully live controls that only failed with a 403 after
     * they had filled in the whole form — which reads as a broken console
     * rather than a permission they were never given.
     */
    canManageStudents: granted('manageStudents'),
    canManageContests: granted('manageContests'),
    isFullAdmin,
  };
}

/** True when the signed-in user is the platform superadmin. */
export function useIsSuperadmin() {
  const { user } = useAuth();
  return user?.role === PLATFORM_ROLE.SUPERADMIN;
}

/**
 * Where this account's app IS. Managers do not get the player experience:
 * a superadmin's app is the platform console, an organization admin's app
 * is the admin console, and everyone else plays. The root layout routes on
 * this; the server still enforces every call regardless.
 */
export function useConsolePath() {
  const { user, spaces } = useAuth();
  return useMemo(() => {
    if (user?.role === PLATFORM_ROLE.SUPERADMIN) return '/super';
    const managed = spaces.some(
      (s) =>
        s.status === 'active' &&
        (s.role === SPACE_ROLE.ADMIN || s.role === SPACE_ROLE.SUB_ADMIN),
    );
    return managed ? '/admin' : null;
  }, [user, spaces]);
}
