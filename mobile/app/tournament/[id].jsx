import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useAuth } from '../../src/state/auth.jsx';
import {
  Text,
  Avatar,
  Badge,
  Button,
  Card,
  Header,
  ErrorNotice,
  SectionHeader,
  useScrollBottom,
} from '../../src/components/ui.jsx';
import { CardsSkeleton } from '../../src/components/Skeletons.jsx';
import Icon from '../../src/components/Icon.jsx';
import { colors, layout, space } from '../../src/theme/index.js';

/**
 * One knockout bracket.
 *
 * ── Why this is a list of rounds and not a tree ──────────────────────────────
 *
 * A bracket is drawn as a tree on a wall because a wall is two metres wide. On a
 * 360dp phone the same drawing puts sixteen names in a column four characters
 * across, and the lines that make it a bracket are the first thing to go. So it
 * is rounds, top to bottom, in the order they are played — which is also the
 * order a student cares about them: mine first, then who I might meet.
 *
 * ── The primary action is one tie ────────────────────────────────────────────
 *
 * At any moment a student has exactly one thing to do here, and it is either
 * "play your quarter-final" or nothing. The server works out which tie is theirs
 * (`yourTie`) rather than making the client search sixteen pairings for its own
 * name, and it is pinned at the top where a call to action belongs.
 */
