import { progression } from '../services/progressionService.js';
import { triggerLabel as chestTriggerLabel } from '../services/chestService.js';
import { ACCOUNT_MAX_LEVEL, RANKED_FLOOR } from '../shared/constants.js';

const ok = (data) => ({ data });

/**
 * The progression config, as the app sees it (leagues-and-progression.md §9).
 *
 * This endpoint exists so a client can DRAW the ladder — name the leagues,
 * label a locked avatar with the level that opens it, show the XP bar's
 * ceiling. It is not there so a client can decide anything: the server sends
 * the level, the league and the ownership flags on every payload that needs
 * them, because the config a client holds may be a version behind.
 *
 * Unauthenticated on purpose. It is a price list — the sign-up avatar picker
 * needs it before there is an account to authenticate, and nothing in it is
 * specific to a player.
 */
export default async function configRoutes(app) {
  app.get(
    '/config/progression',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { token: { type: 'string', maxLength: 64 } },
        },
      },
    },
    async (request, reply) => {
      const { version, token, accountCurve, ladder, catalogue, chests, updatedAt } = progression();

      // A client already holding this exact config is told so and sends nothing
      // down the wire — the catalogue is the largest payload in the app and it
      // changes about as often as never. The token rather than the version:
      // see the note on `token` in progressionService.js.
      if (request.query?.token && request.query.token === token) {
        reply.header('cache-control', 'no-cache');
        return ok({ token, version, unchanged: true });
      }

      return ok({
        version,
        token,
        updatedAt,
        /** Total XP to reach each account level; index 0 is level 1, always 0. */
        accountCurve,
        maxAccountLevel: Math.min(ACCOUNT_MAX_LEVEL, accountCurve.length),
        leagues: ladder.leagues,
        divisions: ladder.divisions,
        divisionWidth: ladder.divisionWidth,
        ratingFloor: RANKED_FLOOR,
        /**
         * Disabled rows are withheld rather than sent with a flag: a client
         * that never hears about a withdrawn avatar cannot offer it, and the
         * players still wearing one are unaffected because an unknown key
         * resolves as theirs.
         */
        cosmetics: catalogue.filter((c) => c.enabled !== false),
        /** What is out there to be won, so the rewards screen can tease it. */
        chests: chests
          .filter((c) => c.enabled !== false)
          .map((c) => ({
            key: c.key,
            name: c.name,
            description: c.description,
            triggerKind: c.triggerKind,
            triggerRating: c.triggerRating,
            triggerLeague: c.triggerLeague,
            /**
             * What a player has to do to get it, in words.
             *
             * The shop's teaser cards read `triggerLabel` and it was only ever
             * put on a GRANT, so every not-yet-earned chest fell back to the
             * word "Locked" — a card naming no requirement at all, next to a
             * case whose foot told a rating-triggered chest to go and reach a
             * league. The label is a pure function of the trigger, so it is
             * computed in one place rather than assembled twice on two clients.
             */
            triggerLabel: chestTriggerLabel(c, ladder),
            recurrence: c.recurrence,
            period: c.period,
            /**
             * The contents, in full.
             *
             * The first cut withheld the keys, on the theory that knowing which
             * legendary was in the pool turned a reveal into a lookup. That was
             * wrong about where the drama is. A case you can look into is the
             * whole appeal of a case: the suspense is WHICH ONE, never what is
             * in there, and a chest described only as "two legendary slots" is
             * a chest nobody has a reason to want.
             *
             * The composition is still the odds — twenty slots, one drawn — so
             * publishing the list publishes the odds along with it.
             */
            slots: (c.rewards ?? []).map((r) => ({
              type: r.type,
              key: r.key,
              name: r.name,
              rarity: r.rarity,
              amount: r.amount,
            })),
          })),
      });
    },
  );
}
