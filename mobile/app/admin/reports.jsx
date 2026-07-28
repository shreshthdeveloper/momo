import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useAdminSpace } from '../../src/lib/admin.js';
import {
  Text,
  Chip,
  EmptyState,
  ErrorNotice,
  Header,
  ProgressBar,
  SectionHeader,
  Segmented,
  Skeleton,
  Stat,
} from '../../src/components/ui.jsx';
import { CardsSkeleton } from '../../src/components/Skeletons.jsx';
import { colors, elevation, layout, space, type } from '../../src/theme/index.js';

/**
 * prd.md §8.6 — reports. Four questions an admin actually asks, one tab each:
 * which questions are broken (Items), how does a topic play (Topics), which
 * batch is ahead (Batches), and is this month better than last (Trends).
 * Each tab loads on first visit and keeps what it fetched, so flicking
 * between them costs nothing.
 *
 * No chart library — every visual is a View: the option spread is four bars
 * in a 28px row, everything else is the app's own ProgressBar and Stat.
 * Colour is never the only signal; every arrowless delta says "up" or "down"
 * in words beside its number.
 */
const TABS = [
  { value: 'items', label: 'Items' },
  { value: 'topics', label: 'Topics' },
  { value: 'batches', label: 'Batches' },
  { value: 'trends', label: 'Trends' },
];

const ITEM_MODES = [
  { value: 'flagged', label: 'Flagged' },
  { value: 'all', label: 'All' },
];

const PERIODS = [
  { value: 7, label: 'Week' },
  { value: 30, label: 'Month' },
  { value: 90, label: 'Quarter' },
];

const LETTERS = ['A', 'B', 'C', 'D'];
const DIFFICULTY_ORDER = ['easy', 'medium', 'hard'];

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

/**
 * The items payload deliberately omits the answer key (the server never ships
 * `correctIndex` in list payloads). But `optionDistribution[i]` and
 * `percentCorrect` are computed from the same counts with the same rounding,
 * so the correct option is the bar whose share equals `percentCorrect`. On
 * the rare exact tie the first match wins — the spread still reads correctly,
 * since tied bars are the same height.
 */
function correctIndexOf(item) {
  if (Number.isInteger(item.correctIndex)) return item.correctIndex;
  if (item.percentCorrect == null || !Array.isArray(item.optionDistribution)) return -1;
  return item.optionDistribution.findIndex((pct) => pct === item.percentCorrect);
}

