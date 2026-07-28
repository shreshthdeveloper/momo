import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { api } from '../../src/lib/api.js';
import {
  Text,
  ErrorNotice,
  Avatar,
  Button,
  SectionHeader,
  IconButton,
  Badge,
  Stat,
} from '../../src/components/ui.jsx';
import { LeagueBadge } from '../../src/components/League.jsx';
import { resolveBanner } from '../../src/lib/banner.js';
import { flagEmoji, countryName } from '../../src/lib/country.js';
import { ProfileBodySkeleton } from '../../src/components/Skeletons.jsx';
import { colors, elevation, layout, space } from '../../src/theme/index.js';

/**
 * prd.md F6.8.3 — the public profile.
 * design.md §8.10 — "On another player's profile, the head-to-head record sits
 * directly under their name."
 */
export default function UserProfile() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get(`/users/${id}`).then(setProfile).catch(setError);

  useEffect(() => {
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <SafeAreaView style={styles.screen}>
        <ErrorNotice error={error} />
        <Button variant="ghost" label="Back" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }
  if (!profile) {
    return (
      <View style={styles.screen}>
        {/* The band is painted immediately so the back button is usable while
            the profile loads, rather than appearing under the user a moment
            after they have already reached for where it should be. */}
        <View style={[styles.band, styles.bandLoading]}>
          <View style={styles.bandShape} pointerEvents="none" />
          <SafeAreaView edges={['top']}>
            <View style={styles.bandTop}>
              <IconButton name="back" tone="onColor" onPress={() => router.back()} label="Back" />
            </View>
          </SafeAreaView>
        </View>
        <ProfileBodySkeleton />
      </View>
    );
  }

  const h2h = profile.headToHead;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.band}>
          {/* The player's own banner is the head of their profile — the same
              backdrop their half of the versus screen wears. */}
          <Image
            source={resolveBanner(profile.banner, profile.displayName)}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
          <View style={styles.bandShade} pointerEvents="none" />
          <SafeAreaView edges={['top']}>
            <View style={styles.bandTop}>
              <IconButton name="back" tone="onColor" onPress={() => router.back()} label="Back" />
            </View>
            <View style={styles.identity}>
              <Avatar url={profile.avatarUrl} name={profile.displayName} size={84} style={styles.face} />
              <Text variant="display" color={colors.onColor} style={{ marginTop: space.md }} numberOfLines={1}>
                {profile.displayName}
              </Text>
              {/* The earned heading, when they have one — a title is levelled
                  into, so it belongs to the name rather than to the stats. */}
              {profile.title ? (
                <Text variant="label" color="rgba(255,255,255,0.9)" style={styles.title} numberOfLines={1}>
                  {profile.title}
                </Text>
              ) : null}
              {profile.country || profile.city ? (
                <View style={styles.fromRow}>
                  {flagEmoji(profile.country) ? (
                    <Text allowFontScaling={false} style={styles.flag}>
                      {flagEmoji(profile.country)}
                    </Text>
                  ) : null}
                  <Text variant="meta" color="rgba(255,255,255,0.82)" numberOfLines={1}>
                    {[profile.city, countryName(profile.country)].filter(Boolean).join(', ')}
                  </Text>
                </View>
              ) : null}

              {/* The head-to-head sits directly under the name. */}
              {h2h?.played > 0 ? (
                <View style={styles.h2h}>
                  <Text variant="meta" color={colors.onColor}>
                    You {h2h.wins} · {h2h.losses} them{h2h.draws ? ` · ${h2h.draws} drawn` : ''}
                  </Text>
                </View>
              ) : null}
            </View>
          </SafeAreaView>
        </View>

        {/**
          * The three things a stranger's page is for: where they stand, how far
          * they have come, and how much they have played.
          *
          * The league is the headline and the number under it names the rating
          * it read — the ranked one, never a per-topic figure. Beside it, the
          * ACCOUNT level: the same level their titles are earned against, and
          * the only level here that is about the whole player rather than one
          * subject. Their per-topic levels are further down, where they belong.
          * A player from before ranked ratings existed still gets a stat.
          */}
        <View style={[styles.statCard, elevation.raised]}>
          {Number.isFinite(profile.rankedRating) ? (
            <View style={styles.leagueStat}>
              <LeagueBadge rating={profile.rankedRating} size="lg" style={styles.leagueBadge} />
              <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
                Ranked rating {Math.round(profile.rankedRating)}
              </Text>
            </View>
          ) : (
            <Stat value={profile.overallRating} label="Rating" color={colors.accent} />
          )}
          <View style={styles.statDivider} />
          <Stat value={profile.accountLevel ?? 1} label="Level" />
          <View style={styles.statDivider} />
          <Stat value={profile.matchesPlayed} label="Matches" />
        </View>

        <View style={styles.body}>
          {!profile.isSelf ? (
            <Button
              variant={profile.friendship?.status === 'accepted' ? 'soft' : 'primary'}
              label={
                profile.friendship?.status === 'accepted'
                  ? 'Friends'
                  : profile.friendship?.status === 'pending'
                    ? 'Request sent'
                    : 'Add friend'
              }
              disabled={Boolean(profile.friendship)}
              loading={busy}
              style={{ marginBottom: space.xl }}
              onPress={async () => {
                setBusy(true);
                try {
                  await api.post('/friends/request', { userId: String(id) });
                  await load();
                } catch (err) {
                  setError(err);
                } finally {
                  setBusy(false);
                }
              }}
            />
          ) : null}

          {/**
            * Someone else's topics carry a LEVEL and nothing else.
            *
            * Their topic ratings are not shown here — that number lives on the
            * topic leaderboard, where it is what the ranking is built from, and
            * on your own profile, where it is about you rather than a
            * comparison. On a stranger's page it would only ever be read as a
            * verdict on whether you can beat them, which is not a question a
            * profile should be answering; the ladder standing above already
            * says where they stand.
            */}
          {profile.topTopics?.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader title="Strongest topics" />
              {profile.topTopics.map((t) => (
                <View key={t.topicId} style={styles.row}>
                  <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>
                    {t.name}
                  </Text>
                  <Badge label={`Level ${t.level}`} tone="soft" />
                </View>
              ))}
            </View>
          ) : null}


          {profile.recentMatches?.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader title="Recent form" />
              {/* Lettered, like the strip on your own profile — a bare colour
                  cannot say "won", and says nothing at all to a red-green
                  colourblind player. */}
              <View style={styles.form}>
                {profile.recentMatches.map((m) => {
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
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingBottom: space.xxl },
  band: {
    backgroundColor: colors.nightRaised,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    paddingBottom: space.xxxl,
    overflow: 'hidden',
  },
  bandShape: {
    position: 'absolute',
    left: -60,
    bottom: -70,
    width: 200,
    height: 200,
    borderRadius: 62,
    backgroundColor: 'rgba(255,255,255,0.08)',
    transform: [{ rotate: '24deg' }],
  },
  bandLoading: { paddingBottom: space.huge },
  /** Shade over the banner so the identity always reads. */
  bandShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(18, 14, 30, 0.38)' },
  bandTop: { flexDirection: 'row', paddingHorizontal: layout.gutter, paddingTop: space.sm },
  identity: { alignItems: 'center', paddingHorizontal: layout.gutter },
  title: { letterSpacing: 0.4, marginTop: 2 },
  fromRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  flag: { fontSize: 15, lineHeight: 19 },
  // No background override: the avatar keeps the player's own tint, and the
  // white ring is what lifts it off the banner behind it.
  face: { borderWidth: 3, borderColor: colors.onColor },
  h2h: {
    marginTop: space.md,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: layout.radiusPill,
    paddingHorizontal: space.lg,
    paddingVertical: 6,
  },
  statCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    marginHorizontal: layout.gutter,
    marginTop: -28,
    paddingVertical: space.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  statDivider: { width: 1, height: 30, backgroundColor: colors.hairline },
  leagueStat: { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: space.sm },
  leagueBadge: { alignSelf: 'center' },
  body: { paddingHorizontal: layout.gutter, paddingTop: space.xl },
  section: { marginBottom: space.xl },
  /** Soft card rows — the game-list grammar. */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 54,
    paddingHorizontal: space.md,
    borderRadius: layout.radiusInput,
    backgroundColor: colors.sunken,
    marginBottom: space.sm,
  },
  /** Two short lines, right-aligned — still well inside the 54pt row. */
  form: { flexDirection: 'row', gap: space.sm },
  formDot: {
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formMark: { fontFamily: 'Inter_600SemiBold', fontSize: 12, lineHeight: 15 },
});

/** Shared with the profile tab — see the note there. */
const FORM_MARK = {
  won: { letter: 'W', fill: colors.correctSoft, ink: colors.correct, label: 'Won' },
  lost: { letter: 'L', fill: colors.wrongSoft, ink: colors.wrong, label: 'Lost' },
  drew: { letter: 'D', fill: colors.hairline, ink: colors.inkMuted, label: 'Drew' },
};
