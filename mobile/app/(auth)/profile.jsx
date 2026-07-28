import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/state/auth.jsx';
import { useConsolePath } from '../../src/lib/admin.js';
import { Text, Button, ErrorNotice } from '../../src/components/ui.jsx';
import { StepScaffold } from '../../src/components/Onboarding.jsx';
import { colors, fonts, layout, space } from '../../src/theme/index.js';

/**
 * Sign-up, step 1 — the name.
 *
 * The whole profile used to be one scrolling form: name, fourteen faces,
 * thirty country chips and a code field, all at once. Split up, each step gets
 * to ask its question at full size, and the person answering only ever holds
 * one decision in their head. Each step saves as it is passed, so a dropped
 * call or a killed app costs at most the step in progress.
 *
 * **A manager stops here.** The four steps after this one are the player's —
 * a face for the versus screen, a country for the flag beside it, an
 * organization to join, topics to be matched on — and not one of them means
 * anything to someone whose app is a console. An admin created by a superadmin
 * was being walked through all four before they could reach the organization
 * they already own, and being asked to join one on the way.
 */
export default function NameStep() {
  const router = useRouter();
  const { updateProfile, user } = useAuth();
  /** '/admin' or '/super' for a manager, null for a player. */
  const consolePath = useConsolePath();
  const [name, setName] = useState(user?.displayName ?? '');
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const trimmed = name.trim();
  const ready = trimmed.length >= 2;

  const next = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateProfile({ displayName: trimmed });
      // `replace`, not `push`: a manager has finished, and the back gesture
      // should not walk them into a sign-up they were never part of.
      if (consolePath) router.replace(consolePath);
      else router.push('/(auth)/avatar');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepScaffold
      step={1}
      total={consolePath ? 1 : 5}
      title="What should we call you?"
      subtitle={
        consolePath
          ? 'This is the name your team sees beside anything you publish.'
          : 'This is the name your rival sees on the versus screen. Nothing else about you is public.'
      }
      footer={
        <>
          <ErrorNotice error={error} />
          <Button
            label={consolePath ? 'Continue to console' : 'Continue'}
            loading={busy}
            disabled={!ready}
            onPress={next}
          />
        </>
      }
    >
      <View style={[styles.field, focused && styles.fieldOn]}>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          maxLength={24}
          autoFocus
          autoCapitalize="words"
          autoCorrect={false}
          placeholder="Your name"
          placeholderTextColor={colors.inkFaint}
          returnKeyType="next"
          onSubmitEditing={next}
          accessibilityLabel="Display name"
        />
      </View>

      <View style={styles.meta}>
        <Text variant="meta" color={colors.inkFaint}>
          {consolePath ? 'Your real name is the useful one here.' : 'A first name or a handle both work.'}
        </Text>
        <Text variant="meta" color={name.length >= 20 ? colors.optionC : colors.inkFaint}>
          {name.length}/24
        </Text>
      </View>
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  field: {
    height: 66,
    justifyContent: 'center',
    borderRadius: layout.radiusInput,
    backgroundColor: colors.sunken,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    paddingHorizontal: space.lg,
  },
  fieldOn: { borderColor: colors.accent, backgroundColor: colors.nightRaised },
  input: {
    fontFamily: fonts.display,
    fontSize: 24,
    lineHeight: 30,
    color: colors.ink,
    padding: 0,
    includeFontPadding: false,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.md,
  },
});
