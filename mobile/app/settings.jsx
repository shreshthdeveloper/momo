import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/lib/api.js';
import { useAuth } from '../src/state/auth.jsx';
import { Text, Button, ConfirmSheet, ErrorNotice, Header } from '../src/components/ui.jsx';
import Icon from '../src/components/Icon.jsx';
import { colors, elevation, layout, space } from '../src/theme/index.js';
import { getHapticsEnabled, setHapticsEnabled } from '../src/lib/haptics.js';
import { getMusicEnabled, getSoundEnabled, setMusicEnabled, setSoundEnabled } from '../src/lib/sound.js';
import { signOutCopy } from '../src/lib/account.js';

/**
 * prd.md §6.10 — account, notifications, privacy, spaces, data, deletion.
 *
 * Every row leads with a tinted icon tile. That is not decoration: it gives a
 * list of nineteen switches a scannable left edge, so "where is the privacy
 * one" is answered by shape before it is answered by reading.
 */
export default function Settings() {
  const router = useRouter();
  const { user, spaces, signOut, updateProfile, refreshSpaces } = useAuth();
  const [prefs, setPrefs] = useState(user?.notificationPrefs ?? {});
  const [privacy, setPrivacy] = useState(user?.privacy ?? {});
  // Seeded from the stored preferences, so the switches show what is actually on.
  const [haptics, setHaptics] = useState(getHapticsEnabled);
  const [sounds, setSounds] = useState(getSoundEnabled);
  const [musicOn, setMusicOn] = useState(getMusicEnabled);
  const [error, setError] = useState(null);
  /**
   * The one confirmation open right now: { kind, ...payload } or null. Every
   * destructive act on this screen goes through the app's own sheet — the OS
   * alert box is the one surface here that would ignore the design system.
   */
  const [sheet, setSheet] = useState(null);
  const [busy, setBusy] = useState(false);

  const closeSheet = () => {
    setSheet(null);
    setBusy(false);
  };

  const savePrefs = async (patch) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try {
      await updateProfile({ notificationPrefs: next });
    } catch (err) {
      setError(err);
    }
  };

  const savePrivacy = async (patch) => {
    const next = { ...privacy, ...patch };
    setPrivacy(next);
    try {
      const updated = await updateProfile({ privacy: next });
      setPrivacy(updated.privacy);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Settings" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ErrorNotice error={error} />

        <Section title="Notifications">
          <Toggle
            icon="bolt"
            tint={colors.optionA}
            label="Friend challenges"
            value={prefs.friendChallenge !== false}
            onChange={(v) => savePrefs({ friendChallenge: v })}
          />
          {/* Separate from challenges on purpose: a challenge has a two-minute
              clock and missing one costs something, a reaction is somebody
              saying GG. Anyone who wants the first and not the second needs a
              switch that tells them apart. */}
          <Toggle
            icon="sparkle"
            tint={colors.gold}
            label="Reactions from friends"
            value={prefs.friendReaction !== false}
            onChange={(v) => savePrefs({ friendReaction: v })}
          />
          {/* Achievements and level-ups are deliberately absent. They are
              written to the in-app list and never pushed (see `notifyProgress`),
              and a pref only governs pushing — prd.md §6.9 keeps the row either
              way — so a switch here would be a control that does nothing. */}
          <Toggle
            icon="ranks"
            tint={colors.optionC}
            label="Someone passed your rank"
            value={prefs.rankPassed !== false}
            onChange={(v) => savePrefs({ rankPassed: v })}
          />
          <Toggle
            icon="flag"
            tint={colors.optionB}
            label="Streak about to break"
            value={prefs.streakAtRisk !== false}
            onChange={(v) => savePrefs({ streakAtRisk: v })}
          />
          <Toggle
            icon="calendar"
            tint={colors.optionD}
            label="Weekly summary"
            value={prefs.weeklySummary === true}
            onChange={(v) => savePrefs({ weeklySummary: v })}
          />
          {/* prd.md F6.9.2 — quiet hours, default 22:00–08:00. */}
          <Toggle
            icon="clock"
            tint={colors.accent}
            label="Quiet hours"
            hint="22:00 – 08:00"
            value={prefs.quietHours?.enabled !== false}
            onChange={(v) => savePrefs({ quietHours: { ...prefs.quietHours, enabled: v } })}
            last
          />
        </Section>

        <Section title="Sound and feel">
          <Toggle
            icon="bell"
            tint={colors.optionB}
            label="Game sounds"
            value={sounds}
            onChange={(v) => {
              setSounds(v);
              setSoundEnabled(v);
            }}
          />
          <Toggle
            icon="bolt"
            tint={colors.accent}
            label="Battle music"
            hint="The bed under every match"
            value={musicOn}
            onChange={(v) => {
              setMusicOn(v);
              setMusicEnabled(v);
            }}
          />
          <Toggle
            icon="sparkle"
            tint={colors.optionC}
            label="Haptics"
            value={haptics}
            onChange={(v) => {
              setHaptics(v);
              setHapticsEnabled(v);
            }}
            last
          />
        </Section>

        <Section title="Privacy">
          <Toggle
            icon="search"
            tint={colors.optionA}
            label="Let people find me by name"
            hint={user?.isMinor ? 'Off for accounts under 18 and cannot be turned on' : undefined}
            value={privacy.contactDiscovery !== false}
            disabled={user?.isMinor}
            onChange={(v) => savePrivacy({ contactDiscovery: v })}
          />
          <Row
            icon="user"
            tint={colors.accent}
            label="Profile visibility"
            value={privacy.profileVisibility ?? 'public'}
            onPress={() => {
              const order = ['public', 'friends', 'private'];
              const next = order[(order.indexOf(privacy.profileVisibility ?? 'public') + 1) % 3];
              savePrivacy({ profileVisibility: next });
            }}
            last
          />
        </Section>

        <Section title="Organizations">
          {spaces.filter((s) => !s.isPublic).length === 0 ? (
            <Text variant="body" color={colors.inkMuted} style={styles.note}>
              You have not joined an organization.
            </Text>
          ) : (
            spaces
              .filter((s) => !s.isPublic)
              .map((s) => (
                <View key={s.id} style={styles.row}>
                  <View style={[styles.tile, { backgroundColor: s.accentColor ?? colors.accent }]}>
                    <Icon name="book" size={16} color={colors.onColor} />
                  </View>
                  <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <Pressable
                    hitSlop={8}
                    onPress={() => setSheet({ kind: 'leave', space: s })}
                   style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}>
                    <Text variant="label" color={colors.wrong}>
                      Leave
                    </Text>
                  </Pressable>
                </View>
              ))
          )}
          <View style={{ padding: space.md }}>
            <Button variant="soft" size="md" label="Join an organization" icon="plus" onPress={() => router.push('/join')} />
          </View>
        </Section>

        <Section title="Your data">
          <Row
            icon="share"
            tint={colors.optionD}
            label="Export my data"
            onPress={async () => {
              try {
                await api.get('/me/export');
                setSheet({ kind: 'exported' });
              } catch (err) {
                setError(err);
              }
            }}
          />
          {/* prd.md F6.1.6 — deletion with a 30-day grace period. */}
          <Row
            icon="alert"
            tint={colors.wrong}
            label="Delete my account"
            destructive
            last
            onPress={() => setSheet({ kind: 'delete' })}
          />
        </Section>

        <Button
          variant="soft"
          label="Sign out"
          style={{ marginTop: space.sm }}
          onPress={() => setSheet({ kind: 'signout' })}
        />

        <Text variant="meta" color={colors.inkFaint} style={styles.legal}>
          Mimo 1.0.0
        </Text>
      </ScrollView>

      {/* ── The one open confirmation, whichever row raised it. */}
      <ConfirmSheet
        visible={sheet?.kind === 'leave'}
        destructive
        icon="book"
        title={`Leave ${sheet?.space?.name ?? 'this organization'}?`}
        body="You lose access to its topics, contests and leaderboards. Joining again needs a fresh code."
        confirmLabel="Leave organization"
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          await api.delete(`/spaces/${sheet.space.id}/membership`).catch(setError);
          await refreshSpaces();
          closeSheet();
        }}
        onCancel={closeSheet}
      />

      <ConfirmSheet
        visible={sheet?.kind === 'delete'}
        destructive
        icon="alert"
        title="Delete your account?"
        body="Your account is removed after 30 days. Signing in before then cancels the deletion."
        confirmLabel="Delete my account"
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          await api.delete('/me').catch(setError);
          await signOut();
          router.replace('/(auth)/welcome');
        }}
        onCancel={closeSheet}
      />

      <ConfirmSheet
        visible={sheet?.kind === 'signout'}
        destructive
        icon="user"
        loading={busy}
        {...signOutCopy()}
        onConfirm={async () => {
          setBusy(true);
          await signOut();
          router.replace('/(auth)/welcome');
        }}
        onCancel={closeSheet}
      />

      <ConfirmSheet
        visible={sheet?.kind === 'exported'}
        icon="check"
        title="Export ready"
        body="Your data has been prepared and sent to your account."
        confirmLabel="Done"
        cancelLabel={null}
        onConfirm={closeSheet}
        onCancel={closeSheet}
      />
    </SafeAreaView>
  );
}

