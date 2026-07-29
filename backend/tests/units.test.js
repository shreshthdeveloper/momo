import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreAnswer,
  outcomeFor,
  verdictFor,
  accuracyOf,
  roundMultiplier,
  maxScoreForRounds,
} from '../src/shared/scoring.js';
import { expected, nextRating, ratingDelta, overallRatingFrom, ratingBandOf } from '../src/shared/elo.js';
import { xpForLevel, levelForXp, masteryProgress, xpForMatch } from '../src/shared/mastery.js';
import { difficultyMixFor } from '../src/game/questionSelector.js';
import { advanceStreak } from '../src/services/achievementService.js';
import { validateQuestionInput, itemAnalysisFor } from '../src/services/questionService.js';
import { parseCsv, toCsv } from '../src/services/csvService.js';
import { normalisePhone } from '../src/services/authService.js';
import { contentHashOf, randomOtp, randomJoinCode, shuffle } from '../src/lib/crypto.js';
import { isWithinQuietHours, isoWeekKey, istDateKey } from '../src/lib/dates.js';
import {
  BASE_POINTS,
  SPEED_MAX,
  MAX_MATCH_SCORE,
  ROUNDS_PER_MATCH,
  ELO_START,
  ELO_FLOOR,
  MASTERY_MAX_LEVEL,
} from '../src/shared/constants.js';

/** tech.md §13 — the unit row: scoring, Elo, difficulty mix, selection, streaks. */

describe('scoring (prd.md F6.4.14–F6.4.17)', () => {
  test('a wrong answer scores zero, with no negative marking', () => {
    assert.equal(scoreAnswer({ isCorrect: false, elapsedMs: 0, durationMs: 10_000 }), 0);
    assert.equal(scoreAnswer({ isCorrect: false, elapsedMs: 9_999, durationMs: 10_000 }), 0);
  });

  test('an instant correct answer scores the maximum', () => {
    assert.equal(
      scoreAnswer({ isCorrect: true, elapsedMs: 0, durationMs: 10_000 }),
      BASE_POINTS + SPEED_MAX,
    );
  });

  test('a correct answer at the buzzer still scores the base', () => {
    assert.equal(scoreAnswer({ isCorrect: true, elapsedMs: 10_000, durationMs: 10_000 }), BASE_POINTS);
    // Past the limit the speed bonus floors rather than going negative.
    assert.equal(scoreAnswer({ isCorrect: true, elapsedMs: 12_000, durationMs: 10_000 }), BASE_POINTS);
  });

  test('the speed bonus is proportional to time remaining', () => {
    assert.equal(scoreAnswer({ isCorrect: true, elapsedMs: 5_000, durationMs: 10_000 }), 30);
    assert.equal(scoreAnswer({ isCorrect: true, elapsedMs: 2_500, durationMs: 10_000 }), 35);
    assert.equal(scoreAnswer({ isCorrect: true, elapsedMs: 7_500, durationMs: 10_000 }), 25);
  });

  test('a perfect match totals exactly the documented maximum', () => {
    let total = 0;
    for (let i = 0; i < ROUNDS_PER_MATCH; i += 1) {
      total += scoreAnswer({
        isCorrect: true,
        elapsedMs: 0,
        durationMs: 10_000,
        multiplier: roundMultiplier(i, ROUNDS_PER_MATCH),
      });
    }
    assert.equal(total, MAX_MATCH_SCORE);
    // Six ordinary rounds at 40, then the bonus round at double.
    assert.equal(total, 320);
  });

  test('the closing round is the bonus round and pays double', () => {
    assert.equal(roundMultiplier(0, 7), 1);
    assert.equal(roundMultiplier(5, 7), 1);
    assert.equal(roundMultiplier(6, 7), 2);
    // A contest paper of twelve doubles its OWN last round, not round seven.
    assert.equal(roundMultiplier(6, 12), 1);
    assert.equal(roundMultiplier(11, 12), 2);

    assert.equal(
      scoreAnswer({ isCorrect: true, elapsedMs: 0, durationMs: 10_000, multiplier: 2 }),
      (BASE_POINTS + SPEED_MAX) * 2,
    );
    // Double the winnings, never a penalty — there is no negative marking.
    assert.equal(
      scoreAnswer({ isCorrect: false, elapsedMs: 0, durationMs: 10_000, multiplier: 2 }),
      0,
    );
  });

  test('the score rails run to a total that includes the bonus round', () => {
    assert.equal(maxScoreForRounds(ROUNDS_PER_MATCH), MAX_MATCH_SCORE);
    assert.equal(maxScoreForRounds(1), 80);
    assert.equal(maxScoreForRounds(0), 0);
  });

  test('scoring is monotonic — answering sooner is never worth less', () => {
    let previous = Infinity;
    for (let ms = 0; ms <= 10_000; ms += 250) {
      const points = scoreAnswer({ isCorrect: true, elapsedMs: ms, durationMs: 10_000 });
      assert.ok(points <= previous, `score rose at ${ms}ms`);
      previous = points;
    }
  });

  test('outcomes and verdicts agree', () => {
    assert.equal(outcomeFor(200, 100), 1);
    assert.equal(outcomeFor(100, 200), 0);
    assert.equal(outcomeFor(150, 150), 0.5);
    assert.equal(verdictFor(200, 100), 'won');
    assert.equal(verdictFor(100, 200), 'lost');
    assert.equal(verdictFor(150, 150), 'draw');
  });

  test('accuracy counts unanswered rounds as wrong', () => {
    assert.equal(accuracyOf([{ isCorrect: true }, { isCorrect: false }]), 0.5);
    assert.equal(accuracyOf([]), 0);
  });
});

