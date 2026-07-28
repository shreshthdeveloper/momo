import { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useIsSuperadmin } from '../../src/lib/admin.js';
import {
  Text,
  Avatar,
  Badge,
  Button,
  ConfirmSheet,
  EmptyState,
  ErrorNotice,
  Segmented,
} from '../../src/components/ui.jsx';
import { CardsSkeleton, ListSkeleton } from '../../src/components/Skeletons.jsx';
import ConsoleHeader from '../../src/components/ConsoleHeader.jsx';
import Icon from '../../src/components/Icon.jsx';
import { QUESTION_TEXT_SOFT_MAX } from '../../src/shared/constants.js';
import { colors, elevation, layout, space, type } from '../../src/theme/index.js';

/**
 * Moderation, in the order the work arrives: reported questions, reported
 * players, then the machine's own suspicions (speed flags).
 *
 * A question report shows the question exactly as the player saw it — text,
 * four options, the keyed answer marked — because the judgement being made is
 * "was the player right to report this", and that cannot be made from a
 * summary. When the item analysis itself backs the report, the card says so
 * out loud.
 *
 * The server 403s non-superadmins on every /super route; nothing here is
 * space-scoped — no spaceId anywhere.
 */
const TABS = [
  { value: 'question', label: 'Questions' },
  { value: 'user', label: 'Users' },
  { value: 'flags', label: 'Flags' },
];

/** Only the report the data can contradict gets the red badge. */
const REASONS = {
  wrong_answer: { label: 'Wrong answer key', tone: 'wrong' },
  typo: { label: 'Typo', tone: 'ink' },
  offensive: { label: 'Offensive', tone: 'ink' },
  duplicate: { label: 'Duplicate', tone: 'ink' },
  cheating: { label: 'Cheating', tone: 'ink' },
  harassment: { label: 'Harassment', tone: 'ink' },
  other: { label: 'Other', tone: 'ink' },
};

