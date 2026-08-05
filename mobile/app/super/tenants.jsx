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
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { api } from '../../src/lib/api.js';
import { useIsSuperadmin } from '../../src/lib/admin.js';
import {
  Text,
  Badge,
  Button,
  ConfirmSheet,
  EmptyState,
  ErrorNotice,
  FULL_BLEED_MODAL,
  useBottomInset,
  RowMenu,
  SearchField,
  Tabs,
  Header,
  CountRow,
  ConsoleFooter,
} from '../../src/components/ui.jsx';
import { CardsSkeleton } from '../../src/components/Skeletons.jsx';
import { colors, consoleLayout, elevation, fonts, layout, space, type } from '../../src/theme/index.js';

/**
 * Every tenant on the platform. A pending organization is a person waiting at the
 * door, so approvals sit one tap from the dashboard; suspension and support
 * access are the two levers the operator pulls after that.
 *
 * Support access is deliberately loud: the confirmation names the audit trail
 * before asking for a reason, because the whole point of the mechanism is that
 * the organization's own admins can see it happened. The returned token is never
 * stored or used here — logging the access is the feature.
 *
 * The server 403s non-superadmins on every /super route, and nothing here is
 * space-scoped — no spaceId anywhere.
 */
const TABS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
];

function shortDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function SuperTenants() {
  const router = useRouter();
  const isSuper = useIsSuperadmin();

  const [status, setStatus] = useState('all');
  const [rows, setRows] = useState(null);
  const [query, setQuery] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);

  // One sheet at a time: suspend confirms, reject and support access collect a
  // reason, and a successful support log shows the note that was written.
  const [suspendTarget, setSuspendTarget] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [supportTarget, setSupportTarget] = useState(null);
  const [supportResult, setSupportResult] = useState(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState(null);

  useEffect(() => {
    if (!isSuper) router.replace('/');
  }, [isSuper, router]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(query), 350);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    if (!isSuper) return;
    try {
      setError(null);
      const data = await api.get('/super/spaces', {
        status: status === 'all' ? undefined : status,
        q: debouncedQ.trim() || undefined,
      });
      setRows(data.items ?? []);
    } catch (err) {
      setError(err);
    }
  }, [isSuper, status, debouncedQ]);

  // A tab switch is a different question, so the skeleton returns; a search
  // refinement is the same question narrowing, so the list stays put while the
  // fresh answer loads.
  useEffect(() => {
    setRows(null);
  }, [status]);

  // Reloads on focus rather than on mount: the create form finishes by coming
  // straight back here, and the new organization has to already be in the list.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const decide = async (spaceRow, decision, reason) => {
    setBusyId(spaceRow.id);
    setSheetBusy(true);
    try {
      setError(null);
      setSheetError(null);
      await api.post(`/super/spaces/${spaceRow.id}/decision`, reason ? { decision, reason } : { decision });
      setSuspendTarget(null);
      setRejectTarget(null);
      await load();
    } catch (err) {
      // If a sheet is open the error belongs inside it; otherwise at the top.
      if (rejectTarget || suspendTarget) setSheetError(err);
      else setError(err);
    } finally {
      setBusyId(null);
      setSheetBusy(false);
    }
  };

  const logSupportAccess = async (reason) => {
    setSheetBusy(true);
    try {
      setSheetError(null);
      const data = await api.post(`/super/spaces/${supportTarget.id}/impersonate`, { reason });
      setSupportTarget(null);
      setSupportResult(data);
    } catch (err) {
      setSheetError(err);
    } finally {
      setSheetBusy(false);
    }
  };

  if (!isSuper) return null;

  const searching = debouncedQ.trim().length > 0;
  const emptyCopy = searching
    ? { title: 'Nothing matches', body: 'No organization name matches that search.' }
    : {
        all: { title: 'No organizations yet', body: 'Create the first organization to bring a school or company onto Mimo.' },
        pending: { title: 'Nobody waiting', body: 'New organization requests appear here for approval.' },
        active: { title: 'No active organizations', body: 'Approved organizations appear here.' },
        suspended: { title: 'None suspended', body: 'Suspended organizations appear here until reactivated.' },
      }[status];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Organizations" subtitle="Approvals, suspensions, support access" />

      <Tabs options={TABS} value={status} onChange={setStatus} />
      <SearchField
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        onClear={() => setQuery('')}
        placeholder="Find an organization"
        autoCapitalize="none"
      />

      <ErrorNotice error={error} onRetry={load} />

      {!rows && !error ? (
        <CardsSkeleton count={4} lines={2} bar={false} />
      ) : !rows ? null : rows.length === 0 ? (
        <EmptyState icon="home" title={emptyCopy.title} body={emptyCopy.body} />
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
          <CountRow total={rows.length} noun="organization" />

          {rows.map((row) => (
            <TenantCard
              key={row.id}
              row={row}
              busy={busyId === row.id}
              onApprove={() => decide(row, 'approve')}
              onReject={() => {
                setSheetError(null);
                setRejectTarget(row);
              }}
              onSupport={() => {
                setSheetError(null);
                setSupportTarget(row);
              }}
              onSuspend={() => {
                setSheetError(null);
                setSuspendTarget(row);
              }}
              onReactivate={() => decide(row, 'reactivate')}
            />
          ))}
        </ScrollView>
      )}

      {rows ? (
        <ConsoleFooter>
          <Button label="New organization" onPress={() => router.push('/super/tenant-new')} />
        </ConsoleFooter>
      ) : null}

      {/* ── Suspend: destructive, so it names the consequence. */}
      <ConfirmSheet
        visible={Boolean(suspendTarget)}
        destructive
        icon="alert"
        title={`Suspend ${suspendTarget?.name ?? ''}?`}
        body="Their students and admins lose access immediately. Data stays, and the organization can be reactivated later."
        confirmLabel="Suspend organization"
        loading={sheetBusy}
        onConfirm={() => decide(suspendTarget, 'suspend')}
        onCancel={() => setSuspendTarget(null)}
      />

      {/* ── Reject: refused with a reason, kept with the decision. */}
      <ReasonSheet
        visible={Boolean(rejectTarget)}
        destructive
        title={`Reject ${rejectTarget?.name ?? ''}?`}
        body="The organization is refused. The reason is kept with the decision."
        placeholder="Why it is being rejected"
        confirmLabel="Reject organization"
        loading={sheetBusy}
        error={sheetError}
        onConfirm={(reason) => decide(rejectTarget, 'reject', reason)}
        onCancel={() => setRejectTarget(null)}
      />

      {/* ── Support access: the reason is written where their admins read. */}
      <ReasonSheet
        visible={Boolean(supportTarget)}
        title="Log support access"
        body="This is written to the organization's own audit log, where their admins will see it."
        placeholder="Ticket #482 — import failing"
        confirmLabel="Log access"
        minLength={4}
        loading={sheetBusy}
        error={sheetError}
        onConfirm={logSupportAccess}
        onCancel={() => setSupportTarget(null)}
      />

      {/* ── The note that was written, shown back. The token is not kept. */}
      <ConfirmSheet
        visible={Boolean(supportResult)}
        icon="user"
        title="Access logged"
        body={
          supportResult
            ? `${supportResult.note ?? ''}\n\nActing as ${supportResult.actingAs?.displayName ?? "the organization's admin"} in ${supportResult.space?.name ?? 'their space'}.`.trim()
            : ''
        }
        confirmLabel="Done"
        cancelLabel={null}
        onConfirm={() => setSupportResult(null)}
        onCancel={() => setSupportResult(null)}
      />
    </SafeAreaView>
  );
}