describe('Elo (tech.md §9.3)', () => {
  test('equal ratings expect an even match', () => {
    assert.equal(expected(1200, 1200), 0.5);
  });

  test('a 400-point gap is roughly 10 to 1', () => {
    assert.ok(Math.abs(expected(1600, 1200) - 0.909) < 0.001);
  });

  test('beating a stronger opponent gains more than beating a weaker one', () => {
    const upset = ratingDelta(1200, 1600, 1);
    const routine = ratingDelta(1600, 1200, 1);
    assert.ok(upset > routine);
    assert.ok(upset > 25 && routine < 5);
  });

  test('the rating floor holds', () => {
    let rating = ELO_FLOOR;
    for (let i = 0; i < 50; i += 1) rating = nextRating(rating, 2000, 0);
    assert.equal(rating, ELO_FLOOR, 'a player cannot be driven below the floor');
  });

  test('a draw between equals moves nobody', () => {
    assert.equal(nextRating(1200, 1200, 0.5), 1200);
  });

  test('rating is zero-sum between equal opponents', () => {
    const winner = ratingDelta(1300, 1250, 1);
    const loser = ratingDelta(1250, 1300, 0);
    assert.equal(winner + loser, 0);
  });

  test('overall rating averages the five strongest topics', () => {
    assert.equal(overallRatingFrom([1500, 1400, 1300, 1200, 1100, 900, 800]), 1300);
    assert.equal(overallRatingFrom([1600, 1400]), 1500, 'fewer than five averages what exists');
    assert.equal(overallRatingFrom([]), ELO_START, 'a new profile does not read as zero');
  });

  test('rating bands bucket by hundreds', () => {
    assert.equal(ratingBandOf(1200), 12);
    assert.equal(ratingBandOf(1299), 12);
    assert.equal(ratingBandOf(1300), 13);
  });
});