function ago(iso) {
  if (!iso) return '';
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function SuperModeration() {
  const router = useRouter();
  const isSuper = useIsSuperadmin();

  const [tab, setTab] = useState('question');
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // { type: 'archive' | 'warn' | 'suspendReport', report }
  const [confirm, setConfirm] = useState(null);
  // The flagged player being suspended through the reason sheet.
  const [flagTarget, setFlagTarget] = useState(null);
  const [flagBusy, setFlagBusy] = useState(false);
  const [flagError, setFlagError] = useState(null);

  useEffect(() => {
    if (!isSuper) router.replace('/');
  }, [isSuper, router]);

  const load = useCallback(async () => {
    if (!isSuper) return;
    try {
      setError(null);
      const data =
        tab === 'flags'
          ? await api.get('/super/moderation/flags')
          : await api.get('/super/moderation/reports', { targetType: tab, status: 'open' });
      setItems(data.items ?? []);
    } catch (err) {
      setError(err);
    }
  }, [isSuper, tab]);

  useEffect(() => {
    setItems(null);
    load();
  }, [load]);

  /**
   * Optimistic removal: the card leaves the queue the moment the decision is
   * made, and comes back only if the server refuses it.
   */
  const resolve = async (report, action) => {
    setConfirm(null);
    const previous = items;
    setItems((current) => (current ?? []).filter((r) => r.id !== report.id));
    try {
      setError(null);
      await api.post(`/super/moderation/reports/${report.id}/resolve`, { action });
    } catch (err) {
      setItems(previous);
      setError(err);
    }
  };

  const suspendFlagged = async (reason) => {
    setFlagBusy(true);
    try {
      setFlagError(null);
      await api.post(`/super/users/${flagTarget.id}/status`, { status: 'suspended', reason });
      setFlagTarget(null);
      await load();
    } catch (err) {
      setFlagError(err);
    } finally {
      setFlagBusy(false);
    }
  };

  if (!isSuper) return null;

  const confirmCopy = confirm
    ? {
        archive: {
          title: 'Archive this question?',
          body: 'It leaves play everywhere immediately. Matches already played keep their results.',
          confirmLabel: 'Archive question',
          destructive: true,
          icon: 'flag',
          action: 'archive_question',
        },
        warn: {
          title: `Warn ${confirm.report.user?.displayName ?? 'this player'}?`,
          body: 'They get a warning notification naming the report. Nothing else changes.',
          confirmLabel: 'Send warning',
          destructive: false,
          icon: 'bell',
          action: 'warn_user',
        },
        suspendReport: {
          title: `Suspend ${confirm.report.user?.displayName ?? 'this player'}?`,
          body: 'They cannot play anywhere until reactivated.',
          confirmLabel: 'Suspend player',
          destructive: true,
          icon: 'alert',
          action: 'suspend_user',
        },
      }[confirm.type]
    : null;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ConsoleHeader title="Moderation" subtitle="Reports and cheat flags" />

      <Segmented options={TABS} value={tab} onChange={setTab} style={styles.tabs} />

      <ErrorNotice error={error} onRetry={load} />

      {!items && !error ? (
        tab === 'flags' ? (
          <ListSkeleton rows={6} />
        ) : (
          <CardsSkeleton count={3} lines={3} bar={false} />
        )
      ) : !items ? null : items.length === 0 ? (
        tab === 'flags' ? (
          <EmptyState icon="check" title="Nobody is at five flags." body="Players whose answer speed crosses the threshold appear here." />
        ) : (
          <EmptyState
            icon="check"
            title="Queue clear"
            body={tab === 'question' ? 'No open reports on questions.' : 'No open reports on players.'}
          />
        )
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
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
          {tab === 'flags' ? (
            <>
              {/* The explainer earns the list its severity: one flag is noise,
                  the pattern is the signal. */}
              <View style={[styles.card, elevation.raised]}>
                <View style={styles.explainerRow}>
                  <Icon name="bolt" size={16} color={colors.accent} />
                  <Text variant="body" color={colors.inkMuted} style={{ flex: 1 }}>
                    A single fast answer means nothing — a player can already know the answer. A
                    pattern of sub-300ms answers across matches does not happen by hand.
                  </Text>
                </View>
              </View>
              {items.map((row) => (
                <View key={row.id} style={styles.flagRow}>
                  <Avatar url={row.avatarUrl} name={row.displayName} size={44} />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <View style={styles.nameRow}>
                      <Text variant="label" style={{ flexShrink: 1 }} numberOfLines={1}>
                        {row.displayName}
                      </Text>
                      <Text variant="meta" color={colors.wrong}>
                        {row.flags} {row.flags === 1 ? 'flag' : 'flags'}
                      </Text>
                    </View>
                    <Text variant="meta" color={colors.inkFaint} numberOfLines={1} style={styles.tabular}>
                      {row.matchesPlayed} {row.matchesPlayed === 1 ? 'match' : 'matches'}  ·  rating {row.overallRating}
                    </Text>
                  </View>
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Suspend"
                    fullWidth={false}
                    onPress={() => {
                      setFlagError(null);
                      setFlagTarget(row);
                    }}
                  />
                </View>
              ))}
            </>
          ) : tab === 'question' ? (
            items.map((report) => (
              <QuestionReportCard
                key={report.id}
                report={report}
                onArchive={() => setConfirm({ type: 'archive', report })}
                onDismiss={() => resolve(report, 'dismiss')}
              />
            ))
          ) : (
            items.map((report) => (
              <UserReportCard
                key={report.id}
                report={report}
                onWarn={() => setConfirm({ type: 'warn', report })}
                onSuspend={() => setConfirm({ type: 'suspendReport', report })}
                onDismiss={() => resolve(report, 'dismiss')}
              />
            ))
          )}
        </ScrollView>
      )}

      <ConfirmSheet
        visible={Boolean(confirm)}
        destructive={Boolean(confirmCopy?.destructive)}
        icon={confirmCopy?.icon}
        title={confirmCopy?.title ?? ''}
        body={confirmCopy?.body}
        confirmLabel={confirmCopy?.confirmLabel ?? 'Confirm'}
        onConfirm={() => resolve(confirm.report, confirmCopy.action)}
        onCancel={() => setConfirm(null)}
      />

      <ReasonSheet
        visible={Boolean(flagTarget)}
        destructive
        title={`Suspend ${flagTarget?.displayName ?? ''}?`}
        body="They cannot play anywhere until reactivated. The reason is kept with the action."
        initialValue="Automated answering"
        confirmLabel="Suspend player"
        loading={flagBusy}
        error={flagError}
        onConfirm={suspendFlagged}
        onCancel={() => setFlagTarget(null)}
      />
    </SafeAreaView>
  );
}

