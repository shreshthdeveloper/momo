import { User, Space, Match, Chest, ProgressionConfig } from '../models/index.js';
import { rebuildPeriodSnapshot } from './leaderboardService.js';
import { ensureMonthlyChests, clearStaleChestGrants, currentPeriod } from './chestService.js';
import { monthKey, periodRange } from '../lib/dates.js';
import { logger } from '../lib/logger.js';
import { RANKED_FLOOR, RANKED_SOFT_RESET_PULL, RANKED_START } from '../shared/constants.js';

/**
 * The month turns over (coins-and-cosmetics.md §5).
 *
 * One job, on the 1st, doing four things in an order that matters:
 *
 *   1. archive the month that just ended, while the matches still describe it
 *   2. soft-reset every ranked rating halfway toward the start
 *   3. roll two fresh chests from the catalogue
 *   4. clear last month's unopened chests
 *
 * The archive goes first because the soft reset rewrites the ratings the
 * standings are read against. Clearing goes last because a player whose chest
 * is deleted should already have this month's waiting for them.
 *
 * This is the reason to come back, and it is the only thing in the product that
 * takes something away — a rating, halfway. Everything else only ever adds.
 */

/**
 * `next = 1200 + (current − 1200) × 0.5`, floored at the rating floor.
 *
 * Halfway rather than all the way, because a Black player made to grind up from
 * 1200 every month simply stops, and no reset at all leaves the chests won once
 * and never again. Strong players re-reach Gold in a few wins and Diamond in a
 * real month's climb; weak players are lifted off the floor rather than pinned
 * to it for ever.
 *
 * Done as a single aggregation-pipeline update rather than a cursor: it touches
 * every account in the database, and a hundred thousand round trips on the 1st
 * of the month is a self-inflicted outage.
 */
export async function softResetRatings() {
  const result = await User.updateMany({ rankedRating: { $ne: RANKED_START } }, [
    {
      $set: {
        rankedRating: {
          $max: [
            RANKED_FLOOR,
            {
              $round: [
                {
                  $add: [
                    RANKED_START,
                    {
                      $multiply: [
                        { $subtract: [{ $ifNull: ['$rankedRating', RANKED_START] }, RANKED_START] },
                        RANKED_SOFT_RESET_PULL,
                      ],
                    },
                  ],
                },
                0,
              ],
            },
          ],
        },
      },
    },
  ]);
  return { reset: result.modifiedCount };
}

/**
 * Write the finished month's standings down before the ratings move.
 *
 * `at` is a moment INSIDE the month being archived, not the month the job is
 * running in — the job fires just after midnight on the 1st, so "now" is
 * already the wrong month by the time it reads the clock.
 */
export async function archiveMonth({ at } = {}) {
  const when = at ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const spaces = await Space.find({ status: 'active' }, { _id: 1 }).lean();
  let built = 0;

  const { start, end } = periodRange('month', when);

  for (const space of spaces) {
    const scope = { spaceId: space._id, isPublic: false };
    await rebuildPeriodSnapshot({
      scope,
      topicId: null,
      scopeType: 'global',
      period: 'month',
      at: when,
    })
      .then(() => {
        built += 1;
      })
      .catch((err) => logger.warn({ err, spaceId: String(space._id) }, 'month archive failed'));

    const played = await Match.distinct('topicId', {
      spaceId: space._id,
      completedAt: { $gte: start, $lt: end },
    });
    for (const topicId of played.slice(0, 100)) {
      await rebuildPeriodSnapshot({ scope, topicId, scopeType: 'global', period: 'month', at: when })
        .then(() => {
          built += 1;
        })
        .catch(() => {});
    }
  }
  return { archived: built, month: monthKey(when) };
}

/**
 * The whole turnover, in order. Idempotent enough to re-run: the archive
 * rewrites the same snapshot, the roll replaces the same two chests, and the
 * clear finds nothing the second time.
 *
 * The soft reset is the one step that is NOT idempotent — running it twice
 * would halve every rating twice — so it is guarded on the period having
 * actually changed, recorded by the caller.
 */