describe('mastery (prd.md F6.5.2)', () => {
  test('levels start at 1 and cap at 50', () => {
    assert.equal(levelForXp(0), 1);
    assert.equal(levelForXp(-100), 1);
    assert.equal(levelForXp(10 ** 9), MASTERY_MAX_LEVEL);
  });

  test('higher levels take progressively longer', () => {
    const cost = (l) => xpForLevel(l + 1) - xpForLevel(l);
    for (let l = 1; l < MASTERY_MAX_LEVEL - 1; l += 1) {
      assert.ok(cost(l + 1) > cost(l), `level ${l + 1} must cost more than ${l}`);
    }
  });

  test('level and xp round-trip', () => {
    for (let level = 1; level <= MASTERY_MAX_LEVEL; level += 1) {
      assert.equal(levelForXp(xpForLevel(level)), level, `level ${level}`);
      if (level > 1) assert.equal(levelForXp(xpForLevel(level) - 1), level - 1);
    }
  });

  test('progress through a level is a sane fraction', () => {
    const p = masteryProgress(xpForLevel(5) + 10);
    assert.equal(p.level, 5);
    assert.ok(p.fraction > 0 && p.fraction < 1);
    assert.equal(masteryProgress(xpForLevel(MASTERY_MAX_LEVEL)).fraction, 1);
  });

  test('XP is earned for losing too — mastery is progression, not skill', () => {
    const lost = xpForMatch({ verdict: 'lost', correctCount: 0 });
    assert.ok(lost > 0, 'showing up always counts');
    assert.ok(xpForMatch({ verdict: 'won', correctCount: 7 }) > lost);
    assert.ok(
      xpForMatch({ verdict: 'draw', correctCount: 3 }) > xpForMatch({ verdict: 'lost', correctCount: 3 }),
    );
  });
});

describe('difficulty mix (prd.md F6.4.6)', () => {
  test('every mix sums to the round count', () => {
    for (const rating of [700, 999, 1000, 1199, 1200, 1399, 1400, 1599, 1600, 2400]) {
      const mix = difficultyMixFor(rating);
      const total = mix.easy + mix.medium + mix.hard;
      assert.equal(total, ROUNDS_PER_MATCH, `rating ${rating} produced ${total} questions`);
    }
  });

  test('the mix weights harder as skill rises', () => {
    assert.ok(difficultyMixFor(2000).hard > difficultyMixFor(900).hard);
    assert.ok(difficultyMixFor(900).easy > difficultyMixFor(2000).easy);
  });
});

describe('streaks (prd.md F6.5.5)', () => {
  const at = (iso) => new Date(iso);

  test('a first match starts a streak of one', () => {
    const next = advanceStreak(null, at('2026-07-25T12:00:00Z'));
    assert.equal(next.current, 1);
    assert.equal(next.longest, 1);
  });

  test('consecutive days extend it', () => {
    const day1 = advanceStreak(null, at('2026-07-25T12:00:00Z'));
    const day2 = advanceStreak(day1, at('2026-07-26T12:00:00Z'));
    assert.equal(day2.current, 2);
    assert.equal(day2.longest, 2);
  });

  test('a second match the same IST day does not double count', () => {
    // 12:00Z is 17:30 IST and 16:00Z is 21:30 IST — both the evening of the
    // 25th, which is when this audience plays. (19:30Z would already be the
    // 26th in IST, and correctly starts a new day.)
    const first = advanceStreak(null, at('2026-07-25T12:00:00Z'));
    const again = advanceStreak(first, at('2026-07-25T16:00:00Z'));
    assert.equal(again.current, 1);
    assert.equal(again.changed, false);

    const pastMidnightIst = advanceStreak(first, at('2026-07-25T19:30:00Z'));
    assert.equal(pastMidnightIst.current, 2, 'past midnight IST is a new day');
  });

  test('a missed day resets the current streak but keeps the longest', () => {
    const day1 = advanceStreak(null, at('2026-07-25T12:00:00Z'));
    const day2 = advanceStreak(day1, at('2026-07-26T12:00:00Z'));
    const later = advanceStreak(day2, at('2026-07-29T12:00:00Z'));
    assert.equal(later.current, 1);
    assert.equal(later.longest, 2);
  });

  test('a late-evening IST session counts as that day, not the next', () => {
    // 23:30 IST on the 25th is 18:00 UTC on the 25th. A UTC-day implementation
    // would be fine here, but 01:00 IST on the 26th is 19:30 UTC on the 25th —
    // and that must count as the 26th.
    assert.equal(istDateKey(at('2026-07-25T19:30:00Z')), '2026-07-26');
    assert.equal(istDateKey(at('2026-07-25T18:00:00Z')), '2026-07-25');
  });
});

