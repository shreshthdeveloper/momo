import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useConsoleBack } from '../../src/lib/consoleBack.js';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../../src/lib/api.js';
import { useAdminPermissions, useAdminSpace } from '../../src/lib/admin.js';
import {
  Text,
  Badge,
  Button,
  Chip,
  EmptyState,
  ErrorNotice,
  Header,
  Segmented,
  Skeleton,
} from '../../src/components/ui.jsx';
import Icon from '../../src/components/Icon.jsx';
import QuestionArt, { ART_KEYS, artKeyOf, artUri } from '../../src/components/QuestionArt.jsx';
import { colors, consoleLayout, elevation, layout, space, type } from '../../src/theme/index.js';

/**
 * prd.md F8.2 — the question editor. One form for both jobs: no `id` param
 * means a new question, an `id` means editing it. The screen holds the writer
 * to the same rules the match holds the question to — the 140-character
 * comfort line, the 200-character ceiling, options that survive a timer — and
 * says so at the field rather than after the save. The server has the last
 * word: its validation failures land inline, its duplicate refusal opens a
 * sheet showing what it found, and its warnings are shown before leaving.
 *
 * The superadmin edits the central bank by passing `spaceId`, which then
 * scopes every request on this screen; the server re-checks the caller each
 * time, so honouring the param here grants nothing.
 */
const LETTERS = ['A', 'B', 'C', 'D'];

const DIFFICULTIES = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

const TIME_LIMITS = [
  { value: null, label: 'Default' },
  { value: 10_000, label: '10 s' },
  { value: 15_000, label: '15 s' },
  { value: 20_000, label: '20 s' },
  { value: 30_000, label: '30 s' },
  { value: 45_000, label: '45 s' },
  // The model and the org round-duration setting both go to 60s, so a question
  // already carrying that limit had no chip to highlight and no way to be set.
  { value: 60_000, label: '60 s' },
];

const STATUS_BADGE = {
  draft: { label: 'Draft', tone: 'soft' },
  in_review: { label: 'In review', tone: 'accent' },
  published: { label: 'Published', tone: 'correct' },
  archived: { label: 'Archived', tone: 'ink' },
};

/** Option shapes that read fine on paper and collapse under a timer. */
const UNTIMEABLE = [/^(all|none) of the above$/i, /^both .+ and .+$/i];

const emptyErrors = () => ({
  text: null,
  options: [null, null, null, null],
  topic: null,
  tags: null,
  explanation: null,
});

