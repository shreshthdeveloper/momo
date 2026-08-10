import { useMemo } from 'react';
import { useLocalSearchParams, useSegments } from 'expo-router';
import { useAuth } from '../state/auth.jsx';
import { PLATFORM_ROLE, PUBLIC_SPACE_ID, SPACE_ROLE } from '../shared/constants.js';

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

/** Everything a full admin holds, for a caller who is above the permission system. */
const ALL_PERMISSIONS = {
  canWrite: true,
  canPublish: true,
  canManageTopics: true,
  canManageSettings: true,
  canManageStudents: true,
  canManageContests: true,
  isFullAdmin: true,
};

/**
 * Which space a console screen is acting in, and what it may do there.
 *
 * The content screens — the question bank, topics, the topic form, the review
 * queue, the CSV import — are the same screens for an organization admin and
 * for the platform operator. The only differences are *whose* space they are
 * pointed at and *which* console they are mounted in, so the screens ask this
 * hook instead of reading `useAdminSpace()` directly, and the same file is
 * routed at `/admin/topics` and `/super/topics`.
 *
 * Three ways a space is resolved, in order:
 *
 *   1. A `spaceId` param, for a superadmin only — how the operator reaches one
 *      tenant's content. It wins in EITHER console.
 *   2. Mounted under `/super` with nothing narrowing it — the platform console's
 *      own bank is the Central Bank, so a content screen there is the Public
 *      Arena unless told otherwise.
 *   3. Otherwise the admin's own space.
 *
 * ── Why the param now wins under `/super` too ───────────────────────────────
 *
 * The old rule was that `/super` routes never carry a spaceId, because the
 * platform console has exactly one bank. That is true right up until the
 * operator opens an organization and wants to see what is IN it — and the only
 * mechanism for that was to push them into the `/admin` routes, which swaps the
 * whole shell: a different sidebar, a different title, a console that says it
 * belongs to an organization the operator is not a member of. The scope belongs
 * in the URL; the console you are standing in should not have to change with it.
 *
 * Nothing existing moves: no `/super/*` link has ever carried a spaceId, so
 * every one of them still resolves to the Central Bank.
 *
 * Elevation only decides what to SHOW. `resolveScope` on the server re-derives
 * the caller's role for every single request and writes an audit row naming the
 * superadmin behind it, so a permission granted here grants nothing.
 */
export function useConsoleSpace() {
  const segments = useSegments();
  const params = useLocalSearchParams();
  const adminSpace = useAdminSpace();
  const permissions = useAdminPermissions(adminSpace);
  const isSuper = useIsSuperadmin();

  const inPlatformConsole = segments[0] === 'super';
  const requested = typeof params.spaceId === 'string' && params.spaceId.length > 0 ? params.spaceId : null;
  // Only the platform operator may act outside their own memberships. A
  // spaceId on anyone else's URL is ignored rather than trusted.
  const elevatedId = !isSuper ? null : (requested ?? (inPlatformConsole ? PUBLIC_SPACE_ID : null));

  const spaceId = elevatedId ?? adminSpace?.id ?? null;
  const base = inPlatformConsole ? '/super' : '/admin';
  const isCentral = spaceId === PUBLIC_SPACE_ID;
  /**
   * Whose space this is, when it is not ours. The name travels as a param
   * because there is no cheap way to look it up from an id — and without it
   * every screen scoped into a tenant said "Platform access", which names the
   * mechanism rather than the organization.
   */
  const passedName = typeof params.spaceName === 'string' && params.spaceName ? params.spaceName : null;

  return {
    spaceId,
    base,
    isCentral,
    elevated: Boolean(elevatedId),
    /** True when scoped into a TENANT — not our own space, not the Central Bank. */
    inTenant: Boolean(elevatedId) && !isCentral,
    /** The line under a screen's title: which bank you are editing. */
    spaceName: elevatedId
      ? (isCentral ? 'Central bank' : (passedName ?? 'Platform access'))
      : (adminSpace?.name ?? null),
    /**
     * A sibling screen in the console this one is mounted in, carrying the
     * scope with it. A screen that was told which space it is in has to hand
     * that on, or the next one resolves back to the console's default — the
     * Central Bank under `/super`, the operator's own (non-existent)
     * membership under `/admin`.
     */
    href: (route, extra) => ({
      pathname: `${base}/${route}`,
      params: requested
        ? { ...extra, spaceId: requested, ...(passedName ? { spaceName: passedName } : null) }
        : { ...extra },
    }),
    ...(elevatedId ? ALL_PERMISSIONS : permissions),
  };
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
