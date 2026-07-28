import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../src/lib/api.js';
import { useAuth } from '../../src/state/auth.jsx';
import { Text, Button, Loading, ErrorNotice } from '../../src/components/ui.jsx';
import { StepScaffold } from '../../src/components/Onboarding.jsx';
import { TopicGlyph } from '../../src/components/Illustration.jsx';
import Icon from '../../src/components/Icon.jsx';
import { colors, layout, space } from '../../src/theme/index.js';
import { INTERESTS_MIN, INTERESTS_MAX } from '../../src/shared/constants.js';

/**
 * prd.md F6.1.4 — pick 3 to 8 topics on first run, used to seed the home feed.
 * design.md §8.1 — a skip is available here, defaulting to trending topics.
 *
 * Two columns of tiles rather than a chip cloud. A chip cloud reflows every
 * time a name is long and gives a player no sense of how many there are; a grid
 * is countable, and the tile is big enough that picking eight is quick.
 */
export default function Interests() {
  const router = useRouter();
  const { refreshProfile } = useAuth();
  const [topics, setTopics] = useState(null);
  const [chosen, setChosen] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/me/interests/candidates').then(setTopics).catch(setError);
  }, []);

  const toggle = (id) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else if (next.size < INTERESTS_MAX) next.add(id);
    setChosen(next);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put('/me/interests', { topicIds: [...chosen] });
      await refreshProfile();
      router.replace('/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepScaffold
      step={5}
      total={5}
      title="What do you know?"
      subtitle={`Pick ${INTERESTS_MIN} to ${INTERESTS_MAX}. They fill your home screen — you can change them later.`}
      onBack={() => router.back()}
      footer={
        <>
          <ErrorNotice error={error} />
          <Button
            label={
              chosen.size < INTERESTS_MIN
                ? `Pick ${INTERESTS_MIN - chosen.size} more`
                : `Start playing · ${chosen.size} picked`
            }
            disabled={chosen.size < INTERESTS_MIN}
            loading={busy}
            onPress={save}
          />
          <Button
            variant="ghost"
            label="Skip — show me what's trending"
            style={{ marginTop: space.xs }}
            onPress={() => router.replace('/')}
          />
        </>
      }
    >
      {!topics ? (
        <Loading />
      ) : (
        <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
          {topics.map((t) => {
            const on = chosen.has(t.id);
            return (
              <Pressable
                key={t.id}
                onPress={() => toggle(t.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                style={({ pressed }) => [styles.tile, on && styles.tileOn, pressed && { opacity: 0.7 }]}
              >
                <TopicGlyph name={t.name} size={44} radius={12} />
                <Text variant="label" numberOfLines={2} style={{ flex: 1 }}>
                  {t.name}
                </Text>
                {on ? (
                  <View style={styles.tick}>
                    <Icon name="check" size={13} color={colors.onAccent} />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: layout.cardGap,
    paddingBottom: space.lg,
  },
  tile: {
    // Two per row, allowing for the 20px gutters and the 12px gap between.
    // No `flexGrow`: with an odd number of topics it stretched the last tile
    // to full width, so the final row looked like a different component.
    width: '47.5%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 76,
    padding: space.md,
    borderRadius: layout.radiusCard,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.canvas,
  },
  tileOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  tick: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
