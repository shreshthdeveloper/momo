import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * The mirrored-directory guard.
 *
 * tech.md §2 puts scoring and Elo in a shared package so "the client can
 * predict a score locally for instant feedback while the server remains the
 * only authority. The two can never drift."
 *
 * This repository is three standalone folders rather than a workspace, so the
 * same guarantee is kept by mirroring `src/shared` between backend and mobile
 * and failing the build the moment the two copies differ. Without this test the
 * arrangement is a promise; with it, it is enforced.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_SHARED = path.resolve(here, '../src/shared');
const MOBILE_SHARED = path.resolve(here, '../../mobile/src/shared');

const MIRRORED_FILES = [
  'achievements.js',
  'constants.js',
  'scoring.js',
  'elo.js',
  'league.js',
  'perks.js',
  'mastery.js',
  'protocol.js',
  'index.js',
];

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

describe('backend/src/shared and mobile/src/shared are identical', () => {
  test('the mobile mirror exists', () => {
    assert.ok(
      fs.existsSync(MOBILE_SHARED),
      `mobile/src/shared is missing. It must mirror backend/src/shared exactly.`,
    );
  });

  for (const file of MIRRORED_FILES) {
    test(`${file} matches byte for byte`, () => {
      const backendFile = path.join(BACKEND_SHARED, file);
      const mobileFile = path.join(MOBILE_SHARED, file);

      assert.ok(fs.existsSync(backendFile), `backend/src/shared/${file} is missing`);
      assert.ok(fs.existsSync(mobileFile), `mobile/src/shared/${file} is missing`);

      assert.equal(
        sha(mobileFile),
        sha(backendFile),
        `mobile/src/shared/${file} has drifted from the backend copy.\n` +
          `These files are the client/server contract — scoring, Elo and the socket\n` +
          `protocol. Copy backend/src/shared/${file} over the mobile one, or edit both.`,
      );
    });
  }

  test('neither side has added a file the other lacks', () => {
    const backendFiles = fs.readdirSync(BACKEND_SHARED).filter((f) => f.endsWith('.js')).sort();
    const mobileFiles = fs.readdirSync(MOBILE_SHARED).filter((f) => f.endsWith('.js')).sort();
    assert.deepEqual(
      mobileFiles,
      backendFiles,
      'the two shared directories must contain exactly the same files',
    );
    assert.deepEqual(
      backendFiles,
      [...MIRRORED_FILES].sort(),
      'a new shared file was added — add it to MIRRORED_FILES in this test too',
    );
  });
});
