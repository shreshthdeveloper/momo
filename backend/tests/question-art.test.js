import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The seed's art keys against the client's drawn set.
 *
 * A question's picture travels as `mimo:art/<key>` — the same wire scheme a
 * topic cover uses — and the drawing lives in the mobile app. So the two halves
 * can drift silently: the seed writes a key, the client has no such emblem, and
 * `resolveQuestionArt` returns null. Nothing crashes and nothing is logged; the
 * question simply renders as text, on a round that reads "which emblem is
 * this?" with no emblem. That failure is invisible in every test that does not
 * look at both files at once, which is what this one is for.
 *
 * The same guard as shared-parity.test.js, and for the same reason: an
 * agreement kept in two repositories is a promise until something checks it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED = path.resolve(here, '../src/scripts/seed.js');
const QUESTION_ART = path.resolve(here, '../../mobile/src/components/QuestionArt.jsx');

/**
 * Keys the client can draw — the top-level entries of its `ART` map, which are
 * bare identifiers or quoted where they contain a hyphen.
 */
function clientArtKeys(source) {
  const body = source.slice(source.indexOf('export const ART = {'));
  const keys = new Set();
  for (const m of body.matchAll(/^ {2}'?([a-z][a-z0-9-]*)'?:\s*\{/gm)) keys.add(m[1]);
  return keys;
}

/**
 * Keys the seed writes — the optional sixth element of a question row.
 *
 * Anchored to the end of the line, which is what separates it from an option:
 * a row's art key closes the row (`'diya'],` then a newline) whereas the
 * options array closes mid-line and is followed by the correct index.
 */
function seededArtKeys(source) {
  const keys = new Set();
  for (const m of source.matchAll(/,\s*'([a-z][a-z0-9-]*)'\],\s*$/gm)) keys.add(m[1]);
  return keys;
}

describe('seeded question art resolves in the client', () => {
  const seed = fs.readFileSync(SEED, 'utf8');
  const client = fs.readFileSync(QUESTION_ART, 'utf8');

  test('the client art registry exists and is populated', () => {
    assert.ok(fs.existsSync(QUESTION_ART), 'mobile/src/components/QuestionArt.jsx is missing');
    assert.ok(clientArtKeys(client).size >= 10, 'the ART map looks empty — did the parse break?');
  });

  test('the seed actually uses picture questions', () => {
    assert.ok(
      seededArtKeys(seed).size >= 10,
      'no art keys found in the seed — either they were removed, or the row format changed and this test now checks nothing',
    );
  });

  test('every key the seed writes is one the client can draw', () => {
    const known = clientArtKeys(client);
    const used = seededArtKeys(seed);
    const orphans = [...used].filter((k) => !known.has(k));

    assert.deepEqual(
      orphans,
      [],
      `seed.js writes mimo:art/<key> for emblems the app cannot draw: ${orphans.join(', ')}.\n` +
        `Add them to ART in mobile/src/components/QuestionArt.jsx, or the question ships with no picture.`,
    );
  });
});
