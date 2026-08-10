import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useConsoleBack } from '../../src/lib/consoleBack.js';
import { useConsoleSpace } from '../../src/lib/admin.js';
import {
  Text,
  Badge,
  ConsoleControls,
  CountRow,
  EmptyState,
  ErrorNotice,
  Header,
  IconDisc,
  SearchField,
  Select,
  useScrollBottom,
} from '../../src/components/ui.jsx';
import { ListSkeleton } from '../../src/components/Skeletons.jsx';
import { colors, consoleLayout, layout, space } from '../../src/theme/console.js';

/**
 * prd.md F9.1.4 — the audit trail, for either console.
 *
 * Every admin action and every impersonation session is written to `AuditLog`.
 * Mounted at `/super/audit` this is the PLATFORM's log — everything, everywhere,
 * including what we did to a tenant and who signed in as one of their admins.
 * Mounted at `/admin/audit` it is one organization's slice of the same table.
 * Impersonated rows are marked in both, because that is the whole reason an
 * audit exists.
 *
 * The organization's log had no screen. Forty of its rows were printed inline
 * at the bottom of Settings instead, under everything else that screen holds —
 * which is why Settings never seemed to end. It keeps the five most recent as a
 * preview and sends the rest here.
 *
 * ── Why it was rewritten ────────────────────────────────────────────────────
 *
 * It printed the database. Two hundred undifferentiated rows, each headed by
 * its raw key — `question.review.publish`, `space.create` — with a summary that
 * was an em-dash more often than not, an absolute timestamp on every single
 * line, and no way to ask it anything. Six consecutive rows reading
 * "question.review.publish / 1 questions / 6:59:31 pm, 6:59:30 pm, 6:59:30 pm…"
 * is one act of publishing, drawn six times, in a format only somebody who has
 * read the server would recognise.
 *
 * Four changes, and they are all the same change — an audit log is READ, so it
 * has to be written in words:
 *
 *   **A vocabulary.** `question.import` is "Questions imported". Unknown keys
 *   still resolve, through a humaniser rather than a lookup, so an action added
 *   to the server next week appears in sentence case instead of not at all.
 *
 *   **Days, not timestamps.** The date belongs to the section; the row keeps
 *   the clock time. "Today / Yesterday / 9 Sep 2026" is how anybody actually
 *   navigates a log.
 *
 *   **Runs collapse.** Identical action, actor, organization AND summary,
 *   inside five minutes, become one row with a `×6`. The condition is strict on
 *   purpose: two topics created back to back have different summaries, so they
 *   stay two rows with their two names. Nothing is hidden but a repeated
 *   timestamp, and the range is printed underneath.
 *
 *   **It can be questioned.** A search across the action, the summary, the
 *   actor and the organization, and a filter by what the action was about.
 *
 * Two hundred rows, so the list is VIRTUALIZED. A `ScrollView` of `.map()`
 * mounts every one of them at once and keeps them mounted.
 */

/** What the first segment of an action key is ABOUT. */
const DOMAIN_GROUP = {
  space: 'orgs',
  admin: 'orgs',
  super: 'orgs',
  topic: 'content',
  category: 'content',
  question: 'content',
  contest: 'content',
  assignment: 'content',
  session: 'content',
  tournament: 'content',
  report: 'content',
  moderation: 'content',
  central: 'content',
  student: 'people',
  user: 'people',
  batch: 'people',
  announce: 'platform',
  progression: 'platform',
};

const GROUPS = [
  { value: 'orgs', label: 'Organizations' },
  { value: 'content', label: 'Content' },
  { value: 'people', label: 'People' },
  { value: 'platform', label: 'Platform' },
];

/** The icon a group falls back to when the exact action is not in the book. */
const GROUP_ICON = { orgs: 'building', content: 'book', people: 'friends', platform: 'server' };

/**
 * The book. `[label, icon, tone]` — tone is the colour the disc takes, and it
 * means the same thing everywhere in both consoles: green did something good,
 * red took something away, amber is the one to look twice at.
 */