describe('question validation (prd.md §10.2)', () => {
  const good = {
    text: 'Which element has the atomic number 26?',
    options: ['Iron', 'Copper', 'Zinc', 'Nickel'],
    correctIndex: 0,
    difficulty: 'medium',
    topicIds: ['64b7f0000000000000000001'],
  };

  test('a well-formed question passes', () => {
    const result = validateQuestionInput(good);
    assert.equal(result.valid, true);
    assert.equal(result.problems.length, 0);
  });

  test('"all of the above" is rejected', () => {
    const result = validateQuestionInput({ ...good, options: ['Iron', 'Copper', 'Zinc', 'All of the above'] });
    assert.equal(result.valid, false);
    assert.ok(result.problems.some((p) => p.problem.includes('all of the above')));
  });

  test('duplicate options are rejected', () => {
    const result = validateQuestionInput({ ...good, options: ['Iron', 'Iron', 'Zinc', 'Nickel'] });
    assert.equal(result.valid, false);
  });

  test('a question over 200 characters is rejected at authoring time', () => {
    const result = validateQuestionInput({ ...good, text: 'x'.repeat(201) });
    assert.equal(result.valid, false);
  });

  test('a question over 140 characters warns about the smaller type size', () => {
    const result = validateQuestionInput({ ...good, text: `${'x'.repeat(150)}?` });
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some((w) => w.field === 'text'));
  });

  test('a conspicuously longer correct option warns — it is a tell', () => {
    const result = validateQuestionInput({
      ...good,
      options: ['The complete and carefully qualified correct answer', 'Iron', 'Zinc', 'Tin'],
      correctIndex: 0,
    });
    assert.equal(result.valid, true, 'a warning, not an error');
    assert.ok(result.warnings.some((w) => w.field === 'options.0'));
  });

  test('exactly one correct option must be marked, in range', () => {
    assert.equal(validateQuestionInput({ ...good, correctIndex: 4 }).valid, false);
    assert.equal(validateQuestionInput({ ...good, correctIndex: -1 }).valid, false);
    assert.equal(validateQuestionInput({ ...good, correctIndex: undefined }).valid, false);
  });

  test('exactly four options are required', () => {
    assert.equal(validateQuestionInput({ ...good, options: ['a', 'b', 'c'] }).valid, false);
    assert.equal(validateQuestionInput({ ...good, options: ['a', 'b', 'c', 'd', 'e'] }).valid, false);
  });
});

describe('item analysis (prd.md F8.2.10)', () => {
  const build = (optionCounts, correctIndex = 0, served = 100) => ({
    correctIndex,
    stats: { served, optionCounts, avgResponseMs: 4200, timeoutCount: 4 },
  });

  test('a small sample is not flagged', () => {
    assert.equal(itemAnalysisFor(build([1, 1, 1, 1], 0, 4)).flag, null);
  });

  test('under 20% choosing the marked answer flags a suspect key', () => {
    const result = itemAnalysisFor(build([10, 60, 20, 10]));
    assert.equal(result.flag, 'suspect_key');
    assert.ok(result.flagLabel.includes('Check the key'));
  });

  test('over 95% choosing it flags a question that no longer discriminates', () => {
    assert.equal(itemAnalysisFor(build([98, 1, 1, 0])).flag, 'too_easy');
  });

  test('a healthy spread is not flagged', () => {
    assert.equal(itemAnalysisFor(build([55, 20, 15, 10])).flag, null);
  });

  test('the option distribution sums to about 100%', () => {
    const result = itemAnalysisFor(build([40, 30, 20, 10]));
    const total = result.optionDistribution.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 100) < 0.5);
  });
});

