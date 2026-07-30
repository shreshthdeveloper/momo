import { useCallback, useEffect, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../../src/lib/api.js';
import { useConsoleNav } from '../../src/components/consoleNav.js';
import { useAdminSpace, useAdminPermissions } from '../../src/lib/admin.js';
import { useAuth } from '../../src/state/auth.jsx';
import Icon from '../../src/components/Icon.jsx';
import {
  Text,
  Avatar,
  Badge,
  Button,
  ConfirmSheet,
  ConsoleFooter,
  ErrorNotice,
  Header,
  ProgressBar,
  Segmented,
  Spinner,
} from '../../src/components/ui.jsx';
import { CardsSkeleton } from '../../src/components/Skeletons.jsx';
import { colors, consoleLayout, elevation, fonts, layout, space, type } from '../../src/theme/index.js';

/**
 * The organization's own controls — brand, door policy, game pace, the plan, the
 * team, and the trail of who did what. One scroll, one Save: everything above
 * the fold edits a single dirty buffer and commits in one PATCH, so an admin
 * on a phone between classes never wonders which of six switches already
 * "took". The two exceptions act immediately and say so: rotating the join
 * code (the old one must die the moment the new one exists) and changing a
 * team member's role (a permission is not a draft).
 */
const JOIN_MODES = [
  { value: 'open', label: 'Open' },
  { value: 'approval', label: 'Approval' },
  { value: 'invite', label: 'Invite' },
];

const JOIN_HINTS = {
  open: 'Anyone with the code joins immediately.',
  approval: 'Requests wait under Students until you approve them.',
  invite: 'The code is disabled. Only direct invites work.',
};

/** Round lengths the server accepts (5000–60000ms), phrased in seconds. */
const ROUND_SECONDS = [10, 12, 15, 20, 30, 45, 60];

const PLAN_STATUS = {
  trialing: 'Trialing',
  active: 'Active',
  past_due: 'Past due',
  cancelled: 'Cancelled',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 26 Jul 2026 — the way a date is said here. */
function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function timeAgo(iso) {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

/** 'question.create' → 'Question create'. The key is the truth; this only reads it aloud. */
function prettyAction(action) {
  const plain = String(action ?? '').split('.').join(' ');
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

/**
 * The editable slice of GET /admin/settings, normalised so a field-by-field
 * compare against a fresh copy is the whole dirty check. `allowGhosts`
 * undefined means on, so it becomes an explicit boolean here.
 */
function toForm(spaceData) {
  return {
    name: spaceData.name ?? '',
    logoUrl: spaceData.logoUrl ?? null,
    accentColor: spaceData.accentColor,
    joinMode: spaceData.joinMode,
    roundDurationMs: spaceData.settings?.roundDurationMs ?? 15000,
    allowGhosts: spaceData.settings?.allowGhosts !== false,
    dailyChallenge: spaceData.settings?.dailyChallenge === true,
  };
}

export default function AdminSettings() {
  /**
   * Settings is a sidebar row like every other, so it wears the menu rather
   * than a back arrow. The unsaved-work guard moves with the button: the menu
   * asks before the sidebar replaces the route out from under an edited form.
   */
  const nav = useConsoleNav();
  const adminSpace = useAdminSpace();
  const { refreshSpaces } = useAuth();
  const { canManageSettings, isFullAdmin } = useAdminPermissions(adminSpace);

  const [data, setData] = useState(null); // { space, plan, accents, admins }
  const [audit, setAudit] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  /** The one open sheet: { kind: 'discard' | 'rotate' | 'team' | 'demote', row? } */
  const [sheet, setSheet] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async ({ keepForm = false } = {}) => {
      if (!adminSpace) return;
      try {
        setError(null);
        const [settings, auditData] = await Promise.all([
          api.get('/admin/settings', { spaceId: adminSpace.id }),
          // The trail is a bonus, never a blocker — if it fails, the section hides.
          api.get('/admin/audit', { spaceId: adminSpace.id, limit: 40 }).catch(() => null),
        ]);
        setData(settings);
        setAudit(auditData ? (auditData.items ?? []) : null);
        if (!keepForm) setForm(toForm(settings.space));
      } catch (err) {
        setError(err);
      }
    },
    [adminSpace],
  );

  useEffect(() => {
    load();
  }, [load]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const baseline = data ? toForm(data.space) : null;
  const isDirty = Boolean(
    form &&
      baseline &&
      (form.name !== baseline.name ||
        form.logoUrl !== baseline.logoUrl ||
        form.accentColor !== baseline.accentColor ||
        form.joinMode !== baseline.joinMode ||
        form.roundDurationMs !== baseline.roundDurationMs ||
        form.allowGhosts !== baseline.allowGhosts ||
        form.dailyChallenge !== baseline.dailyChallenge),
  );
  const canSave = isDirty && form.name.trim().length >= 2;

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      setError(null);
      // Only the documented fields — the server strips anything else anyway.
      await api.patch('/admin/settings', {
        spaceId: adminSpace.id,
        name: form.name.trim(),
        logoUrl: form.logoUrl ?? undefined,
        accentColor: form.accentColor,
        joinMode: form.joinMode,
        settings: {
          roundDurationMs: form.roundDurationMs,
          allowGhosts: form.allowGhosts,
          dailyChallenge: form.dailyChallenge,
        },
      });
      // The PATCH answers with a small brand object; the screen re-reads the truth.
      await load();
      // The app shell shows the space's name and accent — let it catch up.
      refreshSpaces();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const leave = () => {
    if (isDirty) setSheet({ kind: 'discard' });
    else nav?.open();
  };

  const pickLogo = async () => {
    setError(null);
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      setUploadingLogo(true);
      const asset = picked.assets[0];
      const stored = await api.upload('logo', asset.uri, asset.mimeType ?? 'image/jpeg');
      set('logoUrl', stored.url);
    } catch (err) {
      setError(err);
    } finally {
      setUploadingLogo(false);
    }
  };

  const shareCode = () =>
    Share.share({
      message: `Join ${data.space.name} on Mimo with code ${data.space.joinCode}.`,
    }).catch(() => {});

  /** Rotation is immediate — it never sits in the dirty buffer. */
  const rotate = async () => {
    setBusy(true);
    try {
      setError(null);
      const res = await api.post('/admin/invite/rotate', { spaceId: adminSpace.id });
      setData((d) => (d ? { ...d, space: { ...d.space, joinCode: res.joinCode } } : d));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      setSheet(null);
    }
  };

  /** Role changes apply immediately too; `keepForm` protects unsaved edits. */
  const setRole = async (row, role) => {
    setBusy(true);
    try {
      setError(null);
      await api.post('/admin/admins', { spaceId: adminSpace.id, userId: row.userId, role });
      await load({ keepForm: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      setSheet(null);
    }
  };

  const teamRow = sheet?.kind === 'team' || sheet?.kind === 'demote' ? sheet.row : null;
  const teamOptions = teamRow
    ? [
        // Only a full admin may promote to full admin — the server enforces it,
        // the sheet simply does not offer what would bounce.
        teamRow.role !== 'admin' && isFullAdmin ? { key: 'admin', label: 'Make admin' } : null,
        teamRow.role !== 'sub_admin' ? { key: 'sub_admin', label: 'Make sub-admin' } : null,
        { key: 'remove', label: 'Remove from team', destructive: true },
      ].filter(Boolean)
    : [];

  const initial = (form?.name ?? '').trim().charAt(0).toUpperCase() || '?';
  const accent = form?.accentColor ?? colors.accent;
  const planActive = data?.plan?.status === 'active';

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* Save is a footer button, like every other form in both consoles. It
          was a text link in the header — the only one in the product — which
          made the most consequential control on the longest screen the
          smallest and the least reachable thing on it. */}
      <Header title="Organization settings" subtitle={adminSpace?.name} onMenu={leave} />

      <ErrorNotice error={error} onRetry={data ? undefined : load} />

      {!data || !form ? (
        !error ? (
          <CardsSkeleton count={4} lines={2} bar={false} />
        ) : null
      ) : (
        <ScrollView
        automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {!canManageSettings ? (
            <Text variant="meta" color={colors.inkFaint} style={styles.readOnlyNote}>
              You can read these settings, but changing them needs the settings permission.
            </Text>
          ) : null}

          {/* ── Branding ─────────────────────────────────────────────────── */}
          <Section title="Branding">
            <View style={styles.blockPad}>
              <View style={styles.logoRow}>
                {form.logoUrl ? (
                  <Image source={{ uri: form.logoUrl }} style={styles.logo} />
                ) : (
                  <View style={[styles.logo, styles.logoFallback, { backgroundColor: accent }]}>
                    <Text allowFontScaling={false} style={styles.logoInitial}>
                      {initial}
                    </Text>
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="bodyStrong">Logo</Text>
                  <Text variant="meta" color={colors.inkFaint}>
                    Square, shown beside the organization name.
                  </Text>
                </View>
                <Button
                  size="sm"
                  variant="soft"
                  label="Change"
                  fullWidth={false}
                  loading={uploadingLogo}
                  disabled={!canManageSettings}
                  onPress={pickLogo}
                />
              </View>

              <Text variant="label" color={colors.inkMuted}>
                Name
              </Text>
              <TextInput
                style={[styles.input, !canManageSettings && styles.inputDisabled]}
                value={form.name}
                onChangeText={(v) => set('name', v)}
                editable={canManageSettings}
                maxLength={80}
                placeholder="Organization name"
                placeholderTextColor={colors.inkFaint}
                accessibilityLabel="Organization name"
              />

              <Text variant="label" color={colors.inkMuted}>
                Accent
              </Text>
              {/* The legal accents come from the server — never a local list. */}
              <View style={styles.swatches}>
                {(data.accents ?? []).map((hex) => {
                  const on = form.accentColor === hex;
                  return (
                    <Pressable
                      key={hex}
                      disabled={!canManageSettings}
                      onPress={() => set('accentColor', hex)}
                      accessibilityRole="button"
                      accessibilityLabel={`Accent colour ${hex}`}
                      accessibilityState={{ selected: on }}
                      style={({ pressed }) => [styles.swatch, { backgroundColor: hex }, on && styles.swatchOn, pressed && { opacity: 0.7 }]}
                    >
                      {on ? <Icon name="check" size={16} color={colors.onAccent} /> : null}
                    </Pressable>
                  );
                })}
              </View>
              <Text variant="meta" color={colors.inkFaint}>
                Colours are curated so text stays readable.
              </Text>
            </View>
          </Section>

          {/* ── Joining ──────────────────────────────────────────────────── */}
          <Section title="Joining">
            <View style={styles.blockPad}>
              <View
                pointerEvents={canManageSettings ? 'auto' : 'none'}
                style={!canManageSettings ? styles.dimmed : null}
              >
                <Segmented options={JOIN_MODES} value={form.joinMode} onChange={(v) => set('joinMode', v)} />
              </View>
              <Text variant="meta" color={colors.inkFaint}>
                {JOIN_HINTS[form.joinMode]}
              </Text>

              <Text allowFontScaling={false} style={styles.code}>
                {data.space.joinCode ?? '—'}
              </Text>
              <View style={styles.codeActions}>
                <Button
                  size="sm"
                  variant="soft"
                  label="Share"
                  icon="share"
                  fullWidth={false}
                  disabled={!data.space.joinCode}
                  onPress={shareCode}
                />
                {canManageSettings ? (
                  <Button
                    size="sm"
                    variant="danger"
                    label="Rotate"
                    fullWidth={false}
                    disabled={!data.space.joinCode}
                    onPress={() => setSheet({ kind: 'rotate' })}
                  />
                ) : null}
              </View>
            </View>
          </Section>

          {/* ── Gameplay ─────────────────────────────────────────────────── */}
          <Section title="Gameplay">
            <View style={styles.blockPad}>
              <Text variant="label" color={colors.inkMuted}>
                Round duration
              </Text>
              <View style={styles.chips}>
                {ROUND_SECONDS.map((s) => (
                  <DurationChip
                    key={s}
                    seconds={s}
                    active={form.roundDurationMs === s * 1000}
                    disabled={!canManageSettings}
                    onPress={() => set('roundDurationMs', s * 1000)}
                  />
                ))}
              </View>

              <View style={styles.switchRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="bodyStrong" color={canManageSettings ? colors.ink : colors.inkFaint}>
                    Fill empty queues with recorded games
                  </Text>
                  <Text variant="meta" color={colors.inkFaint}>
                    Students who queue when nobody else is on play a replay of a real past game.
                  </Text>
                </View>
                <Switch
                  value={form.allowGhosts}
                  onValueChange={(v) => set('allowGhosts', v)}
                  disabled={!canManageSettings}
                  trackColor={{ true: colors.accent, false: colors.hairline }}
                  thumbColor={colors.onColor}
                  ios_backgroundColor={colors.hairline}
                />
              </View>

              {/**
                * The daily challenge.
                *
                * Off by default and stated plainly, because switching it on means
                * a notification to every student every morning — the kind of thing
                * an organization should turn on deliberately rather than discover
                * happening. The copy says what it costs them as well as what it is.
                */}
              <View style={styles.switchRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="bodyStrong" color={canManageSettings ? colors.ink : colors.inkFaint}>
                    A daily challenge
                  </Text>
                  <Text variant="meta" color={colors.inkFaint}>
                    Seven questions each morning, the same for everyone, one attempt. Students are
                    notified when it opens.
                  </Text>
                </View>
                <Switch
                  value={form.dailyChallenge}
                  onValueChange={(v) => set('dailyChallenge', v)}
                  disabled={!canManageSettings}
                  trackColor={{ true: colors.accent, false: colors.hairline }}
                  thumbColor={colors.onColor}
                  ios_backgroundColor={colors.hairline}
                />
              </View>
            </View>
          </Section>

          {/* ── Plan (read-only) ─────────────────────────────────────────── */}
          <Section title="Plan">
            <View style={styles.blockPad}>
              <View style={styles.planHead}>
                <Text variant="title" style={{ flex: 1 }} numberOfLines={1}>
                  {data.plan.tier.charAt(0).toUpperCase() + data.plan.tier.slice(1)}
                </Text>
                <Badge
                  label={PLAN_STATUS[data.plan.status] ?? data.plan.status}
                  tone={planActive ? 'correct' : 'ink'}
                  style={planActive ? null : styles.amberBadge}
                />
              </View>
              <Text variant="meta" color={colors.inkMuted}>
                {data.plan.seatsUsed} of {data.plan.seatLimit} seats used
              </Text>
              <ProgressBar value={data.plan.seatsUsed} max={data.plan.seatLimit} color={accent} />
              {data.plan.currentPeriodEnd ? (
                <Text variant="meta" color={colors.inkFaint}>
                  Renews {formatDate(data.plan.currentPeriodEnd)}
                </Text>
              ) : null}
            </View>
          </Section>

          {/* ── Admin team ───────────────────────────────────────────────── */}
          <Section
            title="Admin team"
            footnote="Sub-admins can write questions but cannot publish unless you grant it."
          >
            {(data.admins ?? []).map((row, i) => {
              const tappable = canManageSettings && !row.isYou;
              return (
                <Pressable
                  key={row.membershipId}
                  disabled={!tappable}
                  onPress={() => setSheet({ kind: 'team', row })}
                  accessibilityRole={tappable ? 'button' : undefined}
                  style={({ pressed }) => [
                    styles.teamRow,
                    i > 0 && styles.rowDivided,
                    pressed && tappable ? { backgroundColor: colors.sunken } : null,
                  ]}
                >
                  <Avatar url={row.avatarUrl} name={row.displayName} size={40} />
                  <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                    {row.displayName}
                    {row.isYou ? (
                      <Text variant="meta" color={colors.inkFaint}>
                        {'  you'}
                      </Text>
                    ) : null}
                  </Text>
                  <Badge
                    label={row.role === 'admin' ? 'Admin' : 'Sub-admin'}
                    tone={row.role === 'admin' ? 'accent' : 'soft'}
                  />
                </Pressable>
              );
            })}
          </Section>

          {/* ── Recent activity ──────────────────────────────────────────── */}
          {audit ? (
            <Section title="Recent activity">
              {audit.length === 0 ? (
                <Text variant="meta" color={colors.inkFaint} style={styles.blockPad}>
                  Nothing here yet. Team actions appear in this list.
                </Text>
              ) : (
                audit.map((item, i) => (
                  <View key={item.id} style={[styles.auditRow, i > 0 && styles.rowDivided]}>
                    <Text variant="bodyStrong" numberOfLines={2}>
                      {prettyAction(item.action)}
                      {item.summary ? ` — ${item.summary}` : ''}
                    </Text>
                    <View style={styles.auditMeta}>
                      <Text variant="meta" color={colors.inkFaint} style={{ flexShrink: 1 }} numberOfLines={1}>
                        {item.actor?.displayName ?? item.actor} · {timeAgo(item.at)}
                      </Text>
                      {item.impersonated ? (
                        <Badge label="support" tone="quiet" style={styles.amberBadge} />
                      ) : null}
                    </View>
                  </View>
                ))
              )}
            </Section>
          ) : null}
        </ScrollView>
      )}

      {/* The footer appears only when there is something to save, so it does
          not take a strip of the screen from a form nobody has touched. */}
      {data && canManageSettings && isDirty ? (
        <ConsoleFooter>
          <Button label="Save changes" loading={saving} disabled={!canSave} onPress={save} />
        </ConsoleFooter>
      ) : null}

      {/* ── Unsaved changes ──────────────────────────────────────────────── */}
      <ConfirmSheet
        visible={sheet?.kind === 'discard'}
        destructive
        icon="alert"
        title="Discard your changes?"
        body="Nothing you edited on this screen has been saved."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={() => {
          setSheet(null);
          // Put the form back to what is saved, then hand over the sidebar —
          // "discard" that left the edits sitting in state would come back the
          // moment the row was tapped again.
          if (baseline) setForm(baseline);
          nav?.open();
        }}
        onCancel={() => setSheet(null)}
      />

      {/* ── Rotate — immediate and irreversible, so it is named plainly. ─── */}
      <ConfirmSheet
        visible={sheet?.kind === 'rotate'}
        destructive
        icon="share"
        title="Rotate the join code?"
        body="The current code stops working immediately."
        confirmLabel="Rotate code"
        loading={busy}
        onConfirm={rotate}
        onCancel={() => setSheet(null)}
      />

      {/* ── The team action sheet, styled like the app's ConfirmSheet. ───── */}
      <Modal
        visible={sheet?.kind === 'team'}
        transparent
        animationType="fade"
        onRequestClose={() => setSheet(null)}
      >
        <Pressable style={({ pressed }) => [styles.sheetScrim, pressed && { opacity: 0.7 }]} onPress={busy ? undefined : () => setSheet(null)}>
          <Pressable style={[styles.sheet, elevation.sheet]} onPress={() => {}}>
            <View style={styles.sheetGrabber} />
            <View style={styles.sheetHead}>
              <Avatar url={teamRow?.avatarUrl} name={teamRow?.displayName} size={44} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="title" numberOfLines={1}>
                  {teamRow?.displayName}
                </Text>
                <Text variant="meta" color={colors.inkFaint}>
                  {teamRow?.role === 'admin' ? 'Admin' : 'Sub-admin'}
                </Text>
              </View>
              {busy ? <Spinner size={22} /> : null}
            </View>
            {teamOptions.map((option) => (
              <Pressable
                key={option.key}
                disabled={busy}
                accessibilityRole="button"
                onPress={() =>
                  option.key === 'remove'
                    ? setSheet({ kind: 'demote', row: teamRow })
                    : setRole(teamRow, option.key)
                }
                style={({ pressed }) => [styles.sheetOption, pressed ? { backgroundColor: colors.sunken } : null]}
              >
                <Text variant="option" color={option.destructive ? colors.wrong : colors.ink}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      <ConfirmSheet
        visible={sheet?.kind === 'demote'}
        destructive
        icon="friends"
        title={`Remove ${teamRow?.displayName ?? 'them'} from the team?`}
        body="They lose the admin tools immediately and go back to playing as a student. Nothing they built is deleted."
        confirmLabel="Remove from team"
        loading={busy}
        onConfirm={() => setRole(teamRow, 'student')}
        onCancel={() => setSheet(null)}
      />
    </SafeAreaView>
  );
}

/** A label, a card, and an optional plain-sentence footnote beneath. */
function Section({ title, footnote, children }) {
  return (
    <View style={styles.section}>
      <Text variant="label" color={colors.inkMuted} style={styles.sectionTitle}>
        {title}
      </Text>
      <View style={[styles.card, elevation.raised]}>{children}</View>
      {footnote ? (
        <Text variant="meta" color={colors.inkFaint} style={styles.footnote}>
          {footnote}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The kit's Chip, but honouring a disabled state the kit does not carry —
 * a read-only sub-admin sees the chosen duration, not a dead control that
 * still presses.
 */
function DurationChip({ seconds, active, disabled, onPress }) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: Boolean(active) }}
      style={({ pressed }) => [
        styles.chip,
        active ? styles.chipOn : styles.chipOff,
        disabled && !active ? styles.dimmed : null,
        pressed ? { opacity: 0.8 } : null,
      ]}
    >
      <Text variant="label" color={active ? colors.onAccent : colors.inkMuted}>
        {seconds}s
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  content: { padding: consoleLayout.gutter, paddingTop: space.sm, paddingBottom: space.xxxl },
  readOnlyNote: { marginBottom: space.lg, marginLeft: space.xs },

  section: { marginBottom: space.xl },
  sectionTitle: { marginBottom: space.sm, marginLeft: space.xs },
  card: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  footnote: { marginTop: space.sm, marginLeft: space.xs },
  blockPad: { padding: space.lg, gap: space.md },
  dimmed: { opacity: 0.55 },

  // ── Branding ──────────────────────────────────────────────────────────────
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  logo: { width: 64, height: 64, borderRadius: 32 },
  logoFallback: { alignItems: 'center', justifyContent: 'center' },
  logoInitial: {
    fontFamily: fonts.semibold,
    fontSize: 26,
    lineHeight: 34,
    includeFontPadding: false,
    color: colors.onColor,
  },
  input: {
    ...type.option,
    color: colors.ink,
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusInput,
    paddingHorizontal: space.lg,
    height: 54,
  },
  inputDisabled: { color: colors.inkFaint },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchOn: { borderWidth: 2.5, borderColor: colors.ink },

  // ── Joining ───────────────────────────────────────────────────────────────
  code: {
    ...type.scoreLive,
    color: colors.accent,
    letterSpacing: 8,
    textAlign: 'center',
    includeFontPadding: false,
    marginTop: space.sm,
  },
  codeActions: { flexDirection: 'row', justifyContent: 'center', gap: space.md },

  // ── Gameplay ──────────────────────────────────────────────────────────────
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: 38,
    paddingHorizontal: space.lg,
    borderRadius: layout.radiusPill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipOff: { backgroundColor: colors.nightRaised, borderColor: colors.hairline },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },

  // ── Plan ──────────────────────────────────────────────────────────────────
  planHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  amberBadge: { backgroundColor: colors.optionC },

  // ── Team and activity rows ────────────────────────────────────────────────
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 60,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.hairline },
  auditRow: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: 3 },
  auditMeta: { flexDirection: 'row', alignItems: 'center', gap: space.sm },

  // ── The team action sheet (mirrors the kit's ConfirmSheet chrome) ─────────
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
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.md,
  },
  sheetOption: {
    minHeight: 54,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
});
