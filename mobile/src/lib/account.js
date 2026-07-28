/**
 * Sign-out copy, shared by Settings and the profile tab so the two can never
 * drift into warning about different things.
 *
 * design.md §10 — the copy states what will happen rather than asking whether
 * the player is sure. Every account is a phone number now, so there is exactly
 * one thing to say: nothing is lost, and one SMS brings it all back.
 *
 * Rendered through the app's own `ConfirmSheet`, never `Alert.alert` — the OS
 * alert box is the one surface on a screen that ignores the design system.
 */
export function signOutCopy() {
  return {
    title: 'Sign out?',
    body: 'Your progress is saved. Sign back in with your number any time.',
    confirmLabel: 'Sign out',
  };
}
