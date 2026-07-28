import { useEffect, useRef, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/state/auth.jsx';
import { Text, Button, ErrorNotice } from '../../src/components/ui.jsx';
import { StepScaffold } from '../../src/components/Onboarding.jsx';
import Icon from '../../src/components/Icon.jsx';
import { faceName, faceSource, faceUri } from '../../src/lib/avatar.js';
import { useFreeAvatars } from '../../src/state/progression.jsx';
import { colors, layout, space } from '../../src/theme/index.js';
import { useReducedMotion } from '../../src/lib/motion.js';

/**
 * Sign-up, step 2 of 5 — the face.
 *
 * Shown large before it is shown small: the preview is the size the versus
 * screen draws it, so the choice is made against the place it will be seen
 * rather than against a 54px thumbnail. Picking springs the preview, which is
 * the only feedback needed to know the tap landed.
 *
 * Only the **free tier** appears here (leagues-and-progression.md §9). A new
 * account owns exactly these, so a grid with the earned ones in it would be a
 * grid where most taps do nothing — and the ones that did nothing would be the
 * best-looking ones on the screen. What is coming is worth showing, but the
 * rewards shelf is where it belongs, not the fourth screen of a sign-up.
 */
export default function AvatarStep() {
  const router = useRouter();
  const { updateProfile, user } = useAuth();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const freeAvatars = useFreeAvatars();
  const faces = freeAvatars.map((c) => c.key).filter((key) => faceSource(key));
  const [face, setFace] = useState(faceName(user?.avatarUrl) ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pop = useRef(new Animated.Value(1)).current;

  // Columns are computed rather than fixed: four on a 375pt phone keeps the
  // cell above the 44pt touch minimum with room to spare, five on a big one.
  const columns = width >= 414 ? 5 : 4;
  const cell = Math.floor((width - layout.gutter * 2 - space.md * (columns - 1)) / columns);

  // The free set is configuration, so the default has to come from it rather
  // than from a name compiled into this screen — an operator who renames the
  // starters must not leave the picker pointing at a face that is gone.
  useEffect(() => {
    if (!face && faces.length) setFace(faces[0]);
  }, [face, faces]);

  useEffect(() => {
    if (reduced || !face) return;
    pop.setValue(0.9);
    Animated.spring(pop, { toValue: 1, friction: 5, tension: 220, useNativeDriver: true }).start();
  }, [face, pop, reduced]);

  const next = async () => {
    if (busy || !face) return;
    setBusy(true);
    setError(null);
    try {
      await updateProfile({ avatarUrl: faceUri(face) });
      router.push('/(auth)/country');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepScaffold
      step={2}
      total={5}
      title="Pick your face"
      subtitle="It rides next to your name in every match. You can change it whenever you like."
      onBack={() => router.back()}
      scroll
      footer={
        <>
          <ErrorNotice error={error} />
          <Button label="Continue" loading={busy} disabled={!face} onPress={next} />
        </>
      }
    >
      <View style={styles.preview}>
        <Animated.View style={{ transform: [{ scale: pop }] }}>
          <View style={styles.previewRing}>
            {face ? (
              <Image source={faceSource(face)} style={styles.previewFace} resizeMode="cover" />
            ) : null}
          </View>
        </Animated.View>
        <Text variant="title" style={{ marginTop: space.md }} numberOfLines={1}>
          {user?.displayName ?? 'You'}
        </Text>
      </View>

      <View style={styles.grid} accessibilityRole="radiogroup">
        {faces.map((name) => {
          const on = name === face;
          return (
            <Pressable
              key={name}
              onPress={() => setFace(name)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${name} avatar`}
              style={({ pressed }) => [
                styles.cell,
                { width: cell, height: cell, borderRadius: cell / 2 },
                on && styles.cellOn,
                pressed && !reduced && { transform: [{ scale: 0.94 }] },
              ]}
            >
              <Image source={faceSource(name)} style={styles.cellFace} resizeMode="cover" />
              {on ? (
                <View style={styles.tick}>
                  <Icon name="check" size={11} color={colors.onAccent} />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  preview: { alignItems: 'center', paddingBottom: space.xl },
  previewRing: {
    width: 116,
    height: 116,
    borderRadius: 58,
    borderWidth: 3,
    borderColor: colors.accent,
    overflow: 'hidden',
    backgroundColor: colors.nightRaised,
    shadowColor: colors.accent,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  previewFace: { width: '100%', height: '100%' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, justifyContent: 'flex-start' },
  cell: {
    overflow: 'hidden',
    backgroundColor: colors.sunken,
    borderWidth: 2,
    borderColor: colors.hairline,
  },
  cellOn: { borderColor: colors.accent, borderWidth: 3 },
  cellFace: { width: '100%', height: '100%' },
  tick: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.canvas,
  },
});