/**
 * The question as the player saw it, then the report's claim beside the data's
 * answer. When the item analysis flags the key as suspect, the card commits:
 * the reporter is probably right.
 */
function QuestionReportCard({ report, onArchive, onDismiss }) {
  const reason = REASONS[report.reason] ?? REASONS.other;
  const question = report.question;
  const percent = question?.itemAnalysis?.percentCorrect;
  const suspect = question?.itemAnalysis?.flag === 'suspect_key';

  return (
    <View style={[styles.card, elevation.raised]}>
      <View style={styles.cardHead}>
        <Badge label={reason.label} tone={reason.tone} />
      </View>
      <Text variant="meta" color={colors.inkFaint} numberOfLines={1} style={styles.reportMeta}>
        {report.space}  ·  reported by {report.reportedBy ?? 'a player'}  ·  {ago(report.at)}
      </Text>
      {report.note ? (
        <Text variant="body" color={colors.inkMuted} style={styles.note}>
          {'“'}
          {report.note}
          {'”'}
        </Text>
      ) : null}

      {question ? (
        <>
          <Text
            style={[
              question.text.length > QUESTION_TEXT_SOFT_MAX ? type.questionLong : type.question,
              styles.question,
            ]}
          >
            {question.text}
          </Text>

          {question.options.map((option, i) => {
            const keyed = i === question.correctIndex;
            return (
              <View key={i} style={[styles.option, keyed && styles.optionKeyed]}>
                <Text style={[type.option, { flex: 1, color: keyed ? colors.correct : colors.ink }]}>
                  {option}
                </Text>
                {keyed ? <Icon name="check" size={15} color={colors.correct} /> : null}
              </View>
            );
          })}

          <Text variant="meta" color={colors.inkMuted} style={styles.keyLine}>
            Marked correct: {question.options[question.correctIndex]}
            {percent != null ? `  ·  ${Math.round(percent)}% of students pick it` : ''}
          </Text>
          {suspect ? (
            <Text variant="label" color={colors.wrong} style={styles.suspectLine}>
              — the data agrees with the report
            </Text>
          ) : null}
        </>
      ) : (
        <Text variant="meta" color={colors.inkFaint} style={styles.reportMeta}>
          The question is no longer available.
        </Text>
      )}

      <View style={styles.decisions}>
        {question ? (
          <Button label="Archive the question" size="md" variant="danger" style={{ flex: 1 }} onPress={onArchive} />
        ) : null}
        <Button label="Dismiss" size="md" variant="ghost" style={{ flex: 1 }} onPress={onDismiss} />
      </View>
    </View>
  );
}

function UserReportCard({ report, onWarn, onSuspend, onDismiss }) {
  const reason = REASONS[report.reason] ?? REASONS.other;
  const user = report.user;
  const cheatFlags = user?.cheatFlags ?? 0;

  return (
    <View style={[styles.card, elevation.raised]}>
      <View style={styles.cardHead}>
        <Badge label={reason.label} tone={reason.tone} />
        <Text variant="meta" color={colors.inkFaint}>
          {ago(report.at)}
        </Text>
      </View>

      {user ? (
        <>
          <View style={styles.nameRow}>
            <Text variant="label" style={{ flexShrink: 1 }} numberOfLines={1}>
              {user.displayName}
            </Text>
            {cheatFlags > 0 ? (
              <Text variant="meta" color={colors.wrong}>
                {cheatFlags} cheat {cheatFlags === 1 ? 'flag' : 'flags'}
              </Text>
            ) : null}
          </View>
          {user.status === 'suspended' ? (
            <Text variant="meta" color={colors.inkFaint} style={{ marginTop: 2 }}>
              Already suspended
            </Text>
          ) : null}
        </>
      ) : (
        <Text variant="meta" color={colors.inkFaint}>
          The player is no longer available.
        </Text>
      )}

      {report.note ? (
        <Text variant="body" color={colors.inkMuted} style={styles.note}>
          {'“'}
          {report.note}
          {'”'}
        </Text>
      ) : null}

      <View style={styles.decisions}>
        {user ? (
          <>
            <Button label="Warn" size="sm" variant="soft" fullWidth={false} onPress={onWarn} />
            <Button label="Suspend" size="sm" variant="ghost" fullWidth={false} onPress={onSuspend} />
          </>
        ) : null}
        <Button label="Dismiss" size="sm" variant="ghost" fullWidth={false} onPress={onDismiss} />
      </View>
    </View>
  );
}

