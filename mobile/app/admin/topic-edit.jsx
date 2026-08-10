import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import TopicMedallion, {
  ICON_SCHEME,
  SUBJECTS,
  resolveTopicFace,
} from '../../src/components/TopicMedallion.jsx';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../../src/lib/api.js';
import { useConsoleBack } from '../../src/lib/consoleBack.js';
import { useConsoleSpace } from '../../src/lib/admin.js';
import {
  ConsoleFooter,
  Text,
  Button,
  Chip,
  ConfirmSheet,
  EmptyState,
  ErrorNotice,
  Header,
  Skeleton,
  Swatches,
} from '../../src/components/ui.jsx';
import {
  MIN_PUBLISHED_QUESTIONS_TO_LIVE,
  SPACE_ACCENTS,
  TOPIC_STATUS,
} from '../../src/shared/constants.js';
import { colors, consoleLayout, layout, space, type } from '../../src/theme/console.js';

/**
 * prd.md F8.3 — one form for both jobs: no `topicId` param means a new topic,
 * a `topicId` means editing it. A topic cannot exist without a category, so
 * the category creator lives inside this form rather than on its own screen —
 * when the space has no categories at all it starts open, and the admin makes
 * both in one visit.
 *
 * Archiving asks first, in the app's own sheet; the 21-question rule is
 * enforced by the server, and its refusal is shown verbatim beside the status
 * chips — the message already says exactly what is missing.
 *
 * Mounted at `/admin/topic-edit` and at `/super/topic-edit`, where it is the
 * Central Bank's topic form and, with it, the only place a central CATEGORY
 * gets made. See `useConsoleSpace`.
 */
const STATUS_OPTIONS = [
  { value: TOPIC_STATUS.DRAFT, label: 'Draft' },
  { value: TOPIC_STATUS.PUBLISHED, label: 'Published' },
  { value: TOPIC_STATUS.ARCHIVED, label: 'Archived' },
];

/** The drawn faces, in the order `TopicMedallion` declares them. */
const ICON_KEYS = Object.keys(SUBJECTS);