const VOCAB = {
  // ── Organizations ────────────────────────────────────────────────────────
  'space.create': ['Organization created', 'building'],
  'space.approve': ['Organization approved', 'check', 'good'],
  'space.reject': ['Application rejected', 'close', 'bad'],
  'space.suspend': ['Organization suspended', 'lock', 'bad'],
  'space.reactivate': ['Organization reactivated', 'check', 'good'],
  'space.plan': ['Plan changed', 'gear'],
  'space.settings': ['Settings changed', 'gear'],
  'space.rotate_join_code': ['Join code rotated', 'share'],
  'admin.role': ['Admin role changed', 'shield'],
  /** The row this whole screen exists for. */
  'super.impersonate': ['Support access', 'shield', 'warn'],

  // ── Content ──────────────────────────────────────────────────────────────
  'topic.create': ['Topic created', 'grid'],
  'topic.update': ['Topic edited', 'edit'],
  'category.create': ['Category created', 'grid'],
  'category.update': ['Category edited', 'edit'],
  'question.import': ['Questions imported', 'download'],
  'question.ai_draft': ['AI drafts generated', 'robot'],
  'question.review.publish': ['Question published', 'check', 'good'],
  'question.review.archive': ['Question archived', 'trash', 'bad'],
  'question.review.draft': ['Question sent back to draft', 'history'],
  'question.bulk.publish': ['Questions published', 'check', 'good'],
  'question.bulk.archive': ['Questions archived', 'trash', 'bad'],
  'question.bulk.draft': ['Questions sent back to draft', 'history'],
  'question.bulk.review': ['Questions sent for review', 'clock'],
  'central.feature': ['Featured in the Central bank', 'sparkle'],
  'report.resolve': ['Report resolved', 'shield', 'good'],
  'moderation.dismiss': ['Report dismissed', 'close'],
  'moderation.archive_question': ['Reported question archived', 'trash', 'bad'],
  'moderation.warn_user': ['Player warned', 'alert', 'warn'],
  'moderation.suspend_user': ['Player suspended', 'lock', 'bad'],
  'moderation.ban_user': ['Player banned', 'lock', 'bad'],
  'contest.create': ['Contest created', 'trophy'],
  'contest.update': ['Contest edited', 'edit'],
  'contest.questions': ['Contest questions set', 'book'],
  'contest.finalise': ['Contest finalised', 'check', 'good'],
  'assignment.create': ['Assignment set', 'calendar'],
  'assignment.update': ['Assignment edited', 'edit'],
  'assignment.archive': ['Assignment archived', 'trash', 'bad'],
  'session.create': ['Live session created', 'play'],
  'tournament.create': ['Tournament created', 'ranks'],
  'tournament.start': ['Tournament started', 'play', 'good'],
  'tournament.cancel': ['Tournament cancelled', 'close', 'bad'],

  // ── People ───────────────────────────────────────────────────────────────
  'user.status': ['Account status changed', 'friends'],
  'student.approve': ['Student approved', 'check', 'good'],
  'student.reject': ['Student rejected', 'close', 'bad'],
  'student.suspend': ['Student suspended', 'lock', 'bad'],
  'student.remove': ['Student removed', 'trash', 'bad'],
  'student.restore': ['Student restored', 'check', 'good'],
  'student.batch': ['Student moved to a batch', 'grid'],
  'batch.create': ['Batch created', 'grid'],
  'batch.update': ['Batch edited', 'edit'],
  'batch.delete': ['Batch deleted', 'trash', 'bad'],

  // ── Platform ─────────────────────────────────────────────────────────────
  announce: ['Announcement sent', 'megaphone'],
  'progression.curve': ['XP curve changed', 'chart', 'warn'],
  'progression.leagues': ['Leagues changed', 'ranks', 'warn'],
  'progression.divisions': ['Divisions changed', 'ranks', 'warn'],
  'progression.cosmetic': ['Cosmetic saved', 'sparkle'],
  'progression.cosmetic.delete': ['Cosmetic removed', 'trash', 'bad'],
  'progression.chest': ['Chest saved', 'gift'],
  'progression.chest.delete': ['Chest removed', 'trash', 'bad'],
};

/**
 * An action key, in words.
 *
 * The fallback is the point: this screen must never be the reason a new server
 * action is invisible, so anything not in the book is humanised — `foo.bar_baz`
 * becomes "Foo bar baz" — and grouped by its first segment.
 */
function describe(action) {
  const key = String(action ?? '');
  const group = DOMAIN_GROUP[key.split('.')[0]] ?? 'platform';
  const known = VOCAB[key];
  if (known) return { label: known[0], icon: known[1], tone: known[2] ?? 'plain', group, key };
  const words = key.replace(/[._]/g, ' ').trim() || 'Action';
  return {
    label: words.charAt(0).toUpperCase() + words.slice(1),
    icon: GROUP_ICON[group],
    tone: 'plain',
    group,
    key,
  };
}

