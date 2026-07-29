import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../../src/lib/api.js';
import { useConsoleBack } from '../../src/lib/consoleBack.js';
import { useAdminSpace } from '../../src/lib/admin.js';
import {
  Text,
  Button,
  Chip,
  ConfirmSheet,
  ErrorNotice,
  Header,
  Skeleton,
} from '../../src/components/ui.jsx';
import {
  MIN_PUBLISHED_QUESTIONS_TO_LIVE,
  SPACE_ACCENTS,
  TOPIC_STATUS,
} from '../../src/shared/constants.js';
import { colors, consoleLayout, layout, space, type } from '../../src/theme/index.js';

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
 */
const STATUS_OPTIONS = [
  { value: TOPIC_STATUS.DRAFT, label: 'Draft' },
  { value: TOPIC_STATUS.PUBLISHED, label: 'Published' },
  { value: TOPIC_STATUS.ARCHIVED, label: 'Archived' },
];

const STATUS_HINTS = {
  [TOPIC_STATUS.DRAFT]: 'Hidden from students.',
  [TOPIC_STATUS.PUBLISHED]: `Students can play it once ${MIN_PUBLISHED_QUESTIONS_TO_LIVE} questions are published.`,
  [TOPIC_STATUS.ARCHIVED]: 'Students lose access. Its questions stay in the bank.',
};

export default function AdminTopicEdit() {
  const goBack = useConsoleBack();
  const adminSpace = useAdminSpace();
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
    if (!adminSpace) return;
    try {
      setError(null);
      const [cats, topics] = await Promise.all([
        api.get('/admin/categories', { spaceId: adminSpace.id }),
        topicId ? api.get('/admin/topics', { spaceId: adminSpace.id }) : Promise.resolve(null),
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
  }, [adminSpace, topicId]);

  useEffect(() => {
    load();
  }, [load]);

  const createCategory = async () => {
    setCatBusy(true);
    setError(null);
    try {
      const created = await api.post('/admin/categories', {
        spaceId: adminSpace.id,
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
        spaceId: adminSpace.id,
        name: name.trim(),
        categoryId,
        questionSources: { own: sourceOwn, central: sourceCentral },
      };
      const desc = description.trim();
      if (coverUrl) body.coverUrl = coverUrl;
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

  const selectedCategory = categories.find((c) => c.id === categoryId);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header
        title={editing ? 'Edit topic' : 'New topic'}
        subtitle={adminSpace?.name}
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
                <View style={styles.swatches}>
                  {SPACE_ACCENTS.map((hex) => (
                    <Pressable
                      key={hex}
                      onPress={() => setCatColor(hex)}
                      accessibilityRole="button"
                      accessibilityLabel={`Category colour ${hex}`}
                      accessibilityState={{ selected: catColor === hex }}
                      style={({ pressed }) => [styles.swatchRing, catColor === hex && styles.swatchRingOn, pressed && { opacity: 0.7 }]}
                    >
                      <View style={[styles.swatch, { backgroundColor: hex }]} />
                    </Pressable>
                  ))}
                </View>
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
            <View
              style={[
                styles.cover,
                { backgroundColor: selectedCategory?.color ?? colors.sunken },
              ]}
            >
              {coverUrl ? (
                <Image
                  source={{ uri: coverUrl }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  transition={160}
                />
              ) : (
                <Text allowFontScaling={false} style={styles.coverInitial}>
                  {(name.trim() || 'A').charAt(0).toUpperCase()}
                </Text>
              )}
            </View>
            <Button
              size="sm"
              variant="soft"
              label={coverUrl ? 'Change cover' : 'Add a cover'}
              fullWidth={false}
              loading={uploading}
              style={{ alignSelf: 'flex-start', marginTop: space.md }}
              onPress={pickCover}
            />
            <Text variant="meta" color={colors.inkFaint} style={{ marginTop: space.sm }}>
              Without a cover, Mimo generates one from the category colour.
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

          <View style={styles.footer}>
            <ErrorNotice error={error} />
            <Button
              label={editing ? 'Save changes' : 'Create topic'}
              loading={busy}
              disabled={name.trim().length < 2 || !categoryId}
              onPress={save}
            />
          </View>
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
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: consoleLayout.gutter, paddingBottom: space.xl },
  fieldLabel: { marginTop: space.xl, marginBottom: space.sm },
  input: {
    ...type.option,
    color: colors.ink,
    backgroundColor: colors.sunken,
    borderRadius: layout.radiusInput,
    borderWidth: 1.5,
    borderColor: colors.transparent,
    paddingHorizontal: space.lg,
    height: 54,
  },
  inputFocused: { borderColor: colors.accent, backgroundColor: colors.canvas },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  creator: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: layout.radiusInput,
    borderWidth: 1,
    borderColor: colors.hairline,
    gap: space.md,
  },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  swatchRing: {
    padding: 2,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.transparent,
  },
  swatchRingOn: { borderColor: colors.ink },
  swatch: { width: 28, height: 28, borderRadius: 14 },
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
  coverInitial: {
    ...type.display,
    color: colors.onColor,
    fontSize: 44,
    lineHeight: 60,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  note: { marginTop: space.xl },
  footer: { padding: consoleLayout.gutter, paddingTop: space.sm },
  skeleton: { paddingHorizontal: consoleLayout.gutter, paddingTop: space.lg, gap: space.sm },
});
