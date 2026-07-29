import { StyleSheet, View } from 'react-native';
import { Text } from './ui.jsx';
import { leagueFor, nextLeagueLabel } from '../lib/league.js';
import { colors, fonts, layout, space } from '../theme/index.js';

/**
 * The league badge — the face of a player's standing
 * (leagues-and-progression.md §7).
 *
 * A league is a band of the ranked rating, so this component takes the RATING
 * and derives everything: there is no league prop to pass around and nothing
 * that can disagree with the number it came from.
 *
 * Each league carries its own metal. Black is the exception — it inverts, so
 * the top of the ladder reads as a different kind of thing rather than just
 * another colour.
 */
/**
 * Each league carries its own metal: `ink` is the lettering, `soft` the plate
 * it is struck on, `edge` the rim.
 *
 * The plate is deliberately dense rather than a 16% wash. The first version of
 * this badge was a fully-rounded pill with a 1px outline, a near-transparent
 * fill and a coloured dot — four weak signals stacked, which is precisely the
 * recipe for something that looks cheap. Weight comes from one strong surface,
 * not from several faint ones.
 */
const METAL = {
  bronze: { ink: '#E0A46A', soft: 'rgba(201, 139, 87, 0.20)', edge: 'rgba(224, 164, 106, 0.38)' },
  silver: { ink: '#C8CFDE', soft: 'rgba(175, 182, 198, 0.18)', edge: 'rgba(200, 207, 222, 0.38)' },
  gold: { ink: '#F5B62E', soft: 'rgba(245, 182, 46, 0.18)', edge: 'rgba(245, 182, 46, 0.42)' },
  diamond: { ink: '#7FE0E4', soft: 'rgba(92, 209, 214, 0.18)', edge: 'rgba(127, 224, 228, 0.40)' },
  black: { ink: '#F2F1F8', soft: 'rgba(242, 241, 248, 0.12)', edge: 'rgba(242, 241, 248, 0.34)' },
};

/** `#F5B62E` → `rgba(245, 182, 46, α)`. */
function tint(hex, alpha) {
  const value = String(hex ?? '').replace('#', '');
  if (value.length !== 6) return null;
  const n = Number.parseInt(value, 16);
  if (!Number.isFinite(n)) return null;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * The metal a band is struck in.
 *
 * The served colour wins, because league keys are editable: a ladder renamed
 * to Emerald arrives with its own hex and must not fall back to bronze just
 * because no table here recognised the name. The map below is what a client
 * uses before its first config fetch, and nothing more.
 */
export function leagueMetal(key, color) {
  const soft = tint(color, 0.18);
  if (soft) return { ink: color, soft, edge: tint(color, 0.4) };
  return METAL[key] ?? METAL.bronze;
}

/**
 * @param {object} props
 * @param {number} props.rating   the ranked rating
 * @param {'sm'|'md'|'lg'} props.size
 * @param {boolean} props.showDivision  "Gold II" vs plain "Gold"
 */
const ROMAN = ['I', 'II', 'III'];

export function LeagueBadge({ rating, league: served, size = 'md', showDivision = true, style }) {
  // The server's band when it sent one — the ladder is editable, so its name
  // and floors are not something a cached copy can be trusted to reproduce.
  const league = served ?? leagueFor(rating);
  const metal = leagueMetal(league.key, league.color);
  const height = size === 'sm' ? 22 : size === 'lg' ? 32 : 26;
  const fontSize = size === 'sm' ? 10 : size === 'lg' ? 13 : 11;
  /**
   * The top league has no divisions, so there is no numeral to strike. Guarded
   * against a ladder configured with more divisions than there are numerals:
   * `ROMAN[3]` is undefined, which renders nothing at all where a numeral
   * belongs while the label elsewhere still says "Silver IV".
   */
  const division =
    showDivision && !league.isTop ? (ROMAN[league.division - 1] ?? String(league.division)) : null;

  return (
    <View
      style={[
        styles.badge,
        { height, backgroundColor: metal.soft, borderColor: metal.edge },
        style,
      ]}
      accessibilityLabel={`League ${league.label}`}
    >
      <Text allowFontScaling={false} style={[styles.name, { fontSize, color: metal.ink }]}>
        {league.name.toUpperCase()}
      </Text>
      {division ? (
        <>
          {/* A hairline in the metal, so the plate reads as struck in two
              fields rather than as a word with a stray numeral after it. */}
          <View style={[styles.rule, { backgroundColor: metal.edge }]} />
          <Text allowFontScaling={false} style={[styles.division, { fontSize, color: metal.ink }]}>
            {division}
          </Text>
        </>
      ) : null}
    </View>
  );
}

/**
 * The badge plus the climb: how far into the division, and what is left.
 * Used on the profile and after a ranked match.
 */
/**
 * @param {object} props
 * @param {number} props.rating
 * @param {object} [props.league] the server's own band, when the payload has
 *   one. League floors and names are superadmin-editable, so a client working
 *   from a cached ladder can name the wrong league and draw the wrong division
 *   — and then disagree with the share sheet on the same screen, which quotes
 *   the server's label. Local derivation stays as the fallback.
 */
export function LeagueProgress({ rating, league: served, style }) {
  const league = served ?? leagueFor(rating);
  const metal = leagueMetal(league.key, league.color);

  return (
    <View style={[styles.progress, style]}>
      <View style={styles.progressHead}>
        <LeagueBadge rating={rating} league={served} size="lg" />
        <View style={{ flex: 1 }} />
        <Text allowFontScaling={false} style={styles.rating}>
          {Math.round(rating ?? 0)}
        </Text>
      </View>

      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${Math.round(league.fraction * 100)}%`, backgroundColor: metal.ink },
          ]}
        />
      </View>

      <Text variant="meta" color={colors.inkFaint} style={styles.caption}>
        {league.isTop
          ? 'Top of the ladder. Nothing above this.'
          : `${league.pointsForNext} to ${nextLabel(league)}`}
      </Text>
    </View>
  );
}

/**
 * What sits one step up — the next division, or the next league entirely.
 *
 * The league half is asked for rather than listed: an operator can rename a
 * league or add one, and a hardcoded order would keep promising players a
 * "Diamond" that no longer exists.
 */
function nextLabel(league) {
  if (league.division > 1) {
    const roman = ['I', 'II', 'III', 'IV', 'V'];
    return `${league.name} ${roman[league.division - 2]}`;
  }
  return nextLeagueLabel(league);
}

const styles = StyleSheet.create({
  /**
   * A plaque, not a pill. The fully-rounded shape read as a throwaway tag; a
   * tight radius reads as something struck and awarded, which is what a league
   * is. The lettering is uppercase and tracked out for the same reason — it is
   * an inscription rather than a sentence.
   */
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 7,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderRadius: 7,
  },
  name: {
    fontFamily: fonts.semibold,
    letterSpacing: 1.1,
    includeFontPadding: false,
  },
  rule: { width: 1, alignSelf: 'stretch', marginVertical: 5 },
  division: {
    fontFamily: fonts.semibold,
    letterSpacing: 0.4,
    includeFontPadding: false,
    // Tabular so I / II / III do not shift the plate's width between players.
    fontVariant: ['tabular-nums'],
  },

  progress: {
    backgroundColor: colors.sunken,
    borderRadius: layout.radiusCard,
    padding: layout.cardPadding,
    gap: space.md,
  },
  progressHead: { flexDirection: 'row', alignItems: 'center' },
  rating: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 26,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.hairline, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  caption: {},
});
