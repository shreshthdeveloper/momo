/**
 * Dates are handled in IST throughout.
 *
 * The audience is in India and plays in the evening. A streak has to mean a
 * calendar day where the player lives, not a rolling 24 hours and not a UTC
 * day that rolls over at 05:30 local — which would break a streak mid-session
 * for anyone playing late.
 */

const IST_OFFSET_MINUTES = 330;

/** `YYYY-MM-DD` in IST. */
export function istDateKey(date = new Date()) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

export function istYesterdayKey(date = new Date()) {
  return istDateKey(new Date(date.getTime() - 24 * 60 * 60 * 1000));
}

/** ISO week bucket, `2026-W30`. */
export function isoWeekKey(date = new Date()) {
  const d = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNumber = (target.getUTCDay() + 6) % 7; // Monday = 0
  target.setUTCDate(target.getUTCDate() - dayNumber + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
  const week = 1 + Math.round((target - firstThursday) / (7 * 24 * 60 * 60 * 1000));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Month bucket, `2026-07`. */
export function monthKey(date = new Date()) {
  return istDateKey(date).slice(0, 7);
}

/** Inclusive start / exclusive end of a period, as UTC Dates. */
export function periodRange(period, date = new Date()) {
  const now = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  const toUtc = (d) => new Date(d.getTime() - IST_OFFSET_MINUTES * 60_000);

  if (period === 'week') {
    const dayNumber = (now.getUTCDay() + 6) % 7;
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayNumber),
    );
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    return { start: toUtc(start), end: toUtc(end) };
  }
  if (period === 'month') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { start: toUtc(start), end: toUtc(end) };
  }
  return { start: new Date(0), end: new Date(8.64e15) };
}

/** Local `HH:MM` in IST, for quiet-hours checks. */
export function istClockTime(date = new Date()) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(11, 16);
}

/**
 * Quiet hours wrap midnight, so a plain `start <= now < end` comparison is
 * wrong for the common 22:00–08:00 default.
 */
export function isWithinQuietHours(now, start, end) {
  if (!start || !end) return false;
  if (start === end) return false;
  if (start < end) return now >= start && now < end;
  return now >= start || now < end;
}