/** Five minutes. Beyond that two identical acts are two acts. */
const RUN_WINDOW = 5 * 60 * 1000;

/**
 * Consecutive identical entries, folded into one.
 *
 * Strict by design — the action, the actor, the organization, the impersonation
 * flag and the summary all have to match — so the only thing a fold can ever
 * cost is a repeated timestamp, and the row prints the range it covers.
 */
function collapse(rows) {
  const out = [];
  for (const row of rows) {
    const prev = out[out.length - 1];
    const same =
      prev &&
      prev.action === row.action &&
      prev.actor === row.actor &&
      prev.space === row.space &&
      prev.impersonated === row.impersonated &&
      (prev.summary ?? '') === (row.summary ?? '');
    // Rows arrive newest first, so `at` runs downwards; the span is measured
    // against the newest of the run rather than its neighbour, or a long
    // trickle of identical rows would chain into one entry hours wide.
    if (same && new Date(prev.at) - new Date(row.at) <= RUN_WINDOW) {
      prev.count += 1;
      prev.firstAt = row.at;
      continue;
    }
    out.push({ ...row, count: 1, firstAt: row.at });
  }
  return out;
}

const DAY = 24 * 60 * 60 * 1000;

/** "Today", "Yesterday", or the date. What a section of the log is called. */
function dayLabel(at) {
  const when = new Date(at);
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  if (when >= midnight) return 'Today';
  if (when >= new Date(midnight.getTime() - DAY)) return 'Yesterday';
  return when.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: when.getFullYear() === midnight.getFullYear() ? undefined : 'numeric',
  });
}

function clockTime(at) {
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function ConsoleAudit() {
  const scrollBottom = useScrollBottom();
  const goBack = useConsoleBack();
  const { spaceId, base, spaceName, inTenant } = useConsoleSpace();
  /**
   * The platform log, or one organization's — the only difference in the file.
   *
   * `/super/audit` with nothing narrowing it is everything, everywhere. Given a
   * `spaceId` (which is how the organization detail screen opens it) it is that
   * tenant's slice, read through the same endpoint their own admins use.
   */
  const platform = base === '/super' && !inTenant;
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [group, setGroup] = useState(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    if (!platform && !spaceId) return;
    try {
      setError(null);
      // 200 either way — the same depth the platform log has always had, and
      // the most `/admin/audit` will serve.
      const data = platform
        ? await api.get('/super/audit')
        : await api.get('/admin/audit', { spaceId, limit: 200 });
      setRows(data.items ?? []);
    } catch (err) {
      setError(err);
    }
  }, [platform, spaceId]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Describe once, then filter, fold and section. Two hundred rows is small
   * enough to do all of it here and nowhere near enough to justify asking the
   * server for a second, narrower page every time a letter is typed.
   */
  const { data, matched, counts } = useMemo(() => {
    const described = (rows ?? []).map((row) => ({ ...row, meaning: describe(row.action) }));
    const tally = {};
    for (const row of described) tally[row.meaning.group] = (tally[row.meaning.group] ?? 0) + 1;

    const needle = query.trim().toLowerCase();
    const kept = described.filter((row) => {
      if (group && row.meaning.group !== group) return false;
      if (!needle) return true;
      return [row.meaning.label, row.action, row.summary, row.actor, row.space]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    });

    // Section headers ride in the same array as the rows: one FlatList, one
    // scroll, and no SectionList restructure for what is a label every so often.
    const flat = [];
    let day = null;
    for (const row of collapse(kept)) {
      const label = dayLabel(row.at);
      if (label !== day) {
        day = label;
        flat.push({ kind: 'day', id: `day-${label}`, label });
      }
      flat.push({ kind: 'row', id: row.id, row });
    }
    return { data: flat, matched: kept.length, counts: tally };
  }, [rows, group, query]);

  const filtering = Boolean(group) || query.trim().length > 0;

  // Without a space there is nothing to read, and `load` returns early — which
  // would otherwise leave the skeleton up for ever.
  if (!platform && !spaceId) {
    return (
      <SafeAreaView style={styles.screen} edges={[]}>
        <Header title="Activity log" />
        <EmptyState
          tone="oversight"
          icon="alert"
          title="No organization to manage"
          body="This console appears when an organization has made you an admin."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={[]}>
      <Header
        title={platform ? 'Audit trail' : 'Activity log'}
        subtitle={platform ? 'The last 200 actions' : (spaceName ?? 'The last 200 actions')}
        // Reached from an organization it is a pushed screen; from either
        // sidebar it is a sidebar screen.
        onBack={inTenant ? goBack : undefined}
      />

      <ConsoleControls>
        <SearchField
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          placeholder="An action, a person, an organization"
          autoCapitalize="none"
        />
        <Select
          value={group}
          options={[
            { value: null, label: 'Everything', meta: `${rows?.length ?? 0} actions` },
            ...GROUPS.map((g) => ({ ...g, meta: `${counts[g.value] ?? 0} actions` })),
          ]}
          onChange={setGroup}
          placeholder="Everything"
        />
      </ConsoleControls>

      <ErrorNotice error={error} onRetry={load} />

      {!rows && !error ? (
        <ListSkeleton rows={8} />
      ) : rows?.length === 0 ? (
        <EmptyState
          tone="oversight"
          icon="history"
          title="Nothing recorded yet"
          body="Admin actions and impersonation sessions appear here as they happen."
        />
      ) : matched === 0 ? (
        <EmptyState
          tone="oversight"
          icon="search"
          title="Nothing matches"
          body="No action in the last 200 matches that. Try a different word, or widen the filter."
        />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) =>
            item.kind === 'day' ? <DayHeader label={item.label} /> : <AuditRow row={item.row} />
          }
          contentContainerStyle={[styles.list, { paddingBottom: scrollBottom }]}
          showsVerticalScrollIndicator={false}
          initialNumToRender={14}
          windowSize={7}
          removeClippedSubviews
          ListHeaderComponent={
            filtering ? <CountRow shown={matched} total={rows.length} noun="action" /> : null
          }
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
        />
      )}
    </SafeAreaView>
  );
}

