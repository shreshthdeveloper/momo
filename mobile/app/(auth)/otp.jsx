import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../src/state/auth.jsx';
import { auth } from '../../src/lib/api.js';
import { Text, Button, ErrorNotice } from '../../src/components/ui.jsx';
import { StepScaffold } from '../../src/components/Onboarding.jsx';
import { colors, fonts, layout, space } from '../../src/theme/index.js';

const LENGTH = 6;

/**
 * design.md §8.1 — six boxes rather than one field.
 *
 * One `TextInput`, held off-screen, with six views drawn over it. A real
 * six-input implementation has to chase focus on every keystroke and on
 * backspace, and it breaks SMS autofill on both platforms; this keeps
 * `textContentType="oneTimeCode"` working, which is the only thing on this
 * screen that actually matters. Six boxes is also where boxes still work —
 * the ten on the number step were a third of this size, which is why that
 * screen is one field now.
 */
export default function OtpStep() {
  const router = useRouter();
  const { phone, devCode } = useLocalSearchParams();
  const { signInWithOtp } = useAuth();
  const [code, setCode] = useState(String(devCode ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [seconds, setSeconds] = useState(30);
  const inputRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const verify = async (value = code) => {
    setBusy(true);
    setError(null);
    try {
      const result = await signInWithOtp(String(phone), value);
      router.replace(result.needsProfile ? '/(auth)/profile' : '/');
    } catch (err) {
      setError(err);
      setCode('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepScaffold
      step={2}
      total={2}
      title="Check your messages"
      subtitle={`We sent a ${LENGTH}-digit code to ${phone}.`}
      onBack={() => router.back()}
      footer={
        <>
          <ErrorNotice error={error} />
          <Button label="Confirm" loading={busy} disabled={code.length < LENGTH} onPress={() => verify()} />
        </>
      }
    >
      <Pressable
        style={({ pressed }) => [styles.boxes, pressed && { opacity: 0.7 }]}
        onPress={() => inputRef.current?.focus()}
        accessibilityLabel="Verification code"
        accessibilityRole="none"
      >
        {Array.from({ length: LENGTH }).map((_, i) => {
          const char = code[i];
          const active = i === code.length;
          return (
            <View key={i} style={[styles.box, char ? styles.boxFilled : null, active ? styles.boxActive : null]}>
              <Text allowFontScaling={false} style={styles.digit}>
                {char ?? ''}
              </Text>
            </View>
          );
        })}
      </Pressable>

      <TextInput
        ref={inputRef}
        style={styles.hidden}
        value={code}
        onChangeText={(v) => {
          const digits = v.replace(/\D/g, '').slice(0, LENGTH);
          setCode(digits);
          // Six digits is unambiguous — no reason to make them press a button.
          if (digits.length === LENGTH) verify(digits);
        }}
        keyboardType="number-pad"
        autoFocus
        maxLength={LENGTH}
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        caretHidden
      />

      <View style={styles.resend}>
        <Text variant="body" color={colors.inkMuted}>
          Didn&apos;t get it?
        </Text>
        <Pressable
          disabled={seconds > 0}
          onPress={async () => {
            setSeconds(30);
            setError(null);
            await auth.sendOtp(String(phone)).catch(setError);
          }}
          hitSlop={8}
         style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}>
          <Text variant="label" color={seconds > 0 ? colors.inkFaint : colors.accent}>
            {seconds > 0 ? `Resend in ${seconds}s` : 'Resend code'}
          </Text>
        </Pressable>
      </View>
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  boxes: { flexDirection: 'row', gap: space.md },
  box: {
    flex: 1,
    aspectRatio: 1,
    maxHeight: 62,
    borderRadius: layout.radiusInput,
    backgroundColor: colors.sunken,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxFilled: { backgroundColor: colors.nightRaised, borderColor: colors.hairline },
  boxActive: { borderColor: colors.accent, backgroundColor: colors.nightRaised },
  digit: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: colors.ink, includeFontPadding: false },
  hidden: { position: 'absolute', opacity: 0, height: 1, width: 1 },
  resend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, marginTop: space.xl },
});
