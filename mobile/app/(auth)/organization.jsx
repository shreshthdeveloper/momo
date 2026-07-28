import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/state/auth.jsx';
import { Text, Button } from '../../src/components/ui.jsx';
import { StepScaffold } from '../../src/components/Onboarding.jsx';
import Icon from '../../src/components/Icon.jsx';
import { colors, fonts, layout, space } from '../../src/theme/index.js';
import { PLATFORM_ROLE, SPACE_ROLE } from '../../src/shared/constants.js';

/**
 * Sign-up, step 4 of 5 — the organization code (prd.md F7.1).
 *
 * Optional, because most players belong to nobody: "I don't have one" is a
 * full-width control, not fine print. A wrong code costs only the join — the
 * name, face and country are already saved — so the failure stays at the
 * field and the way forward stays open.
 */
export default function OrganizationStep() {
  const router = useRouter();
  const { joinSpace, setActiveSpaceId, user, spaces } = useAuth();
  const [code, setCode] = useState('');
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  /** The organization's name once a join request is waiting for approval. */
  const [sent, setSent] = useState(null);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  /**
   * Someone who runs an organization skips the interests picker: the root
   * layout takes them to their console, where a seeded home feed means
   * nothing.
   */
  const proceed = () => {
    clearTimeout(timer.current);
    const manages =
      user?.role === PLATFORM_ROLE.SUPERADMIN ||
      spaces.some((s) => s.role === SPACE_ROLE.ADMIN || s.role === SPACE_ROLE.SUB_ADMIN);
    router.replace(manages ? '/' : '/(auth)/interests');
  };

  const join = async () => {
    if (code.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await joinSpace(code);
      setBusy(false);
      if (result.status === 'active') {
        setActiveSpaceId(result.space.id);
        proceed();
        return;
      }
      // Approval-gated — say so, then carry on by itself.
      setSent(result.space?.name ?? 'Your organization');
      timer.current = setTimeout(proceed, 2200);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <StepScaffold
      step={4}
      total={5}
      title="Joining an organization?"
      subtitle="If your school, academy or company is on Mimo, their code adds their topics, contests and leaderboards to your app."
      onBack={() => router.back()}
      footer={
        sent ? (
          <Button label="Continue" onPress={proceed} />
        ) : (
          <>
            <Button label="Join" loading={busy} disabled={code.length < 4} onPress={join} />
            <Button
              variant="ghost"
              label="I don't have a code"
              style={{ marginTop: space.xs }}
              onPress={proceed}
            />
          </>
        )
      }
    >
      <View style={[styles.field, focused && styles.fieldOn, error && styles.fieldBad]}>
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={(v) => {
            setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8));
            setError(null);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          maxLength={8}
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!sent}
          placeholder="ABC123"
          placeholderTextColor={colors.inkFaint}
          returnKeyType="go"
          onSubmitEditing={join}
          accessibilityLabel="Organization code"
        />
      </View>

      {sent ? (
        <View style={styles.sent} accessibilityLiveRegion="polite">
          <Icon name="check" size={16} color={colors.correct} />
          <Text variant="label" color={colors.correct} style={{ flex: 1 }}>
            Request sent — {sent} approves new members. You can play while you wait.
          </Text>
        </View>
      ) : error ? (
        <Text variant="meta" color={colors.wrong} style={styles.hint}>
          {error.message ?? 'That code did not match an organization. Check it and try again.'}
        </Text>
      ) : (
        <Text variant="meta" color={colors.inkFaint} style={styles.hint}>
          Six characters, from your teacher or admin. You can add it later from Settings.
        </Text>
      )}
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  field: {
    height: 72,
    justifyContent: 'center',
    borderRadius: layout.radiusInput,
    backgroundColor: colors.sunken,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    paddingHorizontal: space.lg,
  },
  fieldOn: { borderColor: colors.accent, backgroundColor: colors.nightRaised },
  fieldBad: { borderColor: colors.wrong, backgroundColor: colors.nightRaised },
  /** A code is read character by character — space the glyphs so it can be. */
  input: {
    fontFamily: fonts.display,
    fontSize: 26,
    lineHeight: 32,
    color: colors.ink,
    letterSpacing: 8,
    textAlign: 'center',
    padding: 0,
    includeFontPadding: false,
  },
  sent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.correctSoft,
    borderRadius: layout.radiusInput,
    padding: space.md,
    marginTop: space.md,
  },
  hint: { marginTop: space.md },
});