describe('CSV (prd.md F8.2.5)', () => {
  test('quoted fields, embedded commas and escaped quotes parse', () => {
    const rows = parseCsv('a,b\n"one, two","he said ""hi"""\n');
    assert.deepEqual(rows[1], ['one, two', 'he said "hi"']);
  });

  test('CRLF and a UTF-8 BOM from Excel are handled', () => {
    const rows = parseCsv('﻿q,a\r\nhello,world\r\n');
    assert.deepEqual(rows[0], ['q', 'a']);
    assert.deepEqual(rows[1], ['hello', 'world']);
  });

  test('blank lines are skipped', () => {
    assert.equal(parseCsv('a,b\n\n1,2\n\n').length, 2);
  });

  test('writing then reading round-trips values that need quoting', () => {
    const csv = toCsv(['name', 'note'], [{ name: 'A, B', note: 'say "hi"' }]);
    const rows = parseCsv(csv);
    assert.deepEqual(rows[1], ['A, B', 'say "hi"']);
  });
});

describe('phone normalisation', () => {
  test('accepts the forms Indian users actually type', () => {
    for (const input of ['9876543210', '09876543210', '+91 98765 43210', '919876543210', '+91-98765-43210']) {
      assert.equal(normalisePhone(input), '+919876543210', input);
    }
  });

  test('rejects numbers that cannot be Indian mobiles', () => {
    for (const bad of ['1234567890', '98765', '', '5876543210', 'abcdefghij']) {
      assert.throws(() => normalisePhone(bad), /mobile number|Enter your mobile/, `should reject ${bad}`);
    }
  });
});

describe('crypto helpers', () => {
  test('content hashing ignores case, punctuation and whitespace', () => {
    const a = contentHashOf('Who wrote Hamlet?', ['Shakespeare', 'Marlowe', 'Jonson', 'Kyd']);
    const b = contentHashOf('  who   wrote hamlet ', ['shakespeare', 'MARLOWE', 'Jonson', 'Kyd']);
    assert.equal(a, b, 'near-identical questions collide, which is what F8.2.7 needs');
  });

  test('content hashing ignores option order', () => {
    const a = contentHashOf('Q?', ['a', 'b', 'c', 'd']);
    const b = contentHashOf('Q?', ['d', 'c', 'b', 'a']);
    assert.equal(a, b);
  });

  test('different questions hash differently', () => {
    assert.notEqual(contentHashOf('Q1?', ['a', 'b', 'c', 'd']), contentHashOf('Q2?', ['a', 'b', 'c', 'd']));
  });

  test('OTPs are always six digits', () => {
    for (let i = 0; i < 200; i += 1) assert.match(randomOtp(), /^\d{6}$/);
  });

  test('join codes avoid characters that are ambiguous when read aloud', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = randomJoinCode(6);
      assert.equal(code.length, 6);
      assert.ok(!/[O0I1]/.test(code), `${code} contains an ambiguous character`);
    }
  });

  test('shuffle preserves every element', () => {
    const input = [0, 1, 2, 3];
    for (let i = 0; i < 50; i += 1) {
      assert.deepEqual([...shuffle(input)].sort(), input);
    }
  });
});

describe('dates', () => {
  test('quiet hours that wrap midnight work', () => {
    // The 22:00–08:00 default is the case a naive comparison gets wrong.
    assert.equal(isWithinQuietHours('23:30', '22:00', '08:00'), true);
    assert.equal(isWithinQuietHours('02:00', '22:00', '08:00'), true);
    assert.equal(isWithinQuietHours('07:59', '22:00', '08:00'), true);
    assert.equal(isWithinQuietHours('08:00', '22:00', '08:00'), false);
    assert.equal(isWithinQuietHours('14:00', '22:00', '08:00'), false);
  });

  test('quiet hours inside one day work too', () => {
    assert.equal(isWithinQuietHours('14:00', '13:00', '15:00'), true);
    assert.equal(isWithinQuietHours('16:00', '13:00', '15:00'), false);
  });

  test('ISO week keys are well formed', () => {
    assert.match(isoWeekKey(new Date('2026-07-25T12:00:00Z')), /^\d{4}-W\d{2}$/);
    assert.equal(isoWeekKey(new Date('2026-01-01T12:00:00Z')).slice(0, 4).length, 4);
  });
});