export default function AdminQuestionEdit() {
  const goBack = useConsoleBack();
  const adminSpace = useAdminSpace();
  const permissions = useAdminPermissions(adminSpace);
  /** The drawn-art key in `imageUrl`, or null when it is an uploaded URL. */
  const drawnArtKey = artKeyOf(imageUrl);
  const params = useLocalSearchParams();

  const id = typeof params.id === 'string' && params.id.length > 0 ? params.id : undefined;
  const editing = Boolean(id);
  const overrideSpaceId =
    typeof params.spaceId === 'string' && params.spaceId.length > 0 ? params.spaceId : null;
  const spaceId = overrideSpaceId ?? adminSpace?.id;
  const canPublish = overrideSpaceId ? true : permissions.canPublish;

  const [ready, setReady] = useState(!editing);
  const [topics, setTopics] = useState(null);
  const [servedEver, setServedEver] = useState(false);

  const [text, setText] = useState('');
  const [options, setOptions] = useState(['', '', '', '']);
  const [correctIndex, setCorrectIndex] = useState(0);
  const [difficulty, setDifficulty] = useState('medium');
  const [topicId, setTopicId] = useState(() =>
    typeof params.topicId === 'string' && params.topicId.length > 0 ? params.topicId : null,
  );
  const [tagsInput, setTagsInput] = useState('');

  const [moreOpen, setMoreOpen] = useState(false);
  const [explanation, setExplanation] = useState('');
  const [imageUrl, setImageUrl] = useState(null);
  /** Open when choosing from the drawn set — see the Picture block below. */
  const [artPicker, setArtPicker] = useState(false);
  const [timeLimitMs, setTimeLimitMs] = useState(null);

  const [focusedField, setFocusedField] = useState(null);
  const [fieldErrors, setFieldErrors] = useState(emptyErrors);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(null); // 'draft' | 'published' | 'in_review' | 'dupe'
  const [error, setError] = useState(null);
  const [duplicates, setDuplicates] = useState(null);
  const [savedWarnings, setSavedWarnings] = useState(null);

  const load = useCallback(async () => {
    if (!spaceId) return;
    try {
      setError(null);
      const [topicsData, question] = await Promise.all([
        api.get('/admin/topics', { spaceId }),
        id ? api.get(`/admin/questions/${id}`, { spaceId }) : Promise.resolve(null),
      ]);
      setTopics((topicsData.items ?? []).filter((t) => t.status !== 'archived'));

      if (question) {
        const pack =
          question.content?.[question.defaultLanguage] ??
          Object.values(question.content ?? {})[0] ??
          {};
        const opts = Array.isArray(pack.options) ? pack.options : [];
        setText(pack.text ?? '');
        setOptions([opts[0] ?? '', opts[1] ?? '', opts[2] ?? '', opts[3] ?? '']);
        setExplanation(pack.explanation ?? '');
        setCorrectIndex(question.correctIndex ?? 0);
        setDifficulty(question.difficulty ?? 'medium');
        setTagsInput((question.tags ?? []).join(', '));
        setImageUrl(question.imageUrl ?? null);
        setTimeLimitMs(question.timeLimitOverrideMs ?? null);
        setServedEver(Boolean(question.servedEver));
        if (question.topicIds?.length) setTopicId(question.topicIds[0]);
        if (pack.explanation || question.imageUrl || question.timeLimitOverrideMs) {
          setMoreOpen(true);
        }
      }
      setReady(true);
    } catch (err) {
      setError(err);
    }
  }, [spaceId, id]);

  useEffect(() => {
    load();
  }, [load]);

  const editText = (value) => {
    setText(value);
    if (fieldErrors.text) setFieldErrors((prev) => ({ ...prev, text: null }));
  };
  const editOption = (index, value) => {
    setOptions((prev) => prev.map((option, i) => (i === index ? value : option)));
    if (fieldErrors.options[index]) {
      setFieldErrors((prev) => ({
        ...prev,
        options: prev.options.map((msg, i) => (i === index ? null : msg)),
      }));
    }
  };
  const pickTopic = (value) => {
    setTopicId(value);
    if (fieldErrors.topic) setFieldErrors((prev) => ({ ...prev, topic: null }));
  };

  const validate = () => {
    const next = emptyErrors();
    const trimmedText = text.trim();
    if (!trimmedText) next.text = 'Write the question first.';
    else if (trimmedText.length > 200) next.text = 'Over 200 characters — trim it to save.';

    const trimmed = options.map((option) => option.trim());
    trimmed.forEach((option, i) => {
      if (!option) {
        next.options[i] = 'Every option needs text.';
        return;
      }
      if (option.length > 80) {
        next.options[i] = 'Keep it within 80 characters.';
        return;
      }
      if (UNTIMEABLE.some((pattern) => pattern.test(option))) {
        next.options[i] = 'These do not work under a timer.';
        return;
      }
      const twin = trimmed.findIndex(
        (other, j) => j < i && other.toLowerCase() === option.toLowerCase(),
      );
      if (twin !== -1) next.options[i] = `Same as option ${LETTERS[twin]}.`;
    });

    if (!topicId) next.topic = 'Pick a topic — every question lives in one.';
    return next;
  };

  /** The server names the field; put its message where the field is. */
  const applyServerProblems = (details) => {
    const next = emptyErrors();
    let mapped = false;
    let unmapped = false;
    for (const detail of details) {
      const optionPath = /^options\.(\d+)$/.exec(detail.field ?? '');
      if (optionPath && Number(optionPath[1]) < 4) {
        next.options[Number(optionPath[1])] = detail.problem;
        mapped = true;
      } else if (detail.field === 'topicIds') {
        next.topic = detail.problem;
        mapped = true;
      } else if (detail.field === 'text' || detail.field === 'tags' || detail.field === 'explanation') {
        next[detail.field] = detail.problem;
        mapped = true;
      } else {
        unmapped = true;
      }
    }
    if (mapped) setFieldErrors(next);
    return mapped && !unmapped;
  };

  const save = async (nextStatus, { allowDuplicate = false } = {}) => {
    const problems = validate();
    setFieldErrors(problems);
    if (problems.text || problems.topic || problems.options.some(Boolean)) return;

    setBusy(allowDuplicate ? 'dupe' : nextStatus);
    setError(null);
    try {
      const body = {
        spaceId,
        text: text.trim(),
        options: options.map((option) => option.trim()),
        correctIndex,
        difficulty,
        topicIds: [topicId],
        tags: tagsInput.split(',').map((tag) => tag.trim()).filter(Boolean),
        timeLimitOverrideMs: timeLimitMs,
        status: nextStatus,
      };
      const trimmedExplanation = explanation.trim();
      if (editing) {
        body.explanation = trimmedExplanation;
        body.imageUrl = imageUrl ?? null;
      } else {
        if (trimmedExplanation) body.explanation = trimmedExplanation;
        if (imageUrl) body.imageUrl = imageUrl;
      }
      if (allowDuplicate) body.allowDuplicate = true;

      const result = editing
        ? await api.patch(`/admin/questions/${id}`, body)
        : await api.post('/admin/questions', body);

      setDuplicates(null);
      if (result?.warnings?.length) setSavedWarnings(result.warnings);
      else goBack();
    } catch (err) {
      if (err.code === 'DUPLICATE_QUESTION') {
        setDuplicates(err.details?.duplicates ?? []);
      } else if (err.code === 'VALIDATION_FAILED' && Array.isArray(err.details)) {
        if (!applyServerProblems(err.details)) setError(err);
      } else {
        setError(err);
      }
    } finally {
      setBusy(null);
    }
  };

  const pickImage = async () => {
    setError(null);
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      setUploading(true);
      const asset = picked.assets[0];
      const stored = await api.upload('question', asset.uri, asset.mimeType ?? 'image/jpeg');
      setImageUrl(stored.url);
    } catch (err) {
      setError(err);
    } finally {
      setUploading(false);
    }
  };

  if (!spaceId) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header title="New question" onBack={goBack} />
        <EmptyState
          icon="alert"
          title="No organization to manage"
          body="This area appears when an organization has made you an admin."
        />
      </SafeAreaView>
    );
  }

  const textLength = text.length;
  const counterColor =
    textLength > 200 ? colors.wrong : textLength > 140 ? colors.optionC : colors.inkFaint;
  const primaryBusy = busy === 'published' || busy === 'in_review';

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header
        title={editing ? 'Edit question' : 'New question'}
        subtitle={
          servedEver
            ? 'Served in matches — edits affect future matches only.'
            : overrideSpaceId
              ? 'Public space'
              : adminSpace?.name
        }
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
            <View style={styles.labelRow}>
              <Text variant="label" color={colors.inkMuted} style={{ flex: 1 }}>
                Question
              </Text>
              <Text variant="meta" color={counterColor}>
                {textLength} / 140
              </Text>
            </View>
            <TextInput
              style={[styles.input, styles.multiline, focusedField === 'text' && styles.inputFocused]}
              value={text}
              onChangeText={editText}
              onFocus={() => setFocusedField('text')}
              onBlur={() => setFocusedField(null)}
              multiline
              placeholder="What does the second law of thermodynamics forbid?"
              placeholderTextColor={colors.inkFaint}
              accessibilityLabel="Question text"
            />
            <Text variant="meta" color={colors.inkFaint} style={styles.hint}>
              Beyond 140 characters it renders smaller. Beyond 200 it is rejected.
            </Text>
            <FieldError message={fieldErrors.text} />

            <View style={[styles.labelRow, styles.fieldLabel]}>
              <Text variant="label" color={colors.inkMuted} style={{ flex: 1 }}>
                Options
              </Text>
              <Text variant="meta" color={colors.inkFaint}>
                Tap a letter to mark the answer
              </Text>
            </View>
            {options.map((option, i) => {
              const selected = correctIndex === i;
              return (
                <View key={LETTERS[i]}>
                  <View style={styles.optionRow}>
                    <Pressable
                      onPress={() => setCorrectIndex(i)}
                      accessibilityRole="button"
                      accessibilityLabel={`Mark option ${LETTERS[i]} as the correct answer`}
                      accessibilityState={{ selected }}
                      hitSlop={6}
                      style={({ pressed }) => [styles.bubble, selected && styles.bubbleOn, pressed && { opacity: 0.7 }]}
                    >
                      {selected ? (
                        <Icon name="check" size={16} color={colors.onAccent} />
                      ) : (
                        <Text variant="label" color={colors.inkMuted}>
                          {LETTERS[i]}
                        </Text>
                      )}
                    </Pressable>
                    <TextInput
                      style={[
                        styles.input,
                        { flex: 1 },
                        focusedField === `option${i}` && styles.inputFocused,
                      ]}
                      value={option}
                      onChangeText={(value) => editOption(i, value)}
                      onFocus={() => setFocusedField(`option${i}`)}
                      onBlur={() => setFocusedField(null)}
                      maxLength={80}
                      placeholder={`Option ${LETTERS[i]}`}
                      placeholderTextColor={colors.inkFaint}
                      accessibilityLabel={`Option ${LETTERS[i]}`}
                    />
                  </View>
                  <FieldError message={fieldErrors.options[i]} style={styles.optionError} />
                </View>
              );
            })}

            <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
              Difficulty
            </Text>
            <Segmented options={DIFFICULTIES} value={difficulty} onChange={setDifficulty} />

            <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
              Topic
            </Text>
            <View style={styles.chips}>
              {(topics ?? []).map((topic) => (
                <Chip
                  key={topic.id}
                  label={topic.name}
                  active={topicId === topic.id}
                  onPress={() => pickTopic(topic.id)}
                />
              ))}
              {topics && topics.length === 0 ? (
                <Text variant="meta" color={colors.inkFaint}>
                  No topics yet. Create a topic first — every question lives in one.
                </Text>
              ) : null}
            </View>
            <FieldError message={fieldErrors.topic} />

            <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
              Tags
            </Text>
            <TextInput
              style={[styles.input, focusedField === 'tags' && styles.inputFocused]}
              value={tagsInput}
              onChangeText={setTagsInput}
              onFocus={() => setFocusedField('tags')}
              onBlur={() => setFocusedField(null)}
              autoCapitalize="none"
              placeholder="entropy, heat engines"
              placeholderTextColor={colors.inkFaint}
              accessibilityLabel="Tags, comma separated"
            />
            <Text variant="meta" color={colors.inkFaint} style={styles.hint}>
              Comma-separated. Tags power search and filters in the bank.
            </Text>
            <FieldError message={fieldErrors.tags} />

            <Pressable
              onPress={() => setMoreOpen((open) => !open)}
              accessibilityRole="button"
              accessibilityState={{ expanded: moreOpen }}
              style={({ pressed }) => [styles.moreHead, pressed && { opacity: 0.7 }]}
            >
              <Text variant="title" style={{ flex: 1 }}>
                More
              </Text>
              <Icon
                name={moreOpen ? 'chevronDown' : 'chevronRight'}
                size={18}
                color={colors.inkMuted}
              />
            </Pressable>

            {moreOpen ? (
              <>
                <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
                  Explanation
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    styles.multiline,
                    focusedField === 'explanation' && styles.inputFocused,
                  ]}
                  value={explanation}
                  onChangeText={setExplanation}
                  onFocus={() => setFocusedField('explanation')}
                  onBlur={() => setFocusedField(null)}
                  multiline
                  maxLength={600}
                  placeholder="Why the right answer is right."
                  placeholderTextColor={colors.inkFaint}
                  accessibilityLabel="Explanation"
                />
                <Text variant="meta" color={colors.inkFaint} style={styles.hint}>
                  Post-match review is where the learning actually happens.
                </Text>
                <FieldError message={fieldErrors.explanation} />

                <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
                  Picture
                </Text>
                {/**
                  * Two kinds of picture, and the editor has to speak both.
                  *
                  * A question's `imageUrl` is either an uploaded URL or a
                  * `mimo:art/<key>` wire value that the match screen DRAWS —
                  * the seeded picture questions all use the second kind. This
                  * block used to feed either straight into <Image uri>, so a
                  * seeded question showed a blank frame in the editor where a
                  * player saw art, and the only repair on offer replaced the
                  * drawn emblem with a photograph. Now the drawn set is a
                  * picker, and an upload is still an upload.
                  */}
                {imageUrl ? (
                  <>
                    {drawnArtKey ? (
                      <View style={styles.artPreview}>
                        <QuestionArt imageUrl={imageUrl} size={120} />
                      </View>
                    ) : (
                      <Image
                        source={{ uri: imageUrl }}
                        style={styles.imagePreview}
                        contentFit="cover"
                        transition={160}
                      />
                    )}
                    <View style={styles.imageActions}>
                      <Button
                        size="sm"
                        variant="soft"
                        label={drawnArtKey ? 'Change art' : 'Change image'}
                        fullWidth={false}
                        disabled={uploading}
                        onPress={() => setArtPicker(true)}
                      />
                      <Button
                        size="sm"
                        variant="soft"
                        label="Upload"
                        fullWidth={false}
                        loading={uploading}
                        onPress={pickImage}
                      />
                      <Button
                        size="sm"
                        variant="danger"
                        label="Remove"
                        fullWidth={false}
                        disabled={uploading}
                        onPress={() => setImageUrl(null)}
                      />
                    </View>
                  </>
                ) : (
                  <View style={styles.imageActions}>
                    <Button
                      size="sm"
                      variant="soft"
                      label="Choose art"
                      fullWidth={false}
                      disabled={uploading}
                      style={{ alignSelf: 'flex-start' }}
                      onPress={() => setArtPicker(true)}
                    />
                    <Button
                      size="sm"
                      variant="soft"
                      label="Upload a photo"
                      fullWidth={false}
                      loading={uploading}
                      onPress={pickImage}
                    />
                  </View>
                )}

                <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
                  Time limit
                </Text>
                <View style={styles.chips}>
                  {TIME_LIMITS.map((limit) => (
                    <Chip
                      key={String(limit.value)}
                      label={limit.label}
                      active={timeLimitMs === limit.value}
                      onPress={() => setTimeLimitMs(limit.value)}
                    />
                  ))}
                </View>
                <Text variant="meta" color={colors.inkFaint} style={styles.hint}>
                  Default follows the match format.
                </Text>
              </>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <ErrorNotice error={error} />
            <View style={styles.footerButtons}>
              <Button
                variant="soft"
                label="Save draft"
                style={{ flex: 1 }}
                loading={busy === 'draft'}
                disabled={Boolean(busy) && busy !== 'draft'}
                onPress={() => save('draft')}
              />
              <Button
                label={canPublish ? 'Publish' : 'Submit for review'}
                style={{ flex: 1 }}
                loading={primaryBusy}
                disabled={Boolean(busy) && !primaryBusy}
                onPress={() => save(canPublish ? 'published' : 'in_review')}
              />
            </View>
          </View>
        </>
      )}

      {/* The server found close matches; show them before saving anyway. */}
      <Modal
        visible={Boolean(duplicates)}
        transparent
        animationType="fade"
        onRequestClose={() => (busy ? null : setDuplicates(null))}
      >
        <Pressable
          style={({ pressed }) => [styles.sheetScrim, pressed && { opacity: 0.7 }]}
          onPress={busy ? undefined : () => setDuplicates(null)}
        >
          <Pressable style={[styles.sheet, elevation.sheet]} onPress={() => {}}>
            <View style={styles.sheetGrabber} />
            <Text variant="display" style={styles.sheetTitle}>
              This may be a duplicate
            </Text>
            <Text variant="body" color={colors.inkMuted} style={styles.sheetBody}>
              The bank already has questions close to this one.
            </Text>
            <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>
              {(duplicates ?? []).map((dupe) => {
                const badge = STATUS_BADGE[dupe.status] ?? { label: dupe.status, tone: 'ink' };
                return (
                  <View key={dupe.id} style={styles.dupeRow}>
                    <Text style={[type.option, styles.dupeText]} numberOfLines={2}>
                      {dupe.text}
                    </Text>
                    <Badge label={badge.label} tone={badge.tone} />
                  </View>
                );
              })}
            </ScrollView>
            <Button
              label="Save it anyway"
              loading={busy === 'dupe'}
              onPress={() => save('draft', { allowDuplicate: true })}
            />
            <Button
              variant="soft"
              label="Go back"
              disabled={Boolean(busy)}
              style={{ marginTop: space.md }}
              onPress={() => setDuplicates(null)}
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Saved, but the server left notes — show them before leaving. */}
      <Modal
        visible={Boolean(savedWarnings)}
        transparent
        animationType="fade"
        onRequestClose={goBack}
      >
        <Pressable style={({ pressed }) => [styles.sheetScrim, pressed && { opacity: 0.7 }]} onPress={goBack}>
          <Pressable style={[styles.sheet, elevation.sheet]} onPress={() => {}}>
            <View style={styles.sheetGrabber} />
            <Text variant="display" style={styles.sheetTitle}>
              Saved, with notes
            </Text>
            {(savedWarnings ?? []).map((warning, i) => (
              <View key={i} style={styles.warningRow}>
                <Icon name="alert" size={15} color={colors.optionC} />
                <Text variant="body" color={colors.ink} style={{ flex: 1 }}>
                  {warning.problem}
                </Text>
              </View>
            ))}
            <Button label="Done" style={{ marginTop: space.lg }} onPress={goBack} />
          </Pressable>
        </Pressable>
      </Modal>

      {/* The drawn set, which is what the seeded picture questions use and
          what the match screen can render without a network round trip. */}
      <Modal
        visible={artPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setArtPicker(false)}
      >
        <Pressable style={styles.sheetScrim} onPress={() => setArtPicker(false)}>
          <Pressable style={[styles.sheet, elevation.sheet]} onPress={() => {}}>
            <View style={styles.sheetGrabber} />
            <Text variant="display" style={styles.sheetTitle}>
              Choose art
            </Text>
            <Text variant="meta" color={colors.inkMuted} style={styles.artNote}>
              Drawn in the app, so it loads instantly and works offline.
            </Text>
            <ScrollView contentContainerStyle={styles.artGrid} showsVerticalScrollIndicator={false}>
              {ART_KEYS.map((key) => (
                <Pressable
                  key={key}
                  onPress={() => {
                    setImageUrl(artUri(key));
                    setArtPicker(false);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={key}
                  accessibilityState={{ selected: drawnArtKey === key }}
                  style={({ pressed }) => [
                    styles.artCell,
                    drawnArtKey === key && styles.artCellActive,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <QuestionArt imageUrl={artUri(key)} size={64} />
                </Pressable>
              ))}
            </ScrollView>
            <Button
              variant="soft"
              label="Close"
              style={{ marginTop: space.md }}
              onPress={() => setArtPicker(false)}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function FieldError({ message, style }) {
  if (!message) return null;
  return (
    <Text variant="meta" color={colors.wrong} style={[styles.hint, style]}>
      {message}
    </Text>
  );
}

/** The form's own shape, so nothing jumps when the question lands. */
function FormSkeleton() {
  return (
    <View style={styles.skeleton}>
      <Skeleton width={72} height={12} radius={6} />
      <Skeleton width="100%" height={108} radius={layout.radiusInput} />
      <Skeleton width={64} height={12} radius={6} style={{ marginTop: space.lg }} />
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
          <Skeleton width={38} height={38} radius={13} />
          <Skeleton width="82%" height={54} radius={layout.radiusInput} />
        </View>
      ))}
      <Skeleton width="100%" height={48} radius={layout.radiusPill} style={{ marginTop: space.lg }} />
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
        <Skeleton width={96} height={38} radius={19} />
        <Skeleton width={76} height={38} radius={19} />
        <Skeleton width={120} height={38} radius={19} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: consoleLayout.gutter, paddingBottom: space.xl },
  labelRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, marginBottom: space.sm },
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
  multiline: {
    height: 'auto',
    minHeight: 96,
    paddingVertical: space.md,
    textAlignVertical: 'top',
  },
  inputFocused: { borderColor: colors.accent, backgroundColor: colors.canvas },
  hint: { marginTop: space.sm },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.sm },
  optionError: { marginTop: 0, marginBottom: space.sm, marginLeft: 38 + space.md },
  bubble: {
    width: 38,
    height: 38,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  moreHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: layout.touchMin,
    marginTop: space.xl,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingTop: space.lg,
  },
  artPreview: { alignItems: 'center', paddingVertical: space.sm },
  artNote: { textAlign: 'center', marginBottom: space.sm },
  artGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    justifyContent: 'center',
    paddingVertical: space.sm,
  },
  artCell: {
    padding: space.xs,
    borderRadius: layout.radiusCard,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  artCellActive: { borderColor: colors.accent },
  imagePreview: {
    aspectRatio: 16 / 9,
    borderRadius: layout.radiusInput,
    backgroundColor: colors.sunken,
  },
  imageActions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  footer: { padding: consoleLayout.gutter, paddingTop: space.sm },
  footerButtons: { flexDirection: 'row', gap: space.md },
  skeleton: { paddingHorizontal: consoleLayout.gutter, paddingTop: space.lg, gap: space.sm },
  sheetScrim: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.canvas,
    borderTopLeftRadius: layout.radiusCard + 8,
    borderTopRightRadius: layout.radiusCard + 8,
    padding: consoleLayout.gutter,
    paddingBottom: space.xxxl,
  },
  sheetGrabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.hairline,
    alignSelf: 'center',
    marginBottom: space.lg,
  },
  sheetTitle: { marginBottom: space.sm },
  sheetBody: { marginBottom: space.md },
  sheetScroll: { flexGrow: 0, maxHeight: 260, marginBottom: space.lg },
  dupeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  dupeText: { flex: 1, color: colors.ink },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    backgroundColor: colors.amberSoft,
    borderRadius: layout.radiusInput,
    padding: space.md,
    marginBottom: space.sm,
  },
});
