import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { api } from '../../src/lib/api.js';
import { resolveBanner } from '../../src/lib/banner.js';
import { useAuth } from '../../src/state/auth.jsx';
import {
  Text,
  Button,
  ConfirmSheet,
  ErrorNotice,
  Avatar,
  ProgressBar,
  SectionHeader,
  IconButton,
  Badge,
  Skeleton,
} from '../../src/components/ui.jsx';
import { ProfileBodySkeleton } from '../../src/components/Skeletons.jsx';
import { LeagueProgress } from '../../src/components/League.jsx';
import Icon from '../../src/components/Icon.jsx';
import { signOutCopy } from '../../src/lib/account.js';
import { profileLink } from '../../src/lib/share.js';
import { coins as fmtCoins } from '../../src/lib/rarity.js';
import CoinBalance from '../../src/components/CoinBalance.jsx';
import { ACHIEVEMENTS } from '../../src/shared/achievements.js';
import { useAdminSpace, useIsSuperadmin } from '../../src/lib/admin.js';
import { colors, elevation, layout, space, type } from '../../src/theme/index.js';
import { masteryProgress } from '../../src/shared/mastery.js';

/**
 * One past result, as a mark.
 *
 * The fill is a tint rather than the solid verdict colour: ten solid greens and
 * reds in a row is the loudest thing on a profile, and this strip is history,
 * not a verdict being delivered. The letter carries the meaning; the colour
 * only makes a streak visible as a shape.
 */
const FORM_MARK = {
  won: { letter: 'W', fill: colors.correctSoft, ink: colors.correct, label: 'Won' },
  lost: { letter: 'L', fill: colors.wrongSoft, ink: colors.wrong, label: 'Lost' },
  drew: { letter: 'D', fill: colors.hairline, ink: colors.inkMuted, label: 'Drew' },
};

/**
 * design.md §8.10 — profile, rebuilt for the ladder
 * (leagues-and-progression.md §7).
 *
 * The band carries identity and the card that overlaps it carries progress.
 * Overlapping them is not decoration: it binds "who you are" to "how you are
 * doing" as one object, and it stops the stats reading as the first row of the
 * list below.
 *
 * What changed is what that card says. It used to open with the overall rating
 * — an average of five topics that nobody plays for — beside win rate and
 * streak, so a losing run pushed all three down at once and the screen had
 * nothing to show for the matches played. Now the league leads (it can fall,
 * and that is the point of it) and the account level sits directly beneath it,
 * because the account level is the half of the system that only ever rises.
 * A bad night still ends closer to an unlock, and the card says so.
 *
 * Two numbers on this screen answer different questions and must never be read
 * as one (rating-and-levels.md): a RATING is how good you are, a LEVEL is how
 * much you have done. Every one of them below is therefore labelled with its
 * scope — ranked, account, or topic — and never left as a bare figure next to
 * a badge.
 */