function Section({ title, children }) {
  return (
    <View style={{ marginBottom: space.xl }}>
      <Text variant="label" color={colors.inkMuted} style={{ marginBottom: space.sm, marginLeft: space.xs }}>
        {title}
      </Text>
      <View style={[styles.card, elevation.raised]}>{children}</View>
    </View>
  );
}

function Tile({ icon, tint }) {
  return (
    <View style={[styles.tile, { backgroundColor: tint ?? colors.accent }]}>
      <Icon name={icon} size={16} color={colors.onColor} />
    </View>
  );
}

function Toggle({ icon, tint, label, hint, value, onChange, disabled, last }) {
  return (
    <View style={[styles.row, !last && styles.rowDivided]}>
      <Tile icon={icon} tint={disabled ? colors.inkFaint : tint} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" color={disabled ? colors.inkFaint : colors.ink}>
          {label}
        </Text>
        {hint ? (
          <Text variant="meta" color={colors.inkFaint}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: colors.accent, false: colors.hairline }}
        thumbColor={colors.onColor}
        ios_backgroundColor={colors.hairline}
      />
    </View>
  );
}

function Row({ icon, tint, label, value, onPress, destructive, last }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, !last && styles.rowDivided, pressed && { backgroundColor: colors.sunken }]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Tile icon={icon} tint={destructive ? colors.wrong : tint} />
      <Text variant="bodyStrong" color={destructive ? colors.wrong : colors.ink} style={{ flex: 1 }}>
        {label}
      </Text>
      {value ? (
        <Text variant="meta" color={colors.inkFaint}>
          {value}
        </Text>
      ) : null}
      <Icon name="chevronRight" size={14} color={colors.inkFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  content: { padding: layout.gutter, paddingTop: space.sm, paddingBottom: space.xxxl },
  card: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 58,
    gap: space.md,
    paddingHorizontal: space.lg,
  },
  rowDivided: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
  tile: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: { padding: space.lg },
  legal: { textAlign: 'center', marginTop: space.xl },
});
