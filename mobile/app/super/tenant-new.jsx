import { useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useConsoleBack } from '../../src/lib/consoleBack.js';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useIsSuperadmin } from '../../src/lib/admin.js';
import {
  ConsoleFooter,
  Text,
  Button,
  Chip,
  ErrorNotice,
  Header,
  Swatches,
} from '../../src/components/ui.jsx';
import { SPACE_ACCENTS } from '../../src/shared/constants.js';
import { colors, consoleLayout, elevation, layout, space, type } from '../../src/theme/console.js';

/**
 * Creating an organization is a phone call made real: a name, the owner's number,
 * a plan. The owner becomes the admin the first time they sign in — no invite
 * email, no password, the same OTP door every player uses.
 *
 * The join code comes back exactly once, so the success view treats it the way
 * the invite screen treats its own code: big enough to read out loud, with the
 * share sheet one tap away. Leaving this screen is the last time the app can
 * show it.
 *
 * Not space-scoped — /super routes never carry a spaceId.
 */
const TIERS = [
  { value: 'trial', label: 'Trial' },
  { value: 'starter', label: 'Starter' },
  { value: 'growth', label: 'Growth' },
  { value: 'institution', label: 'Institution' },
];

export default function SuperTenantNew() {
  const goBack = useConsoleBack();
  const router = useRouter();
  const isSuper = useIsSuperadmin();

  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [digits, setDigits] = useState('');
  const [tier, setTier] = useState('trial');
  const [seats, setSeats] = useState('50');
  const [accent, setAccent] = useState(SPACE_ACCENTS[0]);
  const [focusedField, setFocusedField] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);

  useEffect(() => {
    if (!isSuper) router.replace('/');
  }, [isSuper, router]);

  if (!isSuper) return null;

  const phoneValid = /^[6-9]\d{9}$/.test(digits);
  const seatCount = Number(seats);
  const valid = name.trim().length >= 2 && phoneValid && Number.isInteger(seatCount) && seatCount >= 1;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api.post('/super/spaces', {
        name: name.trim(),
        ownerPhone: `+91${digits}`,
        ...(ownerName.trim().length >= 2 ? { ownerName: ownerName.trim() } : {}),
        accentColor: accent,
        seatLimit: seatCount,
        tier,
      });
      setCreated(data);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  // ── The one showing of the join code. ────────────────────────────────────
  if (created) {
    return (
      <SafeAreaView style={styles.screen} edges={[]}>
        <Header title="New organization" onBack={goBack} />
        <View style={styles.result}>
          <Text variant="display" style={{ textAlign: 'center' }}>
            {created.name} created.
          </Text>

          <View style={[styles.codeCard, elevation.raised]}>
            <Text variant="meta" color={colors.inkFaint}>
              Join code
            </Text>
            <Text allowFontScaling={false} style={styles.code}>
              {created.joinCode}
            </Text>
          </View>

          <Button
            label="Share the code"
            icon="share"
            onPress={() =>
              Share.share({
                message: `${created.name} is on Mimo. Join with code ${created.joinCode}.`,
              }).catch(() => {})
            }
          />
          <Text variant="meta" color={colors.inkFaint} style={styles.once}>
            It is shown only once.
          </Text>
          <Button variant="soft" label="Done" style={{ marginTop: space.md }} onPress={goBack} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={[]}>
      <Header title="New organization" onBack={goBack} />

      <ScrollView
            /* Dense forms whose fields run to the bottom of the screen: on
               iOS the keyboard used to cover whatever was being typed into.
               The auth flow gets this from its StepScaffold; the console
               screens had nothing at all. */
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
        <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
          Name
        </Text>
        <TextInput
          style={[styles.input, focusedField === 'name' && styles.inputFocused]}
          value={name}
          onChangeText={setName}
          onFocus={() => setFocusedField('name')}
          onBlur={() => setFocusedField(null)}
          maxLength={80}
          placeholder="Prime Academy, Kota"
          placeholderTextColor={colors.inkFaint}
          accessibilityLabel="Organization name"
        />

        <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
          Owner’s name
        </Text>
        <TextInput
          style={[styles.input, focusedField === 'owner' && styles.inputFocused]}
          value={ownerName}
          onChangeText={setOwnerName}
          onFocus={() => setFocusedField('owner')}
          onBlur={() => setFocusedField(null)}
          maxLength={24}
          placeholder="Optional — who runs it"
          placeholderTextColor={colors.inkFaint}
          accessibilityLabel="Owner's name"
        />
        <Text variant="meta" color={colors.inkFaint} style={styles.hint}>
          Fill this in and they land straight in their console. Leave it blank and they are asked
          for a name the first time they sign in.
        </Text>

        <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
          Owner’s mobile
        </Text>
        <View style={[styles.input, styles.phoneRow, focusedField === 'phone' && styles.inputFocused]}>
          <Text variant="label" color={colors.inkMuted}>
            +91
          </Text>
          <TextInput
            style={styles.phoneInput}
            value={digits}
            onChangeText={(v) => setDigits(v.replace(/\D/g, '').slice(0, 10))}
            onFocus={() => setFocusedField('phone')}
            onBlur={() => setFocusedField(null)}
            keyboardType="phone-pad"
            maxLength={10}
            placeholder="98765 43210"
            placeholderTextColor={colors.inkFaint}
            accessibilityLabel="Owner's mobile number"
          />
        </View>
        <Text variant="meta" color={colors.inkFaint} style={styles.hint}>
          They become the admin. An account is created when they first sign in.
        </Text>

        <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
          Plan
        </Text>
        <View style={styles.chips}>
          {TIERS.map((t) => (
            <Chip key={t.value} label={t.label} active={tier === t.value} onPress={() => setTier(t.value)} />
          ))}
        </View>

        <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
          Seat limit
        </Text>
        <TextInput
          style={[styles.input, styles.seatInput, focusedField === 'seats' && styles.inputFocused]}
          value={seats}
          onChangeText={(v) => setSeats(v.replace(/\D/g, '').slice(0, 5))}
          onFocus={() => setFocusedField('seats')}
          onBlur={() => setFocusedField(null)}
          keyboardType="number-pad"
          placeholder="50"
          placeholderTextColor={colors.inkFaint}
          accessibilityLabel="Seat limit"
        />

        <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
          Accent
        </Text>
        <Swatches
          value={accent}
          colors={SPACE_ACCENTS}
          onChange={setAccent}
          noun="Accent colour"
        />
        <Text variant="meta" color={colors.inkFaint} style={styles.hint}>
          The organization’s colour across the app. Their admin can change it later.
        </Text>
      </ScrollView>

      <ConsoleFooter>
        <ErrorNotice error={error} />
        <Button label="Create organization" loading={busy} disabled={!valid} onPress={create} />
      </ConsoleFooter>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  content: { paddingHorizontal: consoleLayout.gutter, paddingBottom: space.xl },
  fieldLabel: { marginTop: space.xl, marginBottom: space.sm },
  input: {
    ...type.option,
    color: colors.ink,
    backgroundColor: colors.control,
    borderRadius: layout.radiusInput,
    borderWidth: 1.5,
    borderColor: colors.transparent,
    paddingHorizontal: space.lg,
    height: 54,
  },
  inputFocused: { borderColor: colors.accent, backgroundColor: colors.nightRaised },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: 0,
  },
  phoneInput: {
    ...type.option,
    color: colors.ink,
    flex: 1,
    height: '100%',
    paddingVertical: 0,
  },
  seatInput: { width: 120 },
  hint: { marginTop: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  result: { padding: consoleLayout.gutter, paddingTop: space.xl },
  codeCard: {
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: space.xxl,
    marginVertical: space.xl,
  },
  code: {
    ...type.scoreHero,
    fontSize: 44,
    lineHeight: 54,
    color: colors.accent,
    letterSpacing: 10,
    includeFontPadding: false,
  },
  once: { textAlign: 'center', marginTop: space.md },
});