export default function Profile() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const adminSpace = useAdminSpace();
  const isSuperadmin = useIsSuperadmin();
  const [stats, setStats] = useState(null);
  const [matches, setMatches] = useState([]);

  /**
   * How many achievements there are, and how many are yours.
   *
   * The total comes from the shipped list when the server has not answered yet,
   * so the row reads "0 of 7" rather than "0 of 0" on the first frame — a
   * denominator of zero is the one thing this row must never say, because it
   * means "there is nothing here" when there are seven.
   */
  const achievements = Array.isArray(stats?.achievements) ? stats.achievements : [];
  const earnedCount = achievements.filter((a) => a.earned ?? true).length;
  const totalCount = Math.max(achievements.length, ACHIEVEMENTS.length);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [s, m] = await Promise.all([api.get('/me/stats'), api.get('/matches', { limit: 10 })]);
      setStats(s);
      setMatches(m.items ?? []);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Share the profile.
   *
   * What gets shared is the STANDING, not a bare link: "Level 14 · Silver II ·
   * 63% of 120 matches" is the thing worth sending, and a URL on its own is
   * something the recipient has to open before it says anything. The link
   * points at the public profile route the app already serves at `/user/<id>`,
   * so anyone with the app deep-links straight to it and anyone without gets a
   * page that explains what Mimo is.
   *
   * Guests are deliberately excluded upstream — an account that expires in
   * three matches has no profile worth linking to.
   */
  const shareProfile = useCallback(() => {
    const bits = [
      stats?.accountLevel ? `Level ${stats.accountLevel}` : null,
      stats?.league?.label ?? null,
      stats?.matchesPlayed
        ? `${Math.round((stats.winRate ?? 0) * 100)}% of ${stats.matchesPlayed} matches`
        : null,
    ].filter(Boolean);

    const line = bits.length ? `  ${bits.join('  ·  ')}` : '';
    Share.share({
      message:
        `${user?.displayName ?? 'I'} on Mimo${line ? `\n${line}` : ''}\n\n` +
        profileLink(user?.id),
    }).catch(() => {});
  }, [stats, user]);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.accent}
            progressViewOffset={80}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        {/* ── Identity band — wearing the player's own banner. */}
        <View style={styles.band}>
          <Image
            source={resolveBanner(user?.banner, user?.displayName)}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
          <View style={styles.bandShade} pointerEvents="none" />
          <SafeAreaView edges={['top']}>
            <View style={styles.bandTop}>
              {/* The balance, on the one screen a player checks daily. It is a
                  readout here rather than a button — the Shop is a tab now, one
                  tap away, so a second door to it would be noise. */}
              <CoinBalance value={stats?.coins} onPress={null} />
              <View style={{ flex: 1 }} />
              <IconButton
                name="share"
                tone="onColor"
                onPress={shareProfile}
                label="Share your profile"
              />
              <IconButton
                name="edit"
                tone="onColor"
                onPress={() => router.push('/customize')}
                label="Edit your profile"
              />
              <IconButton
                name="gear"
                tone="onColor"
                onPress={() => router.push('/settings')}
                label="Settings"
              />
            </View>

            <View style={styles.identity}>
              <Avatar
                url={user?.avatarUrl}
                name={user?.displayName}
                size={84}
                style={styles.face}
              />
              <Text variant="display" color={colors.onColor} numberOfLines={1} style={{ marginTop: space.md }}>
                {user?.displayName ?? 'You'}
              </Text>
              {/* The equipped title, when there is one. It sits between the
                  name and the facts because it is neither: it is worn, so it
                  belongs to the name, but it is earned, so it is quiet. */}
              {stats?.title ? (
                <View style={styles.title}>
                  <Text variant="tiny" color={colors.onColor} numberOfLines={1}>
                    {stats.title}
                  </Text>
                </View>
              ) : null}
              <Text variant="meta" color="rgba(255,255,255,0.78)">
                {[user?.city, `${stats?.matchesPlayed ?? 0} matches played`].filter(Boolean).join('  ·  ')}
              </Text>
            </View>
          </SafeAreaView>
        </View>

        {/* ── Progress, overlapping the band.
            League first, because it is the standing the whole ladder is about
            and the only thing here that can fall. Account level second, in
            reach of a thumb, because it is what a losing run still moves. The
            two tiles last: they describe the run of play, not the standing. */}
        <View style={[styles.statCard, elevation.raised]}>
          {stats ? (
            <>
              {/* LeagueProgress derives the band from the rating itself, so
                  there is no league prop here that could disagree with the
                  number printed beside it. */}
              {typeof stats.rankedRating === 'number' ? (
                <Pressable
                  onPress={() => router.push('/leaderboard')}
                  accessibilityRole="button"
                  accessibilityLabel="Your league. Opens the leaderboard."
                  style={({ pressed }) => [pressed && styles.pressed]}
                >
                  <LeagueProgress rating={stats.rankedRating} />
                </Pressable>
              ) : null}
              <AccountLevel
                progress={stats.accountProgress}
                perk={stats.nextPerk}
                onPress={() => router.push('/shop')}
              />

              {/* prd.md §6.7 — a chest is earned the moment a rating crosses
                  and stays on the server until it is opened, so nothing was
                  ever actually lost by tapping past the celebration. Nothing
                  said so, though, which made "did I miss it?" unanswerable
                  from the one screen a player would ask it on. */}
              {stats.unopenedChests > 0 ? (
                <WaitingChests
                  count={stats.unopenedChests}
                  onPress={() => router.push('/shop')}
                />
              ) : null}
            </>
          ) : (
            // The skeleton is the shape of the answer: a league block and a
            // level row, so nothing jumps when the stats land.
            <View style={styles.progressWait}>
              <Skeleton height={112} radius={layout.radiusCard} />
              <Skeleton height={62} radius={layout.radiusInput} />
            </View>
          )}

          <View style={styles.tiles}>
            <StatTile
              icon="target"
              tint={colors.correct}
              soft={colors.correctSoft}
              value={
                stats?.matchesPlayed
                  ? `${Math.round(((stats.matchesWon ?? 0) / stats.matchesPlayed) * 100)}%`
                  : '—'
              }
              label="Win rate"
            />
            <StatTile
              icon="bolt"
              tint={colors.optionC}
              soft={colors.amberSoft}
              value={stats?.streak?.current ?? 0}
              label="Day streak"
            />
            {/* The balance sits with the other two because it is a measure of
                play like they are, not a wallet bolted onto the profile — it is
                earned from matches and nothing else. Gold, and tappable,
                because it is the one figure here that leads somewhere. */}
            <StatTile
              icon="sparkle"
              tint={colors.gold}
              soft={colors.goldSoft}
              value={fmtCoins(stats?.coins ?? user?.coins ?? 0)}
              label="Coins"
              onPress={() => router.push('/shop')}
            />
          </View>

          {/**
            * The last ten matches, newest first.
            *
            * This was a row of bare green and red dots, and nothing on screen
            * said what they were — a colour alone cannot carry "won" to someone
            * seeing it for the first time, and to a red-green colourblind player
            * it carried nothing at all. Same information, now with the letter in
            * it: the colour makes the shape of a run readable at a glance, and
            * the letter makes a single result readable at all.
            */}
          {matches.length > 0 ? (
            <View style={styles.formRow}>
              <Text variant="meta" color={colors.inkFaint}>
                Last 10
              </Text>
              <View style={styles.formDots}>
                {matches.slice(0, 10).map((m) => {
                  const mark = FORM_MARK[m.verdict] ?? FORM_MARK.drew;
                  return (
                    <View
                      key={m.id}
                      style={[styles.formDot, { backgroundColor: mark.fill }]}
                      accessibilityLabel={mark.label}
                    >
                      <Text allowFontScaling={false} style={[styles.formMark, { color: mark.ink }]}>
                        {mark.letter}
                      </Text>
                    </View>
                  );
                })}
              </View>
              <Text variant="meta" color={colors.inkFaint}>
                {stats?.matchesPlayed ?? 0} played
              </Text>
            </View>
          ) : null}
        </View>

        <ErrorNotice error={error} onRetry={load} />

        <View style={styles.body}>
          {/* The door to the admin area — only drawn for people the server
              would let through it anyway. */}
          {adminSpace ? (
            <Pressable
              style={({ pressed }) => [styles.door, pressed && { opacity: 0.7 }]}
              onPress={() => router.push('/admin')}
              accessibilityRole="button"
              accessibilityLabel={`Manage ${adminSpace.name}`}
            >
              <View style={styles.adminBadge}>
                <Icon name="gear" size={16} color={colors.onAccent} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="label" color={colors.accent}>
                  Manage {adminSpace.name}
                </Text>
                <Text variant="meta" color={colors.inkMuted}>
                  Students, review queue, contests, assignments.
                </Text>
              </View>
              <Icon name="chevronRight" size={16} color={colors.accent} />
            </Pressable>
          ) : null}

          {/* The platform operator's door. Same rule: the server re-checks the
              role on every /super request, this only decides what to show. */}
          {isSuperadmin ? (
            <Pressable
              style={({ pressed }) => [styles.door, pressed && { opacity: 0.7 }]}
              onPress={() => router.push('/super')}
              accessibilityRole="button"
              accessibilityLabel="Mimo platform operations"
            >
              <View style={[styles.adminBadge, { backgroundColor: colors.ink }]}>
                <Icon name="bolt" size={16} color={colors.canvas} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="label">Platform operations</Text>
                <Text variant="meta" color={colors.inkMuted}>
                  Organizations, central bank, moderation, health.
                </Text>
              </View>
              <Icon name="chevronRight" size={16} color={colors.inkMuted} />
            </Pressable>
          ) : null}

          {!stats ? (
            <ProfileBodySkeleton />
          ) : (
            <>
              {/* Achievements, as a door rather than a shelf.
                  The strip of badges that used to sit here appeared only once
                  something had been earned, so a new player saw nothing at all
                  and reasonably concluded there was nothing to see. A row that
                  is always here, always says how many there are, and opens the
                  full list is the whole fix. */}
              <Pressable
                onPress={() => router.push('/achievements')}
                accessibilityRole="button"
                accessibilityLabel={`Achievements, ${earnedCount} of ${totalCount} earned`}
                style={({ pressed }) => [styles.door, pressed && styles.pressed]}
              >
                <View style={styles.medal}>
                  <Icon name="trophy" size={16} color={colors.gold} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="label">Achievements</Text>
                  <Text variant="meta" color={colors.inkMuted}>
                    {earnedCount} of {totalCount} earned
                    {earnedCount < totalCount ? ' · see what is left' : ''}
                  </Text>
                </View>
                <Icon name="chevronRight" size={16} color={colors.inkMuted} />
              </Pressable>

              {/* Everything in this section is PER TOPIC — the level, the
                  rating and the bar all belong to the one subject named on the
                  row, and none of them is the account level or the ranked
                  rating above. The old row put "Level 3" and "rating 1216" in
                  the same breath with no scope on either, which reads as one
                  number and its badge. So: the badge is the level, the rating
                  moves to its own line under its own words, and the bar gets a
                  readout, because an unlabelled sliver of accent tells nobody
                  what it is measuring or how much is left. */}
              {stats.topTopics?.length > 0 ? (
                <View style={styles.section}>
                  <SectionHeader title="Your topics" />
                  {stats.topTopics.map((t) => {
                    const m = masteryProgress(t.xp);
                    return (
                      <Pressable
                        key={t.topicId}
                        style={({ pressed }) => [styles.topic, pressed && styles.pressed]}
                        onPress={() => router.push(`/topic/${t.topicId}`)}
                      >
                        <View style={styles.between}>
                          <Text variant="label" numberOfLines={1} style={{ flex: 1 }}>
                            {t.name}
                          </Text>
                          <Badge label={`Level ${m.level}`} tone="soft" />
                        </View>
                        <Text variant="meta" color={colors.inkFaint} style={{ marginTop: space.sm }}>
                          {/* Brighter than the tallies around it, and a line
                              away from the badge, so the two never merge into
                              "Level 3, 1216 of something". */}
                          <Text variant="meta" color={colors.inkMuted}>
                            Topic rating {t.rating}
                          </Text>
                          {`  ·  ${t.wins}W ${t.losses}L`}
                          {t.accuracy !== null ? `  ·  ${Math.round(t.accuracy * 100)}% correct` : ''}
                        </Text>
                        <View style={styles.topicMeter}>
                          <View style={{ flex: 1 }}>
                            <ProgressBar value={m.xpIntoLevel} max={m.xpForNextLevel || 1} height={6} />
                          </View>
                          <Text variant="tiny" color={colors.inkFaint}>
                            {m.xpForNextLevel
                              ? `${m.xpForNextLevel - m.xpIntoLevel} XP to level ${m.level + 1}`
                              : 'Top level reached'}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              {matches.length > 0 ? (
                <View style={styles.section}>
                  <SectionHeader title="Recent matches" />
                  {/* The right-hand column is a score over a rating move, and
                      a green "+16" beside a score reads as points won unless
                      something says otherwise. It is said once, over the
                      column, rather than on every row — and it names the topic
                      rating, which is the number /matches actually reports. */}
                  <Text variant="tiny" color={colors.inkFaint} style={styles.legend}>
                    Score, and the ranked rating it moved
                  </Text>
                  {matches.map((m) => (
                    <Pressable
                      key={m.id}
                      style={({ pressed }) => [styles.match, pressed && styles.pressed]}
                      onPress={() => router.push(`/review/${m.id}`)}
                    >
                      <View
                        style={[
                          styles.verdict,
                          {
                            backgroundColor:
                              m.verdict === 'won'
                                ? colors.correctSoft
                                : m.verdict === 'lost'
                                  ? colors.wrongSoft
                                  : colors.sunken,
                          },
                        ]}
                      >
                        <Text
                          variant="tiny"
                          color={
                            m.verdict === 'won'
                              ? colors.correct
                              : m.verdict === 'lost'
                                ? colors.wrong
                                : colors.inkMuted
                          }
                        >
                          {m.verdict === 'won' ? 'Won' : m.verdict === 'lost' ? 'Lost' : 'Draw'}
                        </Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text variant="label" numberOfLines={1}>
                          {m.topic?.name}
                        </Text>
                        <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
                          vs {m.opponent?.displayName ?? 'opponent'}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[type.label, { color: colors.ink }]}>
                          {m.you?.score}–{m.opponent?.score}
                        </Text>
                        {/* The ladder move, not the topic Elo: this list spans
                            every topic, so the number a player recognises from
                            the header is the ranked one. Quick play shows
                            nothing, because nothing moved. */}
                        {m.you?.rankedDelta ? (
                          <Text
                            variant="meta"
                            color={m.you.rankedDelta > 0 ? colors.correct : colors.wrong}
                          >
                            {m.you.rankedDelta > 0 ? `+${m.you.rankedDelta}` : m.you.rankedDelta}
                          </Text>
                        ) : m.ranked === false ? (
                          <Text variant="meta" color={colors.inkFaint}>
                            Quick
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </>
          )}

          {/* Sign out lives here as well as in Settings.
              "You" is where a player looks for their own account, and burying
              the way out at the bottom of a screen of nineteen toggles is the
              kind of thing that reads as deliberate. It stays quiet — an
              outlined danger button, below everything, never a primary. */}
          <View style={styles.account}>
            <Button
              variant="danger"
              size="md"
              label="Sign out"
              onPress={() => setConfirmingSignOut(true)}
            />
            <Text variant="tiny" color={colors.inkFaint} style={styles.version}>
              Mimo 1.0.0
            </Text>
          </View>
        </View>
      </ScrollView>

      <ConfirmSheet
        visible={confirmingSignOut}
        destructive
        icon="user"
        loading={signingOut}
        {...signOutCopy()}
        onConfirm={async () => {
          setSigningOut(true);
          await signOut();
          router.replace('/(auth)/welcome');
        }}
        onCancel={() => setConfirmingSignOut(false)}
      />
    </View>
  );
}

/**
 * The account level (leagues-and-progression.md §4) — the half of the system
 * that only ever rises.
 *
 * It is a row rather than a tile because it carries a bar and a sentence, and
 * it is a row you can press because the thing it is counting toward lives on
 * another screen: a bar with a named prize at the end of it is an invitation,
 * and an invitation should open something.
 *
 * The caption names the prize for that reason. "340/900 XP" is a measurement;
 * "next: Sharpshooter at 13" is a reason to play one more match.
 */
function AccountLevel({ progress, perk, onPress }) {
  // The server sends this with the stats. It cannot be derived here any more:
  // the curve is configuration (leagues-and-progression.md §9), so a client
  // that computed it would be a version behind the ladder it is drawing.
  if (!progress) return null;
  const xp = progress.xpForNextLevel
    ? `${progress.xpIntoLevel}/${progress.xpForNextLevel} XP`
    : 'Top level reached';
  const caption = perk
    ? `${xp}  ·  next: ${perk.name} at ${perk.unlockLevel}`
    : `${xp}  ·  Every title earned.`;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.level, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Account level ${progress.level}. ${caption}`}
    >
      <View style={styles.between}>
        <View style={styles.levelHead}>
          <View style={styles.levelIcon}>
            <Icon name="ranks" size={14} color={colors.accent} />
          </View>
          <Text variant="label">Level {progress.level}</Text>
        </View>
        <Icon name="chevronRight" size={16} color={colors.inkFaint} />
      </View>
      <ProgressBar value={progress.xpIntoLevel} max={progress.xpForNextLevel || 1} height={6} />
      {/* No line clamp: at a large system font the perk's name is the part
          that would be cut, and the name is the whole reason the line exists. */}
      <Text variant="meta" color={colors.inkFaint}>
        {caption}
      </Text>
    </Pressable>
  );
}

/**
 * Chests earned and not yet opened.
 *
 * Gold, because gold in this app means achievement and nothing else, and
 * because this row has to out-shout a screen that is otherwise all progress
 * bars. It only exists when there is something in it — a permanent "0 waiting"
 * row would be the same as no row, except worse, because it would teach the
 * player to stop reading this spot.
 */
function WaitingChests({ count, onPress }) {
  const what = count === 1 ? '1 reward' : `${count} rewards`;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.waiting, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${what} waiting to be opened. Opens the Shop.`}
    >
      <View style={styles.waitingIcon}>
        <Icon name="gift" size={16} color={colors.gold} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="label" color={colors.gold}>
          {what} waiting
        </Text>
        <Text variant="meta" color={colors.inkFaint}>
          Earned but not opened — tap to claim.
        </Text>
      </View>
      <Icon name="chevronRight" size={16} color={colors.gold} />
    </Pressable>
  );
}

/** A number, its label, and an icon disc in the stat's own colour. */
/**
 * One figure and what it is.
 *
 * `onPress` is optional and only the balance uses it: a number you can spend
 * should take you to where it is spent, and the two that cannot be acted on —
 * a win rate, a streak — deliberately stay inert rather than growing a
 * destination for the sake of symmetry.
 */
function StatTile({ icon, tint, soft, value, label, onPress }) {
  const body = (
    <>
      <View style={[styles.tileIcon, { backgroundColor: soft }]}>
        <Icon name={icon} size={16} color={tint} />
      </View>
      <Text style={[type.timer, { color: colors.ink }]} numberOfLines={1}>
        {value}
      </Text>
      <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
        {label}
      </Text>
    </>
  );

  if (!onPress) return <View style={styles.tile}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${value} ${label}. Opens the shop.`}
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.6 }]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingBottom: layout.dockClearance },
  band: {
    backgroundColor: colors.nightRaised,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    paddingBottom: space.xxxl,
    overflow: 'hidden',
  },
  bandShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(18, 14, 30, 0.38)',
  },
  // The two round buttons breathe: §2 of the touch rules wants 8px+ between
  // 40px targets, and butted together they read as one double-wide button.
  bandTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.gutter,
    paddingTop: space.sm,
  },
  identity: { alignItems: 'center', paddingHorizontal: layout.gutter },
  // Worn, so it hugs the name; earned, so it gets a shape of its own rather
  // than becoming a second line of grey metadata.
  title: {
    marginTop: 3,
    marginBottom: 3,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: layout.radiusPill,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  // No background override: the avatar keeps the player's own tint, and the
  // white ring is what lifts it off the banner behind it.
  face: { borderWidth: 3, borderColor: colors.onColor },
  statCard: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    marginHorizontal: layout.gutter,
    marginTop: -28,
    paddingVertical: space.lg,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  progressWait: { gap: space.md },
  level: {
    gap: space.sm,
    marginTop: space.md,
    padding: space.md,
    borderRadius: layout.radiusInput,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  /** The same row as `level`, wearing gold — it is the one thing owed. */
  waiting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.sm,
    padding: space.md,
    borderRadius: layout.radiusInput,
    borderWidth: 1,
    borderColor: 'rgba(245, 182, 46, 0.42)',
    backgroundColor: 'rgba(245, 182, 46, 0.10)',
  },
  waitingIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245, 182, 46, 0.16)',
  },
  levelHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1, minWidth: 0 },
  levelIcon: {
    width: 26,
    height: 26,
    borderRadius: 9,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tiles: { flexDirection: 'row', alignItems: 'flex-start', marginTop: space.lg },
  tile: { flex: 1, alignItems: 'center', gap: 3 },
  tileIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.lg,
    paddingTop: space.md,
    paddingHorizontal: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  formDots: { flex: 1, flexDirection: 'row', gap: 4, justifyContent: 'center' },
  formDot: {
    width: 20,
    height: 20,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formMark: { fontFamily: 'Inter_600SemiBold', fontSize: 11, lineHeight: 14 },
  body: { paddingHorizontal: layout.gutter, paddingTop: space.xl },
  adminBadge: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medal: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: 'rgba(245, 182, 46, 0.30)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  door: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.accentSoft,
    borderRadius: layout.radiusInput,
    padding: space.lg,
    marginBottom: space.xl,
  },
  section: { marginBottom: space.xl },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.sunken,
    borderRadius: layout.radiusPill,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  topic: {
    marginBottom: space.md,
    padding: space.md,
    borderRadius: layout.radiusInput,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  // The bar and its readout are one object: the number is what tells you which
  // level the sliver belongs to and how much of it is left.
  topicMeter: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md },
  legend: { textAlign: 'right', marginTop: -space.sm, marginBottom: space.sm },
  match: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 60,
    paddingHorizontal: space.sm,
    borderRadius: layout.radiusInput,
  },
  verdict: { width: 46, alignItems: 'center', paddingVertical: 4, borderRadius: layout.radiusPill },
  pressed: { backgroundColor: colors.sunken },
  account: {
    marginTop: space.md,
    paddingTop: space.xl,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  version: { textAlign: 'center', marginTop: space.md },
});