/** The date this run of rows happened on. Says it once, not on every line. */
const DayHeader = memo(function DayHeader({ label }) {
  return (
    <View style={styles.dayHeader}>
      <Text variant="label" color={colors.inkMuted}>
        {label}
      </Text>
      <View style={styles.dayRule} />
    </View>
  );
});

/** Memoized: virtualization only pays if a recycled row does not re-render. */
const AuditRow = memo(function AuditRow({ row }) {
  const { label, icon, tone } = row.meaning;
  /**
   * A VERDICT palette, not a domain one — an audit row is coloured by what the
   * action did (green gave something, red took something away, amber is worth a
   * second look), which is a different axis from what it was about. `IconDisc`
   * takes an explicit pair for exactly this case.
   */
  const disc = {
    good: { hue: colors.correct, soft: colors.correctSoft },
    bad: { hue: colors.wrong, soft: colors.wrongSoft },
    warn: { hue: colors.optionC, soft: colors.amberSoft },
    plain: { hue: colors.accent, soft: colors.accentSoft },
  }[tone];

  const who = [row.actor, row.space].filter(Boolean).join('  ·  ');

  return (
    <View style={styles.row}>
      <IconDisc name={icon} tone={disc} size={34} />

      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <View style={styles.head}>
          <Text variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>
            {label}
          </Text>
          {row.count > 1 ? <Badge label={`×${row.count}`} tone="soft" /> : null}
          {row.impersonated ? <Badge label="Impersonated" tone="danger" /> : null}
        </View>

        {/* The server's own note, when it wrote one — the topic's name, the
            status that was set. Absent on plenty of actions, and a row with an
            em-dash where a sentence should be reads as missing data. */}
        {row.summary ? (
          <Text variant="meta" color={colors.inkMuted} numberOfLines={2}>
            {row.summary}
          </Text>
        ) : null}

        <Text variant="tiny" color={colors.inkFaint} numberOfLines={1}>
          {row.count > 1 ? `${who}  ·  ${clockTime(row.firstAt)}–${clockTime(row.at)}` : who}
        </Text>
      </View>

      <Text variant="tiny" color={colors.inkFaint} style={styles.time}>
        {clockTime(row.at)}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  list: { paddingHorizontal: consoleLayout.gutter, paddingTop: space.md },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.lg,
    paddingBottom: space.sm,
  },
  dayRule: { flex: 1, height: 1, backgroundColor: colors.hairline },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusInput,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: space.md,
    marginBottom: space.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  /** Tabular figures would be better, but a clock time is short enough to pin. */
  time: { minWidth: 58, textAlign: 'right' },
});