export default function TournamentScreen() {
  const scrollBottom = useScrollBottom();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { activeSpaceId } = useAuth();

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!activeSpaceId || !id) return;
    try {
      setError(null);
      setData(await api.get(`/spaces/${activeSpaceId}/tournaments/${id}`));
    } catch (err) {
      setError(err);
    }
  }, [activeSpaceId, id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const act = useCallback(
    async (verb) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        setData(await api.post(`/spaces/${activeSpaceId}/tournaments/${id}/${verb}`, {}));
      } catch (err) {
        setError(err);
      } finally {
        setBusy(false);
      }
    },
    [busy, activeSpaceId, id],
  );

  /** Play the tie — the same private-challenge route Friends already uses. */
  const playTie = useCallback(() => {
    if (!data?.yourTie) return;
    router.push({
      pathname: '/match/searching',
      params: {
        challengeId: data.yourTie.challengeId,
        name: data.topic?.name ?? '',
        opponent: data.yourTie.opponent?.displayName ?? 'your opponent',
        avatarUrl: data.yourTie.opponent?.avatarUrl ?? '',
      },
    });
  }, [data, router]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header
        title={data?.name ?? 'Tournament'}
        subtitle={data?.topic?.name}
        onBack={() => router.back()}
      />
      <ErrorNotice error={error} onRetry={load} />

      {!data && !error ? (
        <CardsSkeleton rows={4} />
      ) : !data ? null : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: scrollBottom }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.accent}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }
        >
          {/* ── The one thing to do, if there is one. */}
          {data.yourTie ? (
            <Card style={styles.callToAction}>
              <Text variant="meta" color={colors.inkFaint}>
                {data.yourTie.round}
              </Text>
              <View style={styles.tieHead}>
                <Avatar
                  url={data.yourTie.opponent?.avatarUrl}
                  name={data.yourTie.opponent?.displayName}
                  size={40}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="title" numberOfLines={1}>
                    vs {data.yourTie.opponent?.displayName ?? 'your opponent'}
                  </Text>
                  <Text variant="meta" color={colors.inkMuted}>
                    You both have to be in the app at the same time.
                  </Text>
                </View>
              </View>
              <Button label="Play your tie" onPress={playTie} style={{ marginTop: space.md }} />
            </Card>
          ) : null}

          {/* ── Sign-up, while it is open. */}
          {data.status === 'open' ? (
            <Card style={styles.lobby}>
              <Text variant="label">
                {data.entrants.length} of {data.size} entered
              </Text>
              <Text variant="meta" color={colors.inkFaint} style={{ marginTop: space.xs }}>
                {data.entered
                  ? 'You are in. The bracket is drawn when your organization starts it — seeded by your rating on this topic.'
                  : 'Enter, and you are seeded by your rating on this topic when the bracket is drawn.'}
              </Text>
              <Button
                variant={data.entered ? 'soft' : 'primary'}
                label={data.entered ? 'Withdraw' : 'Enter'}
                loading={busy}
                style={{ marginTop: space.md }}
                onPress={() => act(data.entered ? 'leave' : 'join')}
              />
            </Card>
          ) : null}

          {/* ── The champion, once there is one. */}
          {data.champion ? (
            <Card style={styles.champion}>
              <Icon name="trophy" size={26} color={colors.gold} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="meta" color={colors.inkFaint}>
                  Winner
                </Text>
                <Text variant="title" numberOfLines={1}>
                  {data.champion.displayName}
                </Text>
              </View>
              <Avatar url={data.champion.avatarUrl} name={data.champion.displayName} size={44} />
            </Card>
          ) : null}

          {/* ── The bracket itself. */}
          {data.rounds.map((round) => (
            <View key={round.index} style={styles.round}>
              <SectionHeader title={round.name} />
              {round.ties.map((tie) => (
                <Tie key={tie.position} tie={tie} />
              ))}
            </View>
          ))}

          {data.status === 'open' ? (
            <View style={styles.entrants}>
              <SectionHeader title="Entered" />
              {data.entrants.map((entrant) => (
                <View key={entrant.id} style={styles.entrantRow}>
                  <Avatar url={entrant.avatarUrl} name={entrant.displayName} size={30} />
                  <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>
                    {entrant.displayName}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/**
 * One tie — two names, and which of them went through.
 *
 * A decided tie dims the loser rather than hiding them: the bracket is a record
 * of what happened, and a name that vanishes when it loses takes the story with
 * it. A bye says so in words, because a lone name against an empty space reads
 * as a rendering bug.
 */
function Tie({ tie }) {
  const decided = Boolean(tie.winnerId);
  const won = (side) => decided && side && String(side.id) === String(tie.winnerId);

  return (
    <View style={styles.tie}>
      <Side person={tie.a} winner={won(tie.a)} decided={decided} />
      <View style={styles.tieMiddle}>
        {tie.bye ? (
          <Badge tone="quiet" label="BYE" />
        ) : (
          <Text variant="tiny" color={colors.inkFaint}>
            v
          </Text>
        )}
      </View>
      <Side person={tie.b} winner={won(tie.b)} decided={decided} align="right" />
    </View>
  );
}

function Side({ person, winner, decided, align = 'left' }) {
  if (!person) {
    return (
      <View style={[styles.side, align === 'right' && styles.sideRight]}>
        <Text variant="meta" color={colors.inkFaint}>
          —
        </Text>
      </View>
    );
  }
  return (
    <View
      style={[
        styles.side,
        align === 'right' && styles.sideRight,
        decided && !winner && styles.sideOut,
      ]}
    >
      {align === 'left' ? (
        <Avatar url={person.avatarUrl} name={person.displayName} size={26} />
      ) : null}
      <Text
        variant={winner ? 'label' : 'body'}
        color={winner ? colors.ink : colors.inkMuted}
        numberOfLines={1}
        style={{ flexShrink: 1 }}
      >
        {person.displayName}
      </Text>
      {align === 'right' ? (
        <Avatar url={person.avatarUrl} name={person.displayName} size={26} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: layout.gutter },
  callToAction: { marginBottom: space.lg, borderColor: colors.accent, borderWidth: 1 },
  tieHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  lobby: { marginBottom: space.lg },
  champion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.lg,
    borderColor: colors.gold,
    borderWidth: 1,
  },
  round: { marginBottom: space.lg },
  tie: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: space.md,
    marginBottom: space.sm,
    borderRadius: layout.radiusInput,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
  },
  side: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minWidth: 0 },
  sideRight: { justifyContent: 'flex-end' },
  sideOut: { opacity: 0.45 },
  tieMiddle: { paddingHorizontal: space.sm, alignItems: 'center' },
  entrants: { marginBottom: space.lg },
  entrantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 44,
  },
});
