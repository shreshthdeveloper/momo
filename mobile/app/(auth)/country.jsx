import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/state/auth.jsx';
import { Text, Button, ErrorNotice } from '../../src/components/ui.jsx';
import { StepScaffold } from '../../src/components/Onboarding.jsx';
import CountryPicker from '../../src/components/CountryPicker.jsx';
import Icon from '../../src/components/Icon.jsx';
import { DEFAULT_COUNTRY, countryByCode, flagEmoji } from '../../src/lib/country.js';
import { colors, fonts, layout, space } from '../../src/theme/index.js';

/**
 * Sign-up, step 3 of 5 — where you play from.
 *
 * The country used to be a wrapped cloud of thirty chips, which was both
 * cramped and a lie: the list was a shortlist, so anyone outside it had no
 * answer. It is a full list now, behind a search sheet — one row here, every
 * country there.
 */
export default function CountryStep() {
  const router = useRouter();
  const { updateProfile, user } = useAuth();
  const [code, setCode] = useState(user?.country ?? DEFAULT_COUNTRY);
  const [city, setCity] = useState(user?.city ?? '');
  const [picking, setPicking] = useState(false);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const chosen = countryByCode(code);

  const next = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateProfile({ country: code, city: city.trim() || undefined });
      router.push('/(auth)/organization');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepScaffold
      step={3}
      total={5}
      title="Where are you playing from?"
      subtitle="Your flag sits beside your name, and your city gives you a local leaderboard to climb."
      onBack={() => router.back()}
      footer={
        <>
          <ErrorNotice error={error} />
          <Button label="Continue" loading={busy} onPress={next} />
        </>
      }
    >
      <Text variant="label" color={colors.inkMuted} style={styles.label}>
        Country
      </Text>
      <Pressable
        onPress={() => setPicking(true)}
        accessibilityRole="button"
        accessibilityLabel={`Country, ${chosen?.name ?? 'not set'}. Opens a searchable list.`}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <Text allowFontScaling={false} style={styles.flag}>
          {flagEmoji(code)}
        </Text>
        <Text style={styles.country} numberOfLines={1}>
          {chosen?.name ?? 'Choose a country'}
        </Text>
        <Icon name="chevronRight" size={16} color={colors.inkFaint} />
      </Pressable>

      <Text variant="label" color={colors.inkMuted} style={styles.label}>
        City <Text variant="meta" color={colors.inkFaint}>optional</Text>
      </Text>
      <View style={[styles.field, focused && styles.fieldOn]}>
        <TextInput
          style={styles.input}
          value={city}
          onChangeText={setCity}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          maxLength={60}
          autoCapitalize="words"
          placeholder="Where you play from"
          placeholderTextColor={colors.inkFaint}
          returnKeyType="done"
          onSubmitEditing={next}
          accessibilityLabel="City"
        />
      </View>
      <Text variant="meta" color={colors.inkFaint} style={styles.hint}>
        Only ever used for the city leaderboard.
      </Text>

      <CountryPicker
        visible={picking}
        value={code}
        onSelect={setCode}
        onClose={() => setPicking(false)}
      />
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  label: { marginBottom: space.sm, marginTop: space.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    height: 62,
    borderRadius: layout.radiusInput,
    backgroundColor: colors.sunken,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    paddingHorizontal: space.lg,
  },
  rowPressed: { backgroundColor: colors.nightRaised, borderColor: colors.accent },
  flag: { fontSize: 26, lineHeight: 32 },
  country: { flex: 1, fontFamily: fonts.semibold, fontSize: 17, lineHeight: 23, color: colors.ink },
  field: {
    height: 58,
    justifyContent: 'center',
    borderRadius: layout.radiusInput,
    backgroundColor: colors.sunken,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    paddingHorizontal: space.lg,
  },
  fieldOn: { borderColor: colors.accent, backgroundColor: colors.nightRaised },
  input: {
    fontFamily: fonts.medium,
    fontSize: 16,
    lineHeight: 22,
    color: colors.ink,
    padding: 0,
    includeFontPadding: false,
  },
  hint: { marginTop: space.sm },
});
