import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { auth } from '../../src/lib/api.js';
import { Text, Button, ErrorNotice } from '../../src/components/ui.jsx';
import { StepScaffold } from '../../src/components/Onboarding.jsx';
import { flagEmoji } from '../../src/lib/country.js';
import { colors, fonts, layout, space } from '../../src/theme/index.js';

const LENGTH = 10;

/**
 * design.md §8.1 — one idea per screen.
 *
 * This used to be ten boxes in a row. Ten boxes across a phone is 28px each:
 * the digits landed too small to proofread, and a number is read in groups
 * anyway. One field at 26pt, grouped 5 and 5 the way an Indian mobile number
 * is spoken, is both bigger and easier to check.
 *
 * The +91 is stated rather than offered, because the server only issues codes
 * to Indian mobiles (authService.normalisePhone). A country menu here would be
 * a menu of ways to fail; the country that matters to a profile is asked for
 * later, where every country is real.
 */
const format = (digits) => (digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits);

export default function PhoneStep() {
  const router = useRouter();
  const inputRef = useRef(null);
  const [digits, setDigits] = useState('');
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const complete = digits.length === LENGTH;

  const send = async () => {
    if (!complete || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await auth.sendOtp(`+91${digits}`);
      router.push({
        pathname: '/(auth)/otp',
        params: { phone: result.phone, devCode: result.devCode ?? '' },
      });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepScaffold
      step={1}
      total={2}
      title="What's your number?"
      subtitle="We text you a 6-digit code to sign in. No password to remember, nothing to forget."
      onBack={() => router.back()}
      footer={
        <>
          <ErrorNotice error={error} />
          <Button label="Send the code" loading={busy} disabled={!complete} onPress={send} />
          <Text variant="meta" color={colors.inkFaint} style={styles.fine}>
            Used only to sign you in. Your number is never shown to other players.
          </Text>
        </>
      }
    >
      <Pressable
        style={({ pressed }) => [styles.field, focused && styles.fieldOn, pressed && { opacity: 0.7 }]}
        onPress={() => inputRef.current?.focus()}
        accessibilityLabel="Mobile number"
        accessibilityRole="none"
      >
        <View style={styles.prefix}>
          <Text allowFontScaling={false} style={styles.flag}>
            {flagEmoji('IN')}
          </Text>
          <Text allowFontScaling={false} style={styles.dial}>
            +91
          </Text>
        </View>
        <View style={styles.divider} />
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={format(digits)}
          onChangeText={(v) => setDigits(v.replace(/\D/g, '').slice(0, LENGTH))}
          keyboardType="number-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          autoFocus
          placeholder="98765 43210"
          placeholderTextColor={colors.inkFaint}
          returnKeyType="go"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={send}
          accessibilityLabel="Mobile number"
        />
      </Pressable>

      <Text variant="meta" color={colors.inkFaint} style={styles.hint}>
        Indian mobile numbers for now — more countries are coming.
      </Text>
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 66,
    borderRadius: layout.radiusInput,
    backgroundColor: colors.sunken,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    paddingHorizontal: space.lg,
  },
  fieldOn: { borderColor: colors.accent, backgroundColor: colors.nightRaised },
  prefix: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flag: { fontSize: 22, lineHeight: 28 },
  dial: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24, color: colors.inkMuted },
  divider: {
    width: 1,
    height: 26,
    backgroundColor: colors.hairline,
    marginHorizontal: space.md,
  },
  input: {
    flex: 1,
    fontFamily: fonts.display,
    fontSize: 26,
    lineHeight: 32,
    color: colors.ink,
    letterSpacing: 1.5,
    padding: 0,
    includeFontPadding: false,
  },
  hint: { marginTop: space.md },
  fine: { textAlign: 'center', marginTop: space.md },
});
