import { Share } from 'react-native';

/**
 * Everything the app hands to somebody who may not have installed it.
 *
 * One place, because there are now two of them — the profile share and the
 * friend invite — and a link base that drifts between screens is the kind of
 * bug nobody notices until half the invites 404. Matches the backend's
 * `APP_LINK_BASE`, which is what organization invite links already use.
 *
 * It has to be a domain that actually exists and is actually claimed by the
 * app: this was `mimo.app`, which nothing serves and no build declared, so
 * every invite ever sent opened a browser on a dead host instead of the app.
 * `wms.distrx.io` is the deployed API, declared in app.json as an associated
 * domain (iOS) and an auto-verified intent filter (Android).
 */
export const APP_LINK_BASE = 'https://wms.distrx.io';

/** The public profile route the app already serves. */
export const profileLink = (userId) => `${APP_LINK_BASE}/user/${userId ?? ''}`;

/**
 * Invite somebody who is not here yet.
 *
 * The sheet the OS opens is the whole point: WhatsApp, Messages, a copied link
 * — whatever the person actually uses to talk to their friends, rather than a
 * button per service that we would have to guess at and keep working.
 *
 * The message leads with the sender's name and ends with a link to their own
 * profile, so accepting is one tap on a page that already shows who invited
 * them, not a cold landing page.
 */
export function inviteFriends({ displayName, userId }) {
  const who = displayName ? `${displayName} is` : "I'm";
  return Share.share({
    message:
      `${who} on Mimo — seven questions, ten seconds each, head to head.\n\n` +
      `Play me: ${profileLink(userId)}`,
  }).catch(() => {});
}
