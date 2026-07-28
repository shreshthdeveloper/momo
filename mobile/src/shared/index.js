/**
 * MIRRORED DIRECTORY — backend/src/shared and mobile/src/shared are byte
 * identical, enforced by backend/tests/shared-parity.test.js.
 *
 * These files are the contract between client and server: the client
 * predicts a score locally so a tap feels instant, and the server stays the
 * only authority. Because both run the same code, the two can never drift.
 */

export * from './constants.js';
export * from './scoring.js';
export * from './elo.js';
export * from './league.js';
export * from './perks.js';
export * from './mastery.js';
export * from './achievements.js';
export * from './protocol.js';
