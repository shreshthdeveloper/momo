/**
 * The streak, read on the client.
 *
 * `user.streak.lastPlayedOn` is a `YYYY-MM-DD` key the server writes in IST
 * (backend `src/lib/dates.js`), so the only thing the client has to do is
 * decide whether that key is today's — which is a string comparison, not a
 * date calculation, and therefore cannot drift from the server's answer.
 *
 * IST rather than the device clock on purpose. The audience is in India and
 * plays in the evening; a UTC day rolls over at 05:30 local and would break a
 * streak mid-session for anyone playing late.
 */
const IST_OFFSET_MINUTES = 330;

/** `YYYY-MM-DD` in IST — the same key the server stores. */
export function istDateKey(date = new Date()) {
  return new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/**
 * What Home needs to know, in one shape.
 *
 * `atRisk` is the interesting state: a streak that is alive but has not been
 * fed today. That is the only day the card has anything to ask for, and it is
 * why the card exists at all.
 */
export function streakState(streak) {
  const current = streak?.current ?? 0;
  const longest = streak?.longest ?? 0;
  const playedToday = Boolean(streak?.lastPlayedOn) && streak.lastPlayedOn === istDateKey();

  return {
    current,
    longest,
    playedToday,
    atRisk: current > 0 && !playedToday,
    /** A record only becomes worth mentioning once it is not the current run. */
    showsBest: longest > current && longest > 1,
  };
}