/** Four mini bars in a fixed 28px row — the shape of the class's picks. */
function OptionSpread({ distribution, correctIndex }) {
  const values = LETTERS.map((_, i) => distribution?.[i] ?? 0);
  return (
    <View
      style={styles.spread}
      accessibilityLabel={`Answer spread: ${values
        .map((v, i) => `${LETTERS[i]} ${Math.round(v)} percent`)
        .join(', ')}`}
    >
      {values.map((pct, i) => (
        <View key={LETTERS[i]} style={styles.spreadCol}>
          <View style={styles.spreadTrack}>
            <View
              style={[
                styles.spreadBar,
                {
                  height: `${Math.max(6, Math.min(100, pct))}%`,
                  backgroundColor: i === correctIndex ? colors.accent : colors.inkFaint,
                },
              ]}
            />
          </View>
          <Text variant="tiny" color={i === correctIndex ? colors.accent : colors.inkFaint}>
            {LETTERS[i]}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The verdict pill. Badge has no amber tone, so this mirrors Badge's geometry
 * locally: red for a suspect key, amber for too easy, quiet for healthy — and
 * the word always carries the meaning, never the colour alone.
 */
function FlagBadge({ flag }) {
  const look =
    flag === 'suspect_key'
      ? { bg: colors.wrong, fg: colors.onColor, label: 'Check key' }
      : flag === 'too_easy'
        ? { bg: colors.optionC, fg: colors.onColor, label: 'Too easy' }
        : { bg: colors.sunken, fg: colors.inkFaint, label: 'healthy' };
  return (
    <View style={[styles.flagPill, { backgroundColor: look.bg }]}>
      <Text variant="tiny" color={look.fg}>
        {look.label}
      </Text>
    </View>
  );
}

/** One quarter of the Trends card: the number now, and where it came from. */
function DeltaTile({ label, value, change, previous, pts }) {
  const magnitude = change == null ? null : Math.abs(change);
  const shown =
    magnitude == null ? null : Number.isInteger(magnitude) ? String(magnitude) : magnitude.toFixed(1);
  const up = (change ?? 0) > 0;
  const unit = pts ? (magnitude === 1 ? ' pt' : ' pts') : '%';
  return (
    <View style={styles.tile}>
      <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[type.timer, styles.mono, { color: colors.ink }]} numberOfLines={1}>
        {value}
      </Text>
      {change == null ? (
        <Text variant="meta" color={colors.inkFaint}>
          no earlier data
        </Text>
      ) : change === 0 ? (
        <Text variant="meta" color={colors.inkFaint}>
          no change
        </Text>
      ) : (
        <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
          <Text variant="meta" color={up ? colors.correct : colors.wrong}>
            {up ? 'up' : 'down'} {shown}
            {unit}
          </Text>
          {` from ${previous}`}
        </Text>
      )}
    </View>
  );
}

export default function AdminReports() {
  const router = useRouter();
  const adminSpace = useAdminSpace();
  const spaceId = adminSpace?.id;

  const [tab, setTab] = useState('items');
  const [refreshing, setRefreshing] = useState(false);

  // Items
  const [itemsMode, setItemsMode] = useState('flagged');
  const [itemsCache, setItemsCache] = useState({});
  const [itemsError, setItemsError] = useState(null);

  // Topics — the list feeds both the Topics and Trends chip rows.
  const [topics, setTopics] = useState(null);
  const [topicsError, setTopicsError] = useState(null);
  const [topicId, setTopicId] = useState(null);
  const [topicCache, setTopicCache] = useState({});
  const [topicError, setTopicError] = useState(null);

  // Batches
  const [batches, setBatches] = useState(null);
  const [batchesError, setBatchesError] = useState(null);

  // Trends
  const [days, setDays] = useState(30);
  const [trendTopicId, setTrendTopicId] = useState(null);
  const [trendCache, setTrendCache] = useState({});
  const [trendError, setTrendError] = useState(null);

  const trendKey = `${days}:${trendTopicId ?? 'all'}`;

  const loadItems = useCallback(
    async (mode) => {
      if (!spaceId) return;
      try {
        setItemsError(null);
        const data = await api.get('/admin/reports/items', {
          spaceId,
          flagged: mode === 'flagged' ? '1' : undefined,
        });
        setItemsCache((c) => ({ ...c, [mode]: data }));
      } catch (err) {
        setItemsError(err);
      }
    },
    [spaceId],
  );

  const loadTopics = useCallback(async () => {
    if (!spaceId) return;
    try {
      setTopicsError(null);
      const data = await api.get('/admin/topics', { spaceId });
      setTopics(data.items ?? []);
    } catch (err) {
      setTopicsError(err);
    }
  }, [spaceId]);

  const loadTopicReport = useCallback(
    async (id) => {
      if (!spaceId) return;
      try {
        setTopicError(null);
        const data = await api.get(`/admin/reports/topic/${id}`, { spaceId });
        setTopicCache((c) => ({ ...c, [id]: data }));
      } catch (err) {
        setTopicError(err);
      }
    },
    [spaceId],
  );

  const loadBatches = useCallback(async () => {
    if (!spaceId) return;
    try {
      setBatchesError(null);
      const data = await api.get('/admin/reports/batches', { spaceId });
      setBatches(data.items ?? []);
    } catch (err) {
      setBatchesError(err);
    }
  }, [spaceId]);

  const loadTrend = useCallback(
    async (d, tId) => {
      if (!spaceId) return;
      try {
        setTrendError(null);
        const data = await api.get('/admin/reports/periods', {
          spaceId,
          days: d,
          topicId: tId ?? undefined,
        });
        setTrendCache((c) => ({ ...c, [`${d}:${tId ?? 'all'}`]: data }));
      } catch (err) {
        setTrendError(err);
      }
    },
    [spaceId],
  );

  // Each tab fetches on first visit; the caches make revisits free.
  useEffect(() => {
    if (tab === 'items' && !itemsCache[itemsMode]) loadItems(itemsMode);
  }, [tab, itemsMode, itemsCache, loadItems]);

  useEffect(() => {
    if ((tab === 'topics' || tab === 'trends') && topics == null) loadTopics();
  }, [tab, topics, loadTopics]);

  useEffect(() => {
    if (tab === 'topics' && topicId && !topicCache[topicId]) loadTopicReport(topicId);
  }, [tab, topicId, topicCache, loadTopicReport]);

  useEffect(() => {
    if (tab === 'batches' && batches == null) loadBatches();
  }, [tab, batches, loadBatches]);

  useEffect(() => {
    if (tab === 'trends' && !trendCache[trendKey]) loadTrend(days, trendTopicId);
  }, [tab, trendKey, trendCache, days, trendTopicId, loadTrend]);

  const activeError =
    tab === 'items'
      ? itemsError
      : tab === 'topics'
        ? (topicsError ?? topicError)
        : tab === 'batches'
          ? batchesError
          : (topicsError ?? trendError);

  const retryActive = () => {
    if (tab === 'items') return loadItems(itemsMode);
    if (tab === 'batches') return loadBatches();
    if (topics == null) loadTopics();
    if (tab === 'topics' && topicId && !topicCache[topicId]) loadTopicReport(topicId);
    if (tab === 'trends' && !trendCache[trendKey]) loadTrend(days, trendTopicId);
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      if (tab === 'items') await loadItems(itemsMode);
      else if (tab === 'topics') {
        await loadTopics();
        if (topicId) await loadTopicReport(topicId);
      } else if (tab === 'batches') await loadBatches();
      else {
        await loadTopics();
        await loadTrend(days, trendTopicId);
      }
    } finally {
      setRefreshing(false);
    }
  };

  const refreshControl = (
    <RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={refresh} />
  );

  // ── The topic chip row, shared by Topics and Trends ──────────────────────

  const renderChips = () => {
    if (topics == null) {
      if (topicsError) return null;
      return (
        <View style={styles.chipsSkeleton}>
          {[96, 72, 116].map((w) => (
            <Skeleton key={w} width={w} height={38} radius={19} />
          ))}
        </View>
      );
    }
    if (topics.length === 0) return null;
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsScroll}
        contentContainerStyle={styles.chips}
      >
        {tab === 'trends' ? (
          <Chip
            label="Every topic"
            active={trendTopicId == null}
            onPress={() => setTrendTopicId(null)}
          />
        ) : null}
        {topics.map((t) => (
          <Chip
            key={t.id}
            label={t.name}
            active={tab === 'trends' ? trendTopicId === t.id : topicId === t.id}
            onPress={() =>
              tab === 'trends'
                ? setTrendTopicId(trendTopicId === t.id ? null : t.id)
                : setTopicId(topicId === t.id ? null : t.id)
            }
          />
        ))}
      </ScrollView>
    );
  };

  // ── Items — which questions are broken ───────────────────────────────────

  const renderItems = () => {
    const data = itemsCache[itemsMode];
    if (!data) return itemsError ? null : <CardsSkeleton count={4} />;

    const list = data.items ?? [];
    if (list.length === 0) {
      return itemsMode === 'flagged' ? (
        <EmptyState icon="check" title="No flagged questions" body="The bank looks healthy." />
      ) : (
        <EmptyState
          icon="target"
          title="Nothing to analyse yet"
          body="Item analysis needs at least 10 servings per question."
        />
      );
    }

    const anyFlagged = list.some((q) => q.flag);
    return (
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
      >
        <Text variant="meta" color={colors.inkFaint} style={styles.count}>
          {plural(data.total ?? list.length, 'question')}
        </Text>

        {list.map((item) => (
          <View key={item.id} style={[styles.card, elevation.raised]}>
            <View style={styles.cardHead}>
              <Text variant="label" style={{ flex: 1 }} numberOfLines={2}>
                {item.text}
              </Text>
              <FlagBadge flag={item.flag} />
            </View>
            <Text variant="meta" color={colors.inkFaint} style={styles.cardMeta} numberOfLines={1}>
              {[item.topics?.join(', '), cap(item.difficulty), plural(item.sampleSize ?? 0, 'answer')]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {item.percentCorrect != null ? (
              <View style={styles.itemStats}>
                <Text style={[type.label, styles.mono, { color: colors.ink }]}>
                  {Math.round(item.percentCorrect)}% correct
                </Text>
                <Text variant="meta" color={colors.inkFaint}>
                  {seconds(item.avgResponseMs ?? 0)} avg
                </Text>
                <View style={{ flex: 1 }} />
                <OptionSpread
                  distribution={item.optionDistribution}
                  correctIndex={correctIndexOf(item)}
                />
              </View>
            ) : (
              <Text variant="meta" color={colors.inkFaint} style={styles.itemStats}>
                Served, but no answers recorded yet.
              </Text>
            )}
          </View>
        ))}

        {anyFlagged ? (
          <View style={styles.footnote}>
            <Text variant="meta" color={colors.inkMuted}>
              Check key — under 20% of students pick the option marked correct, so the key may be
              wrong. Too easy — over 95% get it; it separates nobody.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    );
  };

  // ── Topics — how one topic plays ─────────────────────────────────────────

  const renderTopics = () => {
    if (topics == null) return null;
    if (topics.length === 0) {
      return (
        <EmptyState
          icon="book"
          title="No topics yet"
          body="Create a topic and it will report here once it is played."
        />
      );
    }
    if (!topicId) {
      return (
        <View style={styles.hint}>
          <Text variant="body" color={colors.inkMuted} style={{ textAlign: 'center' }}>
            Pick a topic to see how it plays.
          </Text>
        </View>
      );
    }

    const report = topicCache[topicId];
    if (!report) return topicError ? null : <CardsSkeleton count={2} />;

    const calibration = [...(report.difficultyCalibration ?? [])].sort((a, b) => {
      const rank = (d) => {
        const i = DIFFICULTY_ORDER.indexOf(d.difficulty);
        return i === -1 ? DIFFICULTY_ORDER.length : i;
      };
      return rank(a) - rank(b);
    });

    return (
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
      >
        <View style={[styles.card, elevation.raised]}>
          <View style={styles.statRow}>
            <Stat value={report.matchesPlayed ?? 0} label="Matches played" />
            <Stat value={report.participants ?? 0} label="Students" />
            <Stat value={`${report.accuracy ?? 0}%`} label="Accuracy" />
          </View>
          <View style={[styles.statRow, { marginTop: space.lg }]}>
            <Stat value={seconds(report.avgResponseMs ?? 0)} label="Avg answer" />
            <Stat value={`${report.timeoutRate ?? 0}%`} label="Timeouts" />
          </View>
        </View>

        <SectionHeader title="Difficulty calibration" style={{ marginTop: space.lg }} />
        <View style={[styles.card, elevation.raised]}>
          {calibration.length === 0 ? (
            <Text variant="meta" color={colors.inkFaint}>
              No published questions in this topic yet.
            </Text>
          ) : (
            calibration.map((row, i) => (
              <View key={row.difficulty} style={i > 0 ? styles.calRow : null}>
                <View style={styles.calHead}>
                  <Text variant="label">{cap(row.difficulty)}</Text>
                  <Text variant="meta" color={colors.inkFaint}>
                    {plural(row.questions ?? 0, 'question')} · {row.served ?? 0} served
                  </Text>
                </View>
                <View style={styles.barRow}>
                  <View style={{ flex: 1 }}>
                    <ProgressBar value={row.accuracy ?? 0} max={100} height={8} />
                  </View>
                  <Text style={[type.label, styles.mono, styles.barValue]}>
                    {row.accuracy != null ? `${Math.round(row.accuracy)}%` : '—'}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>

        <View style={styles.footnote}>
          <Text variant="meta" color={colors.inkMuted}>
            Easy should sit near 80%, medium near 60%, hard near 40%. Big gaps mean the difficulty
            labels are wrong.
          </Text>
        </View>
      </ScrollView>
    );
  };

  // ── Batches — which class is ahead ───────────────────────────────────────

  const renderBatches = () => {
    if (batches == null) return batchesError ? null : <CardsSkeleton count={3} />;
    if (batches.length === 0) {
      return (
        <EmptyState
          icon="friends"
          title="No batches yet"
          body="Group students into batches on the Students screen."
          actionLabel="Students"
          onAction={() => router.push('/admin/students')}
        />
      );
    }

    const maxScore = Math.max(...batches.map((b) => b.avgScore ?? 0), 1);
    return (
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
      >
        {batches.map((batch) => (
          <View key={batch.batchId} style={[styles.card, elevation.raised]}>
            <Text variant="label" numberOfLines={1}>
              {batch.name}
            </Text>
            <Text variant="meta" color={colors.inkFaint} style={styles.cardMeta} numberOfLines={1}>
              {plural(batch.activeStudents ?? 0, 'student')} · {plural(batch.matches ?? 0, 'match')}{' '}
              · {batch.avgMatchesPerStudent ?? 0} per student
            </Text>
            <View style={[styles.barRow, { marginTop: space.md }]}>
              <View style={{ flex: 1 }}>
                <ProgressBar value={batch.avgScore ?? 0} max={maxScore} height={8} />
              </View>
              <Text style={[type.label, styles.mono, styles.barValue]}>{batch.avgScore ?? 0}</Text>
            </View>
          </View>
        ))}
        <View style={styles.footnote}>
          <Text variant="meta" color={colors.inkMuted}>
            The bar is each batch&rsquo;s average match score, drawn against the highest batch.
          </Text>
        </View>
      </ScrollView>
    );
  };

  // ── Trends — is this period better than the last ─────────────────────────

  const renderTrends = () => {
    const trend = trendCache[trendKey];
    if (!trend) return trendError ? null : <CardsSkeleton count={1} />;

    const current = trend.current ?? {};
    const previous = trend.previous ?? {};
    const change = trend.change ?? {};

    if ((current.matches ?? 0) === 0 && (previous.matches ?? 0) === 0) {
      return (
        <EmptyState
          icon="clock"
          title="Nothing to compare"
          body="Nothing played in either period yet."
        />
      );
    }

    return (
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
      >
        <View style={[styles.card, elevation.raised]}>
          <Text variant="label" style={{ marginBottom: space.lg }}>
            {trend.labels?.current ?? `Last ${trend.days} days`} vs{' '}
            {trend.labels?.previous ?? `the ${trend.days} days before`}
          </Text>
          <View style={styles.tiles}>
            <DeltaTile
              label="Matches played"
              value={current.matches ?? 0}
              change={change.matches}
              previous={previous.matches ?? 0}
            />
            <DeltaTile
              label="Students playing"
              value={current.players ?? 0}
              change={change.players}
              previous={previous.players ?? 0}
            />
            <DeltaTile
              label="Average score"
              value={current.avgScore ?? 0}
              change={change.avgScore}
              previous={previous.avgScore ?? 0}
            />
            <DeltaTile
              label="Accuracy"
              value={`${current.accuracy ?? 0}%`}
              change={change.accuracy}
              previous={`${previous.accuracy ?? 0}%`}
              pts
            />
          </View>
        </View>
        <View style={styles.footnote}>
          <Text variant="meta" color={colors.inkMuted}>
            Accuracy moves in percentage points; everything else is a percentage change.
          </Text>
        </View>
      </ScrollView>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Reports" subtitle={adminSpace?.name} />

      <Segmented options={TABS} value={tab} onChange={setTab} style={styles.tabs} />

      {tab === 'items' ? (
        <Segmented
          options={ITEM_MODES}
          value={itemsMode}
          onChange={setItemsMode}
          style={styles.subTabs}
        />
      ) : null}
      {tab === 'trends' ? (
        <Segmented options={PERIODS} value={days} onChange={setDays} style={styles.subTabs} />
      ) : null}
      {tab === 'topics' || tab === 'trends' ? renderChips() : null}

      <ErrorNotice error={activeError} onRetry={retryActive} />

      {tab === 'items'
        ? renderItems()
        : tab === 'topics'
          ? renderTopics()
          : tab === 'batches'
            ? renderBatches()
            : renderTrends()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  tabs: { marginHorizontal: layout.gutter, marginTop: space.xs },
  subTabs: { marginHorizontal: layout.gutter, marginTop: space.md },
  chipsScroll: { flexGrow: 0, marginTop: space.md },
  chips: { paddingHorizontal: layout.gutter, gap: space.sm, paddingBottom: space.xs },
  chipsSkeleton: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: layout.gutter,
    marginTop: space.md,
    paddingBottom: space.xs,
  },
  body: { padding: layout.gutter, paddingTop: space.sm, paddingBottom: space.xxxl },
  count: { paddingBottom: space.sm },
  card: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    padding: layout.cardPadding,
    marginBottom: layout.cardGap,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  cardMeta: { marginTop: space.xs },
  itemStats: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  mono: { fontVariant: ['tabular-nums'] },
  spread: { flexDirection: 'row', gap: 6, alignItems: 'flex-end' },
  spreadCol: { alignItems: 'center', gap: 3 },
  spreadTrack: { height: 28, width: 10, justifyContent: 'flex-end' },
  spreadBar: { width: 10, borderRadius: 3 },
  flagPill: { paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: 7 },
  footnote: {
    backgroundColor: colors.canvas,
    borderRadius: layout.radiusInput,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: space.md,
    marginTop: space.xs,
  },
  hint: {
    flexGrow: 1,
    minHeight: 200,
    alignItems: 'center',
    justifyContent: 'center',
    padding: layout.gutter,
  },
  statRow: { flexDirection: 'row' },
  calRow: { marginTop: space.lg },
  calHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    marginBottom: space.sm,
  },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  barValue: { minWidth: 48, textAlign: 'right', color: colors.ink },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: { flexBasis: '47%', flexGrow: 1, gap: 2 },
});