function TenantCard({ row, busy, onApprove, onReject, onSupport, onSuspend, onReactivate }) {
  const matches = row.stats?.matchesPlayed ?? 0;
  const meta = [
    row.plan?.tier,
    `${row.seatsUsed ?? 0} of ${row.plan?.seatLimit ?? '—'} seats`,
    `${matches} ${matches === 1 ? 'match' : 'matches'}`,
    `created ${shortDate(row.createdAt)}`,
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <View style={[styles.card, elevation.raised]}>
      <View style={styles.cardTop}>
        <View style={[styles.logo, { backgroundColor: row.accentColor ?? colors.accent }]}>
          {row.logoUrl ? (
            <Image source={{ uri: row.logoUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} />
          ) : (
            <Text allowFontScaling={false} style={styles.logoInitial}>
              {(row.name ?? '?').trim()[0]?.toUpperCase() ?? '?'}
            </Text>
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={styles.nameRow}>
            <Text variant="label" style={{ flexShrink: 1 }} numberOfLines={1}>
              {row.name}
            </Text>
            <StatusBadge status={row.status} />
          </View>
          <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
            {row.slug}
          </Text>
        </View>
      </View>

      <Text variant="meta" color={colors.inkFaint} numberOfLines={1} style={styles.metaLine}>
        {meta}
      </Text>

      {/**
       * The safe, expected verb is the button; everything else — including
       * both irreversible ones — goes in the same `⋯` every row in both
       * consoles wears. Approving an organization and rejecting it were a
       * teal pill beside grey text, which is what a button beside a caption
       * looks like, on the one screen where the grey one is unrecoverable.
       */}
      <View style={styles.actions}>
        {row.status === 'pending' ? (
          <Button size="sm" label="Approve" fullWidth={false} loading={busy} onPress={onApprove} />
        ) : row.status === 'suspended' ? (
          <Button
            size="sm"
            variant="soft"
            label="Reactivate"
            fullWidth={false}
            loading={busy}
            onPress={onReactivate}
          />
        ) : null}
        <View style={{ flex: 1 }} />
        <RowMenu
          title={row.name}
          label={`Actions for ${row.name}`}
          actions={[
            row.status === 'pending'
              ? { key: 'approve', label: 'Approve', icon: 'check', onPress: onApprove }
              : null,
            row.status === 'active'
              ? {
                  key: 'support',
                  label: 'Log support access',
                  meta: 'Recorded in the audit trail',
                  icon: 'shield',
                  onPress: onSupport,
                }
              : null,
            row.status === 'suspended'
              ? { key: 'reactivate', label: 'Reactivate', icon: 'check', onPress: onReactivate }
              : null,
            row.status === 'pending'
              ? {
                  key: 'reject',
                  label: 'Reject the application',
                  icon: 'close',
                  destructive: true,
                  onPress: onReject,
                }
              : null,
            row.status === 'active'
              ? {
                  key: 'suspend',
                  label: 'Suspend the organization',
                  meta: 'Students and admins lose access',
                  icon: 'lock',
                  destructive: true,
                  onPress: onSuspend,
                }
              : null,
          ]}
        />
      </View>
    </View>
  );
}

/**
 * Badge carries green and red; pending takes the amber treatment the topic
 * list uses for its own in-between state. The label does the work everywhere —
 * colour is never the only signal.
 */
function StatusBadge({ status }) {
  if (status === 'active') return <Badge label="Active" tone="live" />;
  if (status === 'suspended') return <Badge label="Suspended" tone="danger" />;
  if (status === 'rejected') return <Badge label="Rejected" tone="danger" />;
  if (status === 'pending') {
    return <Badge label="Pending" tone="amber" />;
  }
  return null;
}

/**
 * A ConfirmSheet that asks for a sentence: the app's own sheet with a reason
 * field between the body and the decision. Confirm stays disabled until the
 * reason reaches `minLength`, and an error keeps the sheet open with the text
 * intact rather than throwing the typing away.
 */
function ReasonSheet({
  visible,
  title,
  body,
  placeholder,
  confirmLabel,
  destructive = false,
  minLength = 1,
  loading = false,
  error,
  onConfirm,
  onCancel,
}) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const bottom = useBottomInset();

  useEffect(() => {
    if (visible) setText('');
  }, [visible]);

  const valid = text.trim().length >= minLength;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      {...FULL_BLEED_MODAL}
    >
      <Pressable style={({ pressed }) => [styles.sheetScrim, pressed && { opacity: 0.7 }]} onPress={loading ? undefined : onCancel}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} pointerEvents="box-none">
          <Pressable style={[styles.sheet, { paddingBottom: bottom + space.lg }, elevation.sheet]} onPress={() => {}}>
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
  search: { marginHorizontal: consoleLayout.gutter, marginTop: space.md, marginBottom: space.sm },
  list: { paddingHorizontal: consoleLayout.gutter, paddingBottom: space.lg },
  card: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    padding: layout.cardPadding,
    marginBottom: layout.cardGap,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoInitial: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    lineHeight: 23,
    includeFontPadding: false,
    textAlignVertical: 'center',
    color: colors.onColor,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  metaLine: { marginTop: space.md },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  sheetScrim: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.nightRaised,
    borderTopLeftRadius: layout.radiusCard + 8,
    borderTopRightRadius: layout.radiusCard + 8,
    padding: consoleLayout.gutter,
    maxHeight: '88%',
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
    backgroundColor: colors.nightRaised,
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
  reasonInputFocused: { borderColor: colors.accent, backgroundColor: colors.nightRaised },
});