export async function runMonthlyCycle({ softReset = true, at } = {}) {
  const period = currentPeriod();

  /**
   * Claim the month BEFORE the one step that cannot be repeated.
   *
   * The soft reset halves every rating on the platform, and the marker saying
   * "this month is done" used to be written after it — so a crash or a deploy
   * in the window between the two left the month looking un-run, and the next
   * tick halved every rating a second time (1400 → 1300 → 1250). A ladder-wide
   * corruption, once a month, in a narrow but entirely real window.
   *
   * Claiming first inverts the risk: a crash after the claim leaves the archive
   * or the chest roll undone, and both of those are idempotent and repaired by
   * the next boot (`ensureMonthlyChests` runs there too). Losing a repeatable
   * step is recoverable; halving everybody twice is not.
   */
  if (softReset && !(await claimPeriod(period))) {
    logger.info({ period }, 'monthly cycle already claimed — not running it twice');
    return { period, ran: false, archived: 0, reset: 0, expired: 0 };
  }

  const archived = await archiveMonth({ at });
  const reset = softReset ? await softResetRatings() : { reset: 0 };
  const chests = await ensureMonthlyChests({ period });
  const cleared = await clearStaleChestGrants({ period });
  if (!softReset) await stampCycled(period);

  logger.info({ period, ...archived, ...reset, ...cleared }, 'monthly cycle complete');
  return { period, ...archived, ...reset, chests, ...cleared };
}

/**
 * Take the month, if nobody else has it.
 *
 * One conditional update, so two processes racing on the 1st cannot both win:
 * the filter only matches while the stored period is something else, and the
 * loser's update modifies nothing.
 */
async function claimPeriod(period) {
  const result = await ProgressionConfig.updateOne(
    { singleton: 'progression', lastCycledPeriod: { $ne: period } },
    { $set: { lastCycledPeriod: period } },
    { upsert: true },
  ).catch((err) => {
    // Upserting against a filter two callers both match races on the unique
    // singleton index; the duplicate key IS the other caller having won.
    if (err?.code === 11000) return { modifiedCount: 0, upsertedCount: 0 };
    throw err;
  });
  return Boolean(result.modifiedCount || result.upsertedCount);
}

/** Record that `period` has had its turnover. */
async function stampCycled(period) {
  await ProgressionConfig.updateOne(
    { singleton: 'progression' },
    { $set: { lastCycledPeriod: period } },
    { upsert: true },
  );
}

/**
 * Has the month turned over since the last run?
 *
 * The record is `lastCycledPeriod` on the progression config, written by the
 * cycle itself. It used to be inferred from any chest carrying the current
 * period, which the boot-time roll also writes — so a restart on the 1st before
 * the job's first tick marked the month done without archiving, resetting or
 * clearing anything, and the month was then skipped entirely. The two steps now
 * keep separate records because they are separate promises.
 *
 * Checked hourly instead of fired at a precise minute: a job that only exists
 * for one minute a month is a job a deploy window can delete, and an install
 * that was DOWN over the 1st still runs the turnover the moment it returns.
 */
export async function runMonthlyCycleIfDue() {
  const period = currentPeriod();
  const config = await ProgressionConfig.findOne(
    { singleton: 'progression' },
    { lastCycledPeriod: 1 },
  ).lean();

  if (config?.lastCycledPeriod === period) return { period, ran: false };

  /**
   * First tick after this record existed. Chests already rolled for this month
   * are the old record saying the turnover happened, so adopt it rather than
   * soft-resetting every rating in the middle of a month on the release that
   * introduced the field.
   */
  if (!config?.lastCycledPeriod) {
    const rolled = await Chest.countDocuments({ period });
    if (rolled > 0) {
      await stampCycled(period);
      logger.info({ period }, 'adopting the current period — chests already rolled');
      return { period, ran: false, adopted: true };
    }
  }

  logger.info({ period }, 'month rolled over — running the cycle');
  const result = await runMonthlyCycle();
  return { ...result, ran: true };
}
