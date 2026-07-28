import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradientFallback } from './Scrim.jsx';
import { Badge, Text } from './ui.jsx';
import Icon from './Icon.jsx';
import TopicMedallion, { resolveTopicFace, withAlpha } from './TopicMedallion.jsx';
import { colors, elevation, layout, space, type } from '../theme/index.js';

/**
 * design.md §6.4 — the topic card, in three shapes.
 *
 *   tile  — the unit of every horizontal row on Home. Cover on top, name and
 *           metadata on white beneath it.
 *   hero  — the same card at full width, for "Start here" and for search.
 *   row   — a 72px thumbnail beside two lines of text, for dense lists.
 *
 * Cover art carries topic identity, so the chrome stays minimal: one badge for
 * the level the viewer has reached, and nothing else. No ribbons, no floating
 * labels, no second badge — the moment a card has two, neither is read.
 */
export default function TopicCard({ topic, width = 176, onPress, hero = false, variant, style }) {
  const shape = variant ?? (hero ? 'hero' : 'tile');

  const meta = [
    topic.activePlayers ? `${topic.activePlayers} playing` : null,
    topic.viewerRank ? `Rank ${topic.viewerRank}` : null,
    topic.questionCount ? `${topic.questionCount} questions` : null,
  ].filter(Boolean);

  const label = `${topic.name}. ${meta.join('. ')}`;

  /**
   * `grid` — the unit of the Home grid. The cover IS the card: full-bleed art,
   * a scrim, and the name sitting on the image (the pattern every streaming
   * and quiz app converged on, because a wall of images invites browsing the
   * way a wall of white cards never does). Width comes from the grid.
   *
   * `style` overrides that for parents that lay out differently — but note
   * what has to be overridden. The three properties below are one unit:
   * `flexBasis: 48%` sizes the card for a wrapping row, `flexGrow: 0` stops it
   * absorbing slack, and `aspectRatio` derives the height from the width. Pass
   * a `flex` and leave `flexGrow` alone and the explicit `0` wins, the basis
   * falls back to content, and the card measures to nothing — which is exactly
   * what happened the first time the Play grid was built.
   *
   * So a caller that changes the geometry should state `width` and `height`
   * outright rather than re-flex it. Play and Home both do.
   */
  if (shape === 'grid') {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.grid, style, pressed ? { transform: [{ scale: 0.97 }] } : null]}
      >
        <Cover topic={topic} />
        <LinearGradientFallback />
        {topic.viewer ? (
          <Badge label={`Lv ${topic.viewer.level}`} tone="accent" style={styles.gridBadge} />
        ) : null}
        <View style={styles.gridFoot}>
          <Text variant="label" color={colors.onColor} numberOfLines={2}>
            {topic.name}
          </Text>
          {meta.length > 0 ? (
            <Text variant="tiny" color="rgba(255,255,255,0.75)" numberOfLines={1}>
              {meta[0]}
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  }

  if (shape === 'row') {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
      >
        {/* Circular in a list: beside a name it reads as an emblem, the same
            way an avatar does, and the row stops looking like a file browser. */}
        <TopicMedallion coverUrl={topic.coverUrl} name={topic.name} size={54} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="label" numberOfLines={2}>
            {topic.name}
          </Text>
          <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
            {topic.categoryName ?? meta[0] ?? ''}
          </Text>
          {topic.viewer ? (
            <Text variant="meta" color={colors.accent}>
              Level {topic.viewer.level}
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.card,
        shape === 'hero' ? styles.cardHero : { width },
        pressed ? { opacity: 0.85 } : null,
      ]}
    >
      <View style={[styles.cover, shape === 'hero' && styles.coverHero]}>
        <Cover topic={topic} />
        {shape === 'hero' ? (
          <>
            <LinearGradientFallback />
            <Text style={[type.title, styles.heroName]} numberOfLines={2}>
              {topic.name}
            </Text>
          </>
        ) : null}
        {topic.viewer ? (
          <Badge label={`Level ${topic.viewer.level}`} style={styles.badge} />
        ) : topic.questionCount ? (
          <Badge label={`${topic.questionCount} Qs`} style={styles.badge} />
        ) : null}
      </View>

      {/* A hero with no metadata has no foot at all — an empty white strip
          under a full-bleed cover reads as a rendering gap, not padding. */}
      {shape === 'hero' && meta.length === 0 ? null : (
        <View style={styles.foot}>
          {shape === 'hero' ? null : (
            <Text variant="label" numberOfLines={2} style={{ minHeight: 40 }}>
              {topic.name}
            </Text>
          )}
          {meta.length > 0 ? (
            <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
              {meta.join('  ·  ')}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

/**
 * The full-bleed face of a tile or hero.
 *
 * A topic whose cover is a subject glyph gets a field in its own hue with the
 * mark centred on it, rather than a photograph. That is the whole point of the
 * change: the catalogue used to mix stock photos with letter squares, some of
 * the photos were about the wrong subject entirely — Python wearing a picture
 * of an Arduino board — and nothing tied the grid together. A drawn field is
 * always about its subject and always looks like the same product.
 */
function Cover({ topic }) {
  const face = resolveTopicFace(topic.coverUrl, topic.name);

  if (face.kind === 'image') {
    return (
      <Image
        source={{ uri: face.uri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={160}
      />
    );
  }

  return (
    <View style={[StyleSheet.absoluteFill, styles.glyphWrap, { backgroundColor: withAlpha(face.hue, 0.18) }]}>
      {face.kind === 'icon' ? (
        <Icon name={face.icon} size={54} color={face.hue} />
      ) : (
        <Text style={[type.scoreHero, { color: face.hue }]} allowFontScaling={false}>
          {(topic.name ?? '?').trim().charAt(0).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginRight: layout.cardGap,
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    ...elevation.raised,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  cardHero: { width: '100%', marginRight: 0 },
  cover: {
    aspectRatio: 16 / 11,
    borderTopLeftRadius: layout.radiusCard,
    borderTopRightRadius: layout.radiusCard,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    backgroundColor: colors.sunken,
  },
  coverHero: {
    aspectRatio: 16 / 9,
    borderRadius: layout.radiusCard,
  },
  glyphWrap: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  heroName: { color: colors.onColor, padding: space.lg },
  badge: { position: 'absolute', top: space.sm, right: space.sm },
  foot: { padding: space.md, gap: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: layout.radiusInput,
    minHeight: 88,
  },
  rowPressed: { backgroundColor: colors.sunken },
  thumb: {
    width: 76,
    height: 72,
    borderRadius: layout.radiusInput,
    overflow: 'hidden',
    backgroundColor: colors.sunken,
  },
  grid: {
    // Two per row; the parent grid supplies the gap and the gutters.
    flexBasis: '48%',
    flexGrow: 0,
    aspectRatio: 1.05,
    borderRadius: layout.radiusCard,
    overflow: 'hidden',
    backgroundColor: colors.sunken,
    justifyContent: 'flex-end',
    ...elevation.raised,
  },
  gridBadge: { position: 'absolute', top: space.sm, right: space.sm },
  gridFoot: { padding: space.md, gap: 2 },
});