/** `general` → "General". The wire key is lowercase; the chooser is not. */
function subjectLabel(key) {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

const STATUS_HINTS = {
  [TOPIC_STATUS.DRAFT]: 'Hidden from students.',
  [TOPIC_STATUS.PUBLISHED]: `Students can play it once ${MIN_PUBLISHED_QUESTIONS_TO_LIVE} questions are published.`,
  [TOPIC_STATUS.ARCHIVED]: 'Students lose access. Its questions stay in the bank.',
};

export default function AdminTopicEdit() {
  const goBack = useConsoleBack();
  const { spaceId, spaceName } = useConsoleSpace();
  const params = useLocalSearchParams();
  const topicId = typeof params.topicId === 'string' ? params.topicId : undefined;
  const editing = Boolean(topicId);

  const [ready, setReady] = useState(!editing);
  const [categories, setCategories] = useState([]);

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState(null);
  const [description, setDescription] = useState('');
  const [sourceOwn, setSourceOwn] = useState(true);
  const [sourceCentral, setSourceCentral] = useState(false);
  const [coverUrl, setCoverUrl] = useState(null);
  const [status, setStatus] = useState(TOPIC_STATUS.DRAFT);

  const [creatorOpen, setCreatorOpen] = useState(false);
  const [catName, setCatName] = useState('');
  const [catColor, setCatColor] = useState(SPACE_ACCENTS[0]);
  const [catBusy, setCatBusy] = useState(false);

  const [focusedField, setFocusedField] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const load = useCallback(async () => {
    if (!spaceId) return;
    try {
      setError(null);
      const [cats, topics] = await Promise.all([
        api.get('/admin/categories', { spaceId }),
        topicId ? api.get('/admin/topics', { spaceId }) : Promise.resolve(null),
      ]);
      const catItems = cats.items ?? [];
      setCategories(catItems);
      if (catItems.length === 0) setCreatorOpen(true);

      if (topicId) {
        const topic = (topics?.items ?? []).find((t) => t.id === topicId);
        if (!topic) {
          setError(new Error('That topic could not be found. Go back and try again.'));
          return;
        }
        setName(topic.name ?? '');
        setCategoryId(topic.categoryId ?? null);
        setDescription(topic.description ?? '');
        setSourceOwn(Boolean(topic.questionSources?.own));
        setSourceCentral(Boolean(topic.questionSources?.central));
        setCoverUrl(topic.coverUrl ?? null);
        setStatus(topic.status ?? TOPIC_STATUS.DRAFT);
      }
      setReady(true);
    } catch (err) {
      setError(err);
    }
  }, [spaceId, topicId]);

  useEffect(() => {
    load();
  }, [load]);

  const createCategory = async () => {
    setCatBusy(true);
    setError(null);
    try {
      const created = await api.post('/admin/categories', {
        spaceId,
        name: catName.trim(),
        color: catColor,
      });
      setCategories((prev) => [...prev, created]);
      setCategoryId(created.id);
      setCatName('');
      setCreatorOpen(false);
    } catch (err) {
      setError(err);
    } finally {
      setCatBusy(false);
    }
  };

  const pickCover = async () => {
    setError(null);
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.85,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      setUploading(true);
      const asset = picked.assets[0];
      const stored = await api.upload('cover', asset.uri, asset.mimeType ?? 'image/jpeg');
      setCoverUrl(stored.url);
    } catch (err) {
      setError(err);
    } finally {
      setUploading(false);
    }
  };

  const pickStatus = (value) => {
    setStatusError(null);
    if (value === TOPIC_STATUS.ARCHIVED && status !== TOPIC_STATUS.ARCHIVED) {
      setConfirmArchive(true);
      return;
    }
    setStatus(value);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setStatusError(null);
    try {
      const body = {
        spaceId,
        name: name.trim(),
        categoryId,
        questionSources: { own: sourceOwn, central: sourceCentral },
      };
      const desc = description.trim();
      /**
       * An edit sends the cover EVERY time, empty included.
       *
       * The server treats an absent key as "leave it alone", so while this was
       * `if (coverUrl)` the new Clear button could not have worked — you could
       * pick a different icon but never take one off.
       */
      if (editing) body.coverUrl = coverUrl ?? '';
      else if (coverUrl) body.coverUrl = coverUrl;
      if (editing) {
        body.description = desc;
        body.status = status;
        await api.patch(`/admin/topics/${topicId}`, body);
      } else {
        if (desc) body.description = desc;
        await api.post('/admin/topics', body);
      }
      goBack();
    } catch (err) {
      if (err.code === 'TOPIC_NOT_READY') setStatusError(err.message);
      else setError(err);
    } finally {
      setBusy(false);
    }
  };

  /** Whether the stored cover is a real picture or one the app draws. */
  const face = resolveTopicFace(coverUrl, name);

  if (!spaceId) {
    return (
      <SafeAreaView style={styles.screen} edges={[]}>
        <Header title="New topic" onBack={goBack} />
        <EmptyState
          tone="content"
          icon="alert"
          title="No organization to manage"
          body="This area appears when an organization has made you an admin."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={[]}>
      <Header
        title={editing ? 'Edit topic' : 'New topic'}
        subtitle={spaceName}
        onBack={goBack}
      />

      {!ready && !error ? (
        <FormSkeleton />
      ) : !ready ? (
        <ErrorNotice error={error} onRetry={load} />
      ) : (
        <>
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
              maxLength={60}
              placeholder="Thermodynamics"
              placeholderTextColor={colors.inkFaint}
              accessibilityLabel="Topic name"
            />

            <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
              Category
            </Text>
            <View style={styles.chips}>
              {categories.map((cat) => (
                <Chip
                  key={cat.id}
                  label={cat.name}
                  active={categoryId === cat.id}
                  onPress={() => setCategoryId(cat.id)}
                />
              ))}
              <Chip
                label="New category"
                active={creatorOpen}
                onPress={() => setCreatorOpen((open) => !open)}
              />
            </View>

            {creatorOpen ? (
              <View style={styles.creator}>
                <TextInput
                  style={[styles.input, focusedField === 'catName' && styles.inputFocused]}
                  value={catName}
                  onChangeText={setCatName}
                  onFocus={() => setFocusedField('catName')}
                  onBlur={() => setFocusedField(null)}
                  maxLength={60}
                  placeholder="Category name"
                  placeholderTextColor={colors.inkFaint}
                  accessibilityLabel="Category name"
                />
                <Swatches
                  value={catColor}
                  colors={SPACE_ACCENTS}
                  onChange={setCatColor}
                  noun="Category colour"
                />
                <Button
                  size="sm"
                  variant="soft"
                  label="Add category"
                  fullWidth={false}
                  loading={catBusy}
                  disabled={catName.trim().length < 2}
                  style={{ alignSelf: 'flex-start' }}
                  onPress={createCategory}
                />
              </View>
            ) : null}

            <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
              Description
            </Text>
            <TextInput
              style={[styles.input, focusedField === 'description' && styles.inputFocused]}
              value={description}
              onChangeText={setDescription}
              onFocus={() => setFocusedField('description')}
              onBlur={() => setFocusedField(null)}
              maxLength={280}
              placeholder="One line. Shown under the topic name."
              placeholderTextColor={colors.inkFaint}
              accessibilityLabel="Topic description"
            />

            <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
              Question sources
            </Text>
            <SourceRow
              label="Our own bank"
              hint="Questions this organization writes and reviews."
              value={sourceOwn}
              onChange={setSourceOwn}
            />
            <SourceRow
              label="Central bank"
              hint="Questions from the shared Mimo bank."
              value={sourceCentral}
              onChange={setSourceCentral}
            />

            <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
              Cover
            </Text>
            {/**
             * A real uploaded cover fills the frame. Anything else — a drawn
             * `mimo:icon/<subject>`, or no cover at all — is the medallion,
             * centred, because that is literally what a student will see.
             *
             * This used to hand `coverUrl` straight to an `<Image>`, which
             * cannot fetch the icon scheme most topics actually carry: opening
             * a seeded topic showed a flat category-coloured box, with even the
             * fallback letter suppressed because the value was truthy.
             */}
            {face.kind === 'image' ? (
              <View style={styles.cover}>
                <Image
                  source={{ uri: face.uri }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  transition={160}
                />
              </View>
            ) : (
              <View style={[styles.cover, styles.coverDrawn]}>
                <TopicMedallion coverUrl={coverUrl} name={name} size={96} shape="tile" />
              </View>
            )}
            {/**
             * Pick the face, don't hunt for one.
             *
             * The only way to set a cover was to leave the app, open the photo
             * library and find a picture — for a topic called "Thermodynamics",
             * on a phone, in a school office. So almost nobody did, and the
             * catalogue we seeded is the proof: every one of its topics carries
             * a drawn `mimo:icon/<subject>` that the admin console had no way to
             * choose, change, or even see.
             *
             * These are the same thirteen faces the player app draws, so what
             * an admin taps here is literally what a student will look at.
             */}
            <View style={styles.iconGrid}>
              {ICON_KEYS.map((key) => {
                const value = `${ICON_SCHEME}${key}`;
                const on = coverUrl === value;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setCoverUrl(on ? null : value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${subjectLabel(key)} icon`}
                    style={styles.iconCell}
                  >
                    <View style={[styles.iconRing, on && styles.iconRingOn]}>
                      <TopicMedallion coverUrl={value} name={key} size={42} shape="tile" />
                    </View>
                    <Text
                      variant="tiny"
                      color={on ? colors.accent : colors.inkFaint}
                      numberOfLines={1}
                    >
                      {subjectLabel(key)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.coverActions}>
              <Button
                size="sm"
                variant="ghost"
                icon="plus"
                label="Upload a photo"
                fullWidth={false}
                loading={uploading}
                onPress={pickCover}
              />
              {coverUrl ? (
                <Button
                  size="sm"
                  variant="ghost"
                  label="Clear it"
                  fullWidth={false}
                  onPress={() => setCoverUrl(null)}
                />
              ) : null}
            </View>
            <Text variant="meta" color={colors.inkFaint} style={{ marginTop: space.sm }}>
              With no cover at all, Mimo draws one from the name of the topic.
            </Text>

            {editing ? (
              <>
                <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
                  Status
                </Text>
                <View style={styles.chips}>
                  {STATUS_OPTIONS.map((option) => (
                    <Chip
                      key={option.value}
                      label={option.label}
                      active={status === option.value}
                      onPress={() => pickStatus(option.value)}
                    />
                  ))}
                </View>
                <Text variant="meta" color={colors.inkFaint} style={{ marginTop: space.sm }}>
                  {STATUS_HINTS[status]}
                </Text>
                {statusError ? (
                  <Text variant="meta" color={colors.wrong} style={{ marginTop: space.sm }}>
                    {statusError}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text variant="meta" color={colors.inkFaint} style={styles.note}>
                A new topic starts as a draft, hidden from students. It can be published once it
                has {MIN_PUBLISHED_QUESTIONS_TO_LIVE} published questions.
              </Text>
            )}
          </ScrollView>

          <ConsoleFooter>
            <ErrorNotice error={error} />
            <Button
              label={editing ? 'Save changes' : 'Create topic'}
              loading={busy}
              disabled={name.trim().length < 2 || !categoryId}
              onPress={save}
            />
          </ConsoleFooter>
        </>
      )}

      <ConfirmSheet
        visible={confirmArchive}
        destructive
        icon="book"
        title={`Archive ${name.trim() || 'this topic'}?`}
        body="Students lose access to it. Its questions stay in the bank."
        confirmLabel="Archive"
        onConfirm={() => {
          setStatus(TOPIC_STATUS.ARCHIVED);
          setConfirmArchive(false);
        }}
        onCancel={() => setConfirmArchive(false)}
      />
    </SafeAreaView>
  );
}

function SourceRow({ label, hint, value, onChange }) {
  return (
    <View style={styles.sourceRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="bodyStrong">{label}</Text>
        <Text variant="meta" color={colors.inkFaint}>
          {hint}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.accent, false: colors.hairline }}
        thumbColor={colors.onColor}
        ios_backgroundColor={colors.hairline}
      />
    </View>
  );
}

/** The form's own shape, so nothing jumps when the topic lands. */
function FormSkeleton() {
  return (
    <View style={styles.skeleton}>
      <Skeleton width={64} height={12} radius={6} />
      <Skeleton width="100%" height={54} radius={layout.radiusInput} />
      <Skeleton width={88} height={12} radius={6} style={{ marginTop: space.lg }} />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Skeleton width={96} height={38} radius={19} />
        <Skeleton width={76} height={38} radius={19} />
        <Skeleton width={120} height={38} radius={19} />
      </View>
      <Skeleton width="100%" height={180} radius={layout.radiusCard} style={{ marginTop: space.lg }} />
    </View>
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  creator: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: layout.radiusInput,
    borderWidth: 1,
    borderColor: colors.hairline,
    gap: space.md,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingVertical: space.sm,
  },
  cover: {
    aspectRatio: 16 / 9,
    borderRadius: layout.radiusCard,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The drawn face sits ON the field rather than on a colour block: the
  // medallion brings its own tint, and a category-coloured slab behind it was
  // two competing backgrounds.
  coverDrawn: {
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  coverInitial: {
    ...type.display,
    color: colors.onColor,
    fontSize: 44,
    lineHeight: 60,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  /** Fixed cells rather than a flex basis, so the wrap is the same every time. */
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.lg,
  },
  iconCell: { width: 60, alignItems: 'center', gap: 4 },
  iconRing: {
    padding: 3,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: colors.transparent,
  },
  iconRingOn: { borderColor: colors.accent },
  coverActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg },
  note: { marginTop: space.xl },
  skeleton: { paddingHorizontal: consoleLayout.gutter, paddingTop: space.lg, gap: space.sm },
});
