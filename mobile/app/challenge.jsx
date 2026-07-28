import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/lib/api.js';
import { useAuth } from '../src/state/auth.jsx';
import { Text, ErrorNotice, EmptyState, Header, Avatar } from '../src/components/ui.jsx';
import { ListSkeleton } from '../src/components/Skeletons.jsx';
import TopicMedallion from '../src/components/TopicMedallion.jsx';
import Icon from '../src/components/Icon.jsx';
import { colors, layout, space } from '../src/theme/index.js';
import { PUBLIC_SPACE_ID } from '../src/shared/constants.js';

/**
 * prd.md §6.3 — pick the topic to challenge a friend on.
 *
 * A challenge is one decision the challenger makes alone, so it gets one
 * screen: which subject. Everything else about the match is already settled —
 * the opponent came from the row that opened this, the stakes are fixed (a
 * challenge is unranked, XP only), and the topic is what the other person is
 * being asked to agree to.
 *
 * The topic list is the same home feed /play reads, for the same reason: it
 * works identically in the Public Arena and inside an organization without a
 * second endpoint, and a player can only challenge on something they can both
 * actually reach.
 */
export default function ChallengeTopic() {
  const router = useRouter();
  const { userId, name, avatarUrl } = useLocalSearchParams();
  const { activeSpaceId } = useAuth();

  const [topics, setTopics] = useState(null);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(null);

  const inSpace = activeSpaceId && activeSpaceId !== PUBLIC_SPACE_ID;

  const load = useCallback(async () => {
    try {
      setError(null);
      const feed = inSpace
        ? await api.get(`/spaces/${activeSpaceId}/home`)
        : await api.get('/home', { spaceId: activeSpaceId });

      const flat = inSpace ? (feed.topics ?? []) : (feed.rows ?? []).flatMap((r) => r.topics ?? []);
      const seen = new Set();
      setTopics(
        flat.filter((t) => {
          if (!t?.id || seen.has(t.id)) return false;
          seen.add(t.id);
          return true;
        }),
      );
    } catch (err) {
      setError(err);
    }
  }, [activeSpaceId, inSpace]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Sending is the whole screen, so it takes the whole screen's error surface
   * rather than a toast: the two things that realistically fail — you are not
   * friends any more, and you already have one open with them — are both
   * things the player has to read and act on, not glance at.
   */
  const send = async (topic) => {
    if (sending) return;
    setSending(topic.id);
    try {
      setError(null);
      await api.post('/challenges', { userId: String(userId), topicId: topic.id });
      router.back();
    } catch (err) {
      setError(err);
    } finally {
      setSending(null);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Challenge" onBack={() => router.back()} />

      <View style={styles.who}>
        <Avatar url={avatarUrl ? String(avatarUrl) : null} name={String(name ?? '')} size={44} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="label" numberOfLines={1}>
            {name ?? 'Your friend'}
          </Text>
          <Text variant="meta" color={colors.inkFaint}>
            They have 24 hours to accept. Nothing is at stake — XP only.
          </Text>
        </View>
      </View>

      <ErrorNotice error={error} onRetry={load} />

      {!topics && !error ? (
        <ListSkeleton rows={6} trailing={false} />
      ) : topics?.length === 0 ? (
        <EmptyState
          title="No topics to play yet"
          icon="book"
          body="Once a topic is live you can challenge someone on it."
        />
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          <Text variant="label" color={colors.inkMuted} style={styles.label}>
            Pick a topic
          </Text>

          {topics?.map((topic) => (
            <Pressable
              key={topic.id}
              onPress={() => send(topic)}
              disabled={Boolean(sending)}
              accessibilityRole="button"
              accessibilityLabel={`Challenge ${name ?? 'them'} on ${topic.name}`}
              style={({ pressed }) => [
                styles.row,
                pressed && styles.rowPressed,
                sending && sending !== topic.id && { opacity: 0.4 },
              ]}
            >
              <TopicMedallion coverUrl={topic.coverUrl} name={topic.name} size={48} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label" numberOfLines={1}>
                  {topic.name}
                </Text>
                <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
                  {topic.viewer ? `Level ${topic.viewer.level}` : 'Not played yet'}
                </Text>
              </View>
              <View style={styles.go}>
                <Icon
                  name={sending === topic.id ? 'clock' : 'arrowRight'}
                  size={16}
                  color={colors.accent}
                />
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginHorizontal: layout.gutter,
    marginTop: space.sm,
    marginBottom: space.lg,
    padding: space.md,
    borderRadius: layout.radiusInput,
    backgroundColor: colors.sunken,
  },
  list: { paddingHorizontal: layout.gutter, paddingBottom: space.xxl },
  label: { paddingHorizontal: layout.gutter + space.sm, paddingBottom: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 72,
    paddingHorizontal: space.sm,
    borderRadius: layout.radiusInput,
  },
  rowPressed: { backgroundColor: colors.sunken },
  go: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