/**
 * A ConfirmSheet that asks for a sentence — same shape as the one on the
 * organizations screen. The reason arrives prefilled here because the flags list
 * has exactly one cause; the operator can still rewrite it.
 */
function ReasonSheet({
  visible,
  title,
  body,
  placeholder,
  confirmLabel,
  destructive = false,
  initialValue = '',
  minLength = 1,
  loading = false,
  error,
  onConfirm,
  onCancel,
}) {
  const [text, setText] = useState(initialValue);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (visible) setText(initialValue);
  }, [visible, initialValue]);

  const valid = text.trim().length >= minLength;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={({ pressed }) => [styles.sheetScrim, pressed && { opacity: 0.7 }]} onPress={loading ? undefined : onCancel}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} pointerEvents="box-none">
          <Pressable style={[styles.sheet, elevation.sheet]} onPress={() => {}}>
            <View style={styles.sheetGrabber} />
            <Text variant="display" style={{ marginBottom: space.sm }}>
              {title}
            </Text>
            {body ? (
              <Text variant="body" color={colors.inkMuted} style={{ marginBottom: space.lg }}>
                {body}
              </Text>
            ) : null}
            <TextInput
              style={[styles.reasonInput, focused && styles.reasonInputFocused]}
              value={text}
              onChangeText={setText}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={placeholder}
              placeholderTextColor={colors.inkFaint}
              maxLength={300}
              multiline
              accessibilityLabel={placeholder ?? 'Reason'}
            />
            <ErrorNotice error={error} />
            <Button
              variant={destructive ? 'danger' : 'primary'}
              label={confirmLabel}
              loading={loading}
              disabled={!valid}
              style={{ marginTop: space.lg }}
              onPress={() => onConfirm(text.trim())}
            />
            <Button variant="soft" label="Cancel" disabled={loading} style={{ marginTop: space.md }} onPress={onCancel} />
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  tabs: { marginHorizontal: layout.gutter, marginTop: space.xs, marginBottom: space.sm },
  list: { paddingHorizontal: layout.gutter, paddingTop: space.xs, paddingBottom: space.xxxl },
  card: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    padding: layout.cardPadding,
    marginBottom: layout.cardGap,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    marginBottom: space.sm,
  },
  reportMeta: { marginBottom: space.sm },
  note: { marginBottom: space.md },
  question: { color: colors.ink, marginBottom: space.md },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 44,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: layout.radiusInput,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    marginBottom: space.sm,
  },
  optionKeyed: { borderColor: colors.correct, backgroundColor: colors.correctSoft },
  keyLine: { marginTop: space.xs },
  suspectLine: { marginTop: space.xs },
  decisions: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.lg },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  explainerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  flagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 68,
    paddingVertical: space.sm,
  },
  tabular: { fontVariant: ['tabular-nums'] },
  sheetScrim: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.canvas,
    borderTopLeftRadius: layout.radiusCard + 8,
    borderTopRightRadius: layout.radiusCard + 8,
    padding: layout.gutter,
    paddingBottom: space.xxxl,
  },
  sheetGrabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.hairline,
    alignSelf: 'center',
    marginBottom: space.lg,
  },
  reasonInput: {
    ...type.option,
    color: colors.ink,
    backgroundColor: colors.sunken,
    borderRadius: layout.radiusInput,
    borderWidth: 1.5,
    borderColor: colors.transparent,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
    minHeight: 54,
    maxHeight: 120,
    textAlignVertical: 'top',
    marginBottom: space.sm,
  },
  reasonInputFocused: { borderColor: colors.accent, backgroundColor: colors.canvas },
});
