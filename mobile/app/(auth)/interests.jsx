import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../src/lib/api.js';
import { useAuth } from '../../src/state/auth.jsx';
import { Text, Button, Loading, ErrorNotice } from '../../src/components/ui.jsx';
import { StepScaffold } from '../../src/components/Onboarding.jsx';
import TopicMedallion, { withAlpha } from '../../src/components/TopicMedallion.jsx';
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
 *
 * The tile carries the topic's REAL face — the same `TopicMedallion` the home
 * grid, the versus screen and every topic list use. It used to draw a
 * `TopicGlyph`, which is a coloured square with the first letter of the name in
 * it, so the first screen in the game showed a wall of letter tiles and then
 * every screen after it showed subject marks. The medallion resolves the
 * topic's `coverUrl`, which the catalogue already sends on this very endpoint.
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

  /**
   * Grouped by category, in the order the catalogue returned them.
   *
   * Forty flat tiles is a scroll with no landmarks in it — the player cannot
   * tell whether they have seen the sports ones yet, and two topics from the
   * same category can sit ten rows apart. Headed sections make the list
   * skimmable and make "pick three" a decision about subjects rather than a
   * hunt through a wall.
   */
  const sections = useMemo(() => {
    if (!topics) return [];
    const order = [];
    const byCategory = new Map();
    for (const t of topics) {
      const key = t.categoryName ?? 'More';
      if (!byCategory.has(key)) {
        byCategory.set(key, { name: key, color: t.categoryColor ?? colors.accent, items: [] });
        order.push(key);
      }
      byCategory.get(key).items.push(t);
    }
    return order.map((k) => byCategory.get(k));
  }, [topics]);

  const atMax = chosen.size >= INTERESTS_MAX;

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
        <>
          {/*
            The count, as a row of pips rather than a number.
            "3 picked" makes the player do the arithmetic against a minimum
            they have to remember; eight slots filling up left to right says
            how many are needed, how many are spent and how many remain in one
            glance. The first three are marked as the ones that matter.
          */}
          <View style={styles.meter} accessibilityLabel={`${chosen.size} of ${INTERESTS_MAX} picked`}>
            {Array.from({ length: INTERESTS_MAX }, (_, i) => {
              const filled = i < chosen.size;
              const required = i < INTERESTS_MIN;
              return (
                <View
                  key={i}
                  style={[
                    styles.pip,
                    required && styles.pipRequired,
                    filled && styles.pipFilled,
                    filled && !required && styles.pipBonus,
                  ]}
                />
              );
            })}
            <Text variant="meta" color={colors.inkFaint} style={{ marginLeft: space.sm }}>
              {chosen.size < INTERESTS_MIN
                ? `${INTERESTS_MIN - chosen.size} to go`
                : atMax
                  ? 'that’s the lot'
                  : `${INTERESTS_MAX - chosen.size} more if you like`}
            </Text>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            {sections.map((section) => (
              <View key={section.name} style={styles.section}>
                <View style={styles.sectionHead}>
                  <View style={[styles.sectionDot, { backgroundColor: section.color }]} />
                  <Text variant="meta" color={colors.inkFaint} style={styles.sectionName}>
                    {section.name.toUpperCase()}
                  </Text>
                </View>

                <View style={styles.grid}>
                  {section.items.map((t) => {
                    const on = chosen.has(t.id);
                    // A tile that cannot be picked says so by fading, but only
                    // once the cap is reached — greying the whole grid before
                    // the player has chosen anything would read as broken.
                    const blocked = atMax && !on;
                    return (
                      <Pressable
                        key={t.id}
                        onPress={() => toggle(t.id)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on, disabled: blocked }}
                        accessibilityLabel={`${t.name}, ${section.name}`}
                        style={({ pressed }) => [
                          styles.tile,
                          on && { borderColor: colors.accent, backgroundColor: colors.accentSoft },
                          blocked && styles.tileBlocked,
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <TopicMedallion coverUrl={t.coverUrl} name={t.name} size={40} shape="tile" />
                        <View style={styles.tileText}>
                          <Text variant="label" numberOfLines={2}>
                            {t.name}
                          </Text>
                          {t.matchesPlayed > 0 ? (
                            <Text variant="tiny" color={colors.inkFaint} numberOfLines={1}>
                              {t.matchesPlayed.toLocaleString('en-IN')} played
                            </Text>
                          ) : null}
                        </View>
                        {on ? (
                          <View style={styles.tick}>
                            <Icon name="check" size={13} color={colors.onAccent} />
                          </View>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>
        </>
      )}
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  meter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: space.md,
  },
  pip: {
    width: 18,
    height: 5,
    borderRadius: 3,
    backgroundColor: withAlpha(colors.inkFaint, 0.28),
  },
  /** The three that unlock the button read heavier than the five that do not. */
  pipRequired: { backgroundColor: withAlpha(colors.inkFaint, 0.45) },
  pipFilled: { backgroundColor: colors.accent },
  pipBonus: { backgroundColor: withAlpha(colors.accent, 0.55) },

  scroll: { paddingBottom: space.lg },
  section: { marginBottom: space.lg },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginBottom: space.sm,
  },
  sectionDot: { width: 7, height: 7, borderRadius: 4 },
  sectionName: { letterSpacing: 0.8 },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: layout.cardGap,
  },
  tile: {
    // Two per row, allowing for the 20px gutters and the 12px gap between.
    // No `flexGrow`: with an odd number of topics it stretched the last tile
    // to full width, so the final row looked like a different component.
    width: '47.5%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 76,
    padding: space.sm,
    borderRadius: layout.radiusCard,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.canvas,
  },
  tileBlocked: { opacity: 0.4 },
  tileText: { flex: 1, gap: 2 },
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
