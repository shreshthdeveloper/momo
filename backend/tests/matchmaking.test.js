import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Matchmaker } from '../src/game/matchmaker.js';
import { LEVEL_BAND_MAX, LEVEL_BAND_STEP_MS, GHOST_AFTER_MS } from '../src/shared/constants.js';

/**
 * Level-based pairing (leagues-and-progression.md §7).
 *
 * The matchmaker is a pure in-process object, so these drive it directly rather
 * than through a socket — the point under test is the band arithmetic, and a
 * full match would only add latency to it.
 *
 * Timings are compressed: a 20ms step and a 200ms deadline exercise exactly the
 * same code paths as the 1.2s/8s the product ships with, and the last test
 * pins those shipped values so a careless edit to constants.js is caught here.
 */

/** A queue entry with only the fields pairing reads. */
const player = (id, level, extra = {}) => ({
  userId: id,
  level,
  rating: 1200,
  topicId: 't1',
  spaceId: 's1',
  displayName: id,
  ...extra,
});

/**
 * A matchmaker that records what happened. `tickMs` is deliberately smaller
 * than `bandStepMs` so a band never skips a width between passes.
 */
function harness({ bandStepMs = 20, ghostAfterMs = 200, tickMs = 5 } = {}) {
  const paired = [];
  const ghosted = [];
  const mm = new Matchmaker({
    onPair: (a, b) => paired.push([a.userId, b.userId]),
    onGhost: (w) => ghosted.push(w.userId),
    bandStepMs,
    ghostAfterMs,
    tickMs,
  });
  return { mm, paired, ghosted };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('pairing runs on the topic level', () => {
  test('two players at the same level pair on arrival', () => {
    const { mm, paired } = harness();
    assert.equal(mm.join(player('a', 5)), 'queued', 'the first has nobody to meet');
    assert.equal(mm.join(player('b', 5)), 'paired', 'the second finds them at once');
    assert.deepEqual(paired, [['a', 'b']]);
    mm.clear();
  });

  test('a level gap does not pair on arrival — the band opens at zero', () => {
    const { mm, paired } = harness();
    mm.join(player('a', 3));
    assert.equal(mm.join(player('b', 4)), 'queued', 'one level apart is still not the same level');
    assert.equal(paired.length, 0);
    mm.clear();
  });

  test('the band widens until the gap fits', async () => {
    const { mm, paired } = harness({ bandStepMs: 20 });
    mm.join(player('a', 2));
    mm.join(player('b', 5)); // three levels apart — needs the band at 3

    await wait(40);
    assert.equal(paired.length, 0, 'still too far apart after one step');

    await wait(60);
    assert.deepEqual(paired, [['a', 'b']], 'paired once the band reached 3');
    mm.clear();
  });

  test('the cap is hard: past it a ghost is served instead of a bad match', async () => {
    const { mm, paired, ghosted } = harness({ bandStepMs: 10, ghostAfterMs: 150 });
    mm.join(player('a', 1));
    mm.join(player('b', 1 + LEVEL_BAND_MAX + 1));

    await wait(250);
    assert.equal(paired.length, 0, 'a level 1 is never fed to a level 7');
    assert.deepEqual(ghosted.sort(), ['a', 'b'], 'both took a ghost rather than each other');
    mm.clear();
  });

  test('exactly at the cap they do pair', async () => {
    const { mm, paired, ghosted } = harness({ bandStepMs: 10, ghostAfterMs: 400 });
    mm.join(player('a', 1));
    mm.join(player('b', 1 + LEVEL_BAND_MAX));

    await wait(250);
    assert.deepEqual(paired, [['a', 'b']], 'the cap is inclusive');
    assert.equal(ghosted.length, 0);
    mm.clear();
  });

  test('the longer waiter’s band reaches a newcomer whose own band is still shut', async () => {
    const { mm, paired } = harness({ bandStepMs: 20, ghostAfterMs: 1000 });
    mm.join(player('a', 10));
    await wait(90); // a's band is now ~4

    // b arrives with a band of 0. Pairing takes the WIDER of the two, so a's
    // patience is what buys this match — otherwise the person who has waited
    // longest is the one a newcomer can never be matched to.
    mm.join(player('b', 13));
    await wait(40);
    assert.deepEqual(paired, [['a', 'b']]);
    mm.clear();
  });

  test('a player with no rating row on the topic is level 1, not level 0', () => {
    const { mm, paired } = harness();
    mm.join(player('a', 1));
    const b = player('b', undefined);
    delete b.level;
    assert.equal(mm.join(b), 'paired', 'an unplayed topic pools with the other beginners');
    assert.deepEqual(paired, [['a', 'b']]);
    mm.clear();
  });

  test('rating is ignored entirely — only the level decides', () => {
    const { mm, paired } = harness();
    mm.join(player('a', 4, { rating: 900 }));
    assert.equal(
      mm.join(player('b', 4, { rating: 2100 })),
      'paired',
      '1200 points of rating apart, same level, still a match',
    );
    assert.deepEqual(paired, [['a', 'b']]);
    mm.clear();
  });

  test('separate topics never pool together', () => {
    const { mm, paired } = harness();
    mm.join(player('a', 5, { topicId: 'python' }));
    assert.equal(mm.join(player('b', 5, { topicId: 'mysql' })), 'queued');
    assert.equal(paired.length, 0);
    mm.clear();
  });
});

describe('the shipped timings', () => {
  test('the band reaches its cap with time left before the ghost deadline', () => {
    const timeToCap = LEVEL_BAND_MAX * LEVEL_BAND_STEP_MS;
    assert.ok(
      timeToCap < GHOST_AFTER_MS,
      `the band must finish opening before the ghost fires (${timeToCap}ms vs ${GHOST_AFTER_MS}ms)`,
    );
    // Widening that only completes as the deadline hits would mean the widest
    // band never actually gets a pass to find anyone.
    assert.ok(
      GHOST_AFTER_MS - timeToCap >= LEVEL_BAND_STEP_MS,
      'the full-width band needs at least one step of its own to pair in',
    );
  });
});

/**
 * Human-only queueing.
 *
 * A ghost always arrives, and F6.7.5 forbids the app from saying so — which
 * makes "did those two phones pair with each other?" a question the product
 * deliberately cannot answer. Refusing ghosts is how it becomes answerable:
 * the wait simply continues until a real opponent turns up.
 */
describe('a player who refuses ghosts waits for a human', () => {
  test('the ghost deadline does not apply to them', async () => {
    const { mm, paired, ghosted } = harness({ ghostAfterMs: 50 });
    mm.join(player('a', 3, { allowGhosts: false }));

    await wait(200); // four deadlines' worth
    assert.equal(ghosted.length, 0, 'no ghost was served');
    assert.equal(paired.length, 0);
    assert.ok(mm.isQueued('a'), 'still searching');

    mm.join(player('b', 3, { allowGhosts: false }));
    assert.deepEqual(paired, [['a', 'b']], 'the human who eventually arrived paired');
    mm.clear();
  });

  test('a ghost-taker beside them is still served on time', async () => {
    const { mm, ghosted } = harness({ ghostAfterMs: 50 });
    mm.join(player('holdout', 9, { allowGhosts: false }));
    mm.join(player('ordinary', 1));

    await wait(200);
    assert.deepEqual(ghosted, ['ordinary'], 'only the one who accepts ghosts got one');
    assert.ok(mm.isQueued('holdout'));
    mm.clear();
  });

  test('the sweep gives up eventually, and says so rather than hanging', async () => {
    const expired = [];
    const mm = new Matchmaker({
      onExpire: (w) => expired.push(w.userId),
      bandStepMs: 20,
      ghostAfterMs: 50,
      humanOnlySweepAfterMs: 120,
      tickMs: 5,
    });
    mm.join(player('a', 3, { allowGhosts: false }));

    await wait(250);
    assert.deepEqual(expired, ['a'], 'the player was told the search ended');
    assert.equal(mm.isQueued('a'), false, 'and was removed from the pool');
    mm.clear();
  });
});
