import { useCallback, useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { api, BASE_URL, getAccessToken } from '../../src/lib/api.js';
import { useConsoleBack } from '../../src/lib/consoleBack.js';
import { useAdminSpace, useAdminPermissions } from '../../src/lib/admin.js';
import {
  Text,
  Badge,
  Button,
  Card,
  Select,
  ErrorNotice,
  Header,
  ConsoleFooter,
} from '../../src/components/ui.jsx';
import Icon from '../../src/components/Icon.jsx';
import { colors, consoleLayout, layout, space, type } from '../../src/theme/index.js';

/**
 * Bulk question import, sized for a phone. Three stages in one screen: get a
 * CSV (picked or pasted), review what the server made of every row, then
 * commit the rows worth keeping. The server validates twice — once to build
 * the review, once again on commit — so nothing here can smuggle a bad row
 * past it; the screen's job is to make the verdicts legible and reversible
 * before anything is written.
 */
const LETTERS = ['A', 'B', 'C', 'D'];
const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

/**
 * A sample that is a real file, not a header line.
 *
 * The screen used to carry one example row, folded inside a collapsed "What
 * the file needs" panel, reachable only by "Share a template" — so the fastest
 * way to find out what this screen wanted was to guess, upload, and read the
 * errors. Three rows, because three rows is what shows the things one row
 * cannot: that `correct` takes a letter OR a number, that the optional columns
 * can be left empty, and that `tags` splits on a semicolon.
 */
const TEMPLATE =
  'question,option_a,option_b,option_c,option_d,correct,difficulty,topic,tags,explanation\n' +
  'What is the SI unit of force?,Newton,Joule,Watt,Pascal,a,easy,Physics,units;mechanics,Force is mass times acceleration.\n' +
  'Which planet is closest to the Sun?,Venus,Mercury,Mars,Earth,2,easy,Astronomy,,\n' +
  'Who wrote "Pride and Prejudice"?,Charlotte Brontë,Jane Austen,George Eliot,Emily Brontë,b,medium,Literature,novels;19th-century,Published in 1813.';

export default function AdminImport() {
  const goBack = useConsoleBack();
  const adminSpace = useAdminSpace();
  const { canPublish } = useAdminPermissions(adminSpace);

  // 'pick' → 'review' → 'done'
  const [stage, setStage] = useState('pick');
  const [error, setError] = useState(null);

  // Stage 1 — the file.
  const [file, setFile] = useState(null); // { uri, name }
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const [pasteFocused, setPasteFocused] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [topics, setTopics] = useState(null);
  const [topicId, setTopicId] = useState(null);
  const [checking, setChecking] = useState(false);

  // Stage 2 — the server's verdicts, plus what the admin did with them.
  const [report, setReport] = useState(null);
  const [rowState, setRowState] = useState({}); // row → { included, text, edited }
  const [publishNow, setPublishNow] = useState(false);
  const [importing, setImporting] = useState(false);

  // Stage 3 — what the commit came back with.
  const [result, setResult] = useState(null);

  const loadTopics = useCallback(async () => {
    if (!adminSpace) return;
    try {
      const data = await api.get('/admin/topics', { spaceId: adminSpace.id });
      setTopics(data.items ?? []);
    } catch {
      // The chips are optional; the import works without them.
      setTopics([]);
    }
  }, [adminSpace]);

  useEffect(() => {
    loadTopics();
  }, [loadTopics]);

  const pickFile = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.length) return;
      setError(null);
      setFile({ uri: picked.assets[0].uri, name: picked.assets[0].name ?? 'questions.csv' });
    } catch {
      setError(new Error('The file could not be opened. Try picking it again.'));
    }
  };

  /**
   * The validate endpoint speaks multipart, and api.js only speaks JSON, so
   * this goes through fetch directly — spaceId in the query string, the
   * default-topic field appended BEFORE the file part because the server only
   * reads fields it has seen by the time the file streams in.
   */
  const runValidate = async (uri) => {
    const form = new FormData();
    if (topicId) form.append('topicId', topicId);
    form.append('file', { uri, name: 'questions.csv', type: 'text/csv' });

    let res;
    try {
      res = await fetch(
        `${BASE_URL}/api/v1/admin/questions/import/validate?spaceId=${encodeURIComponent(adminSpace.id)}`,
        {
          method: 'POST',
          headers: { accept: 'application/json', authorization: `Bearer ${getAccessToken()}` },
          body: form,
        },
      );
    } catch {
      throw new Error('Lost connection. Reconnecting.');
    }

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = json?.error ?? {};
      if (err.code === 'BAD_CSV_HEADER' && err.details?.missing?.length) {
        throw new Error(
          `The header row is missing ${err.details.missing.join(', ')}. It has ${
            err.details.found?.length ? err.details.found.join(', ') : 'no recognised columns'
          }.`,
        );
      }
      throw new Error(err.message ?? 'The file could not be checked. Try again.');
    }
    return json.data;
  };

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      let uri = file?.uri;
      if (pasteOpen) {
        uri = `${FileSystem.cacheDirectory}mimo-import.csv`;
        await FileSystem.writeAsStringAsync(uri, pasted);
      }
      const data = await runValidate(uri);
      setReport(data);
      // Invalid rows start excluded — including one is a decision, not a default.
      setRowState(
        Object.fromEntries(
          (data.rows ?? []).map((r) => [
            r.row,
            { included: r.valid, text: r.data?.text ?? '', edited: false },
          ]),
        ),
      );
      setPublishNow(false);
      setStage('review');
    } catch (err) {
      setError(err);
    } finally {
      setChecking(false);
    }
  };

  const startOver = () => {
    setStage('pick');
    setReport(null);
    setRowState({});
    setResult(null);
    setError(null);
  };

  const editRow = (n, text) =>
    setRowState((cur) => ({ ...cur, [n]: { ...cur[n], text, edited: true } }));
  const toggleRow = (n, included) =>
    setRowState((cur) => ({ ...cur, [n]: { ...cur[n], included } }));

  const commit = async () => {
    setImporting(true);
    setError(null);
    try {
      // The rows go back verbatim; an edit only replaces data.text. The
      // server re-validates every one of them before anything is written.
      const rows = (report?.rows ?? [])
        .filter((r) => rowState[r.row]?.included)
        .map((r) =>
          rowState[r.row].edited
            ? { ...r, data: { ...r.data, text: rowState[r.row].text.trim() } }
            : r,
        );
      const data = await api.post('/admin/questions/import/commit', {
        spaceId: adminSpace.id,
        /**
         * Not published means IN REVIEW, which is what this screen has always
         * told the admin ("they wait in the review queue") — while committing
         * them as plain drafts, which that queue does not list. An admin
         * imported a bank, opened Review, and was told the queue was clear.
         */
        status: publishNow && canPublish ? 'published' : 'in_review',
        rows,
      });
      setResult(data);
      setStage('done');
    } catch (err) {
      setError(err);
    } finally {
      setImporting(false);
    }
  };

  const rows = report?.rows ?? [];
  const includedCount = rows.filter((r) => rowState[r.row]?.included).length;
  const blockedCount = rows.filter(
    (r) => rowState[r.row]?.included && !r.valid && !rowState[r.row]?.edited,
  ).length;
  const hasSource = pasteOpen ? pasted.trim().length > 0 : Boolean(file);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Import questions" subtitle={adminSpace?.name} />

      <ErrorNotice error={error} />

      {stage === 'pick' ? (
        <>
          <ScrollView
        automaticallyAdjustKeyboardInsets
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text variant="body" color={colors.inkMuted}>
              Bring questions in from a spreadsheet. Export it as CSV and pick the file, or paste
              the rows straight in.
            </Text>

            {pasteOpen ? (
              <TextInput
                style={[styles.pasteInput, pasteFocused && styles.inputFocused]}
                value={pasted}
                onChangeText={setPasted}
                onFocus={() => setPasteFocused(true)}
                onBlur={() => setPasteFocused(false)}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={'question,option_a,option_b,option_c,option_d,correct\n...'}
                placeholderTextColor={colors.inkFaint}
                accessibilityLabel="Pasted CSV rows"
              />
            ) : (
              <>
                <Button label="Pick a CSV file" onPress={pickFile} style={styles.pickButton} />
                {file ? (
                  <View style={styles.fileRow}>
                    <Icon name="check" size={16} color={colors.correct} />
                    <Text numberOfLines={1} style={styles.fileName}>
                      {file.name}
                    </Text>
                    <Pressable
                      onPress={() => setFile(null)}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel="Remove the picked file"
                     style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}>
                      <Icon name="close" size={16} color={colors.inkFaint} />
                    </Pressable>
                  </View>
                ) : null}
              </>
            )}

            <Button
              variant="ghost"
              size="md"
              label={pasteOpen ? 'Use a file instead' : 'Paste it instead'}
              onPress={() => setPasteOpen((v) => !v)}
              style={{ marginTop: space.sm }}
            />

            {topics && topics.length > 0 ? (
              <>
                {/* A Select, not a wrap of chips: an organization with thirty
                    topics turned this field into a wall of pills taller than
                    the form it belonged to. */}
                <Select
                  label="Default topic"
                  value={topicId}
                  options={[
                    { value: null, label: 'None — every row must name its own' },
                    ...topics.map((topic) => ({ value: topic.id, label: topic.name })),
                  ]}
                  onChange={setTopicId}
                  placeholder="None"
                  style={styles.field}
                />
                <Text variant="meta" color={colors.inkFaint} style={{ marginTop: space.sm }}>
                  Used for rows that leave the topic column blank.
                </Text>
              </>
            ) : null}

            {/**
             * The sample, up front and usable.
             *
             * "Share a template" inside a collapsed panel meant the only way
             * to learn what this screen wanted was to guess, upload, and read
             * the errors. Loading the sample straight into the box turns that
             * into: press, see three valid rows, press Check, watch it work —
             * and then replace them with your own.
             */}
            <Card flat style={styles.sampleCard}>
              <Text variant="label">Not sure of the format?</Text>
              <Text variant="meta" color={colors.inkFaint} style={{ marginTop: space.xs }}>
                Three example rows with every column filled in. Load them to see a valid file, or
                send yourself the CSV and edit it in a spreadsheet.
              </Text>
              <View style={styles.sampleActions}>
                <Button
                  variant="soft"
                  size="sm"
                  label="Load the sample"
                  fullWidth={false}
                  onPress={() => {
                    setFile(null);
                    setPasteOpen(true);
                    setPasted(TEMPLATE);
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  icon="share"
                  label="Send me the CSV"
                  fullWidth={false}
                  onPress={() => Share.share({ message: TEMPLATE }).catch(() => {})}
                />
              </View>
            </Card>

            <Card flat style={styles.columnsCard}>
              <Pressable
                style={({ pressed }) => [styles.columnsHead, pressed && { opacity: 0.7 }]}
                onPress={() => setColumnsOpen((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: columnsOpen }}
              >
                <Text variant="label" style={{ flex: 1 }}>
                  Every column, in full
                </Text>
                <Icon
                  name={columnsOpen ? 'chevronDown' : 'chevronRight'}
                  size={16}
                  color={colors.inkFaint}
                />
              </Pressable>
              {columnsOpen ? (
                <>
                  <Text variant="meta" color={colors.inkFaint} style={styles.columnsLabel}>
                    Required columns
                  </Text>
                  <Text style={styles.mono}>
                    question{'\n'}option_a option_b option_c option_d{'\n'}correct (a-d or 1-4)
                  </Text>
                  <Text variant="meta" color={colors.inkFaint} style={styles.columnsLabel}>
                    Optional columns
                  </Text>
                  <Text style={styles.mono}>
                    difficulty (easy | medium | hard){'\n'}topic (name){'\n'}tags (split on ; , |)
                    {'\n'}explanation
                  </Text>
                </>
              ) : null}
            </Card>
          </ScrollView>

          <ConsoleFooter>
            <Button
              label="Check the file"
              loading={checking}
              disabled={!hasSource}
              onPress={check}
            />
          </ConsoleFooter>
        </>
      ) : stage === 'review' ? (
        <>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.summary}>
              <Text variant="label" color={colors.inkMuted}>
                {report.totalRows} {report.totalRows === 1 ? 'row' : 'rows'}
              </Text>
              <Badge label={`${report.validRows} valid`} tone="live" />
              {report.invalidRows > 0 ? (
                <Badge label={`${report.invalidRows} with errors`} tone="danger" />
              ) : null}
              {report.duplicateRows > 0 ? (
                <Badge
                  label={`${report.duplicateRows} possible ${
                    report.duplicateRows === 1 ? 'duplicate' : 'duplicates'
                  }`}
                  style={{ backgroundColor: colors.optionC }}
                />
              ) : null}
            </View>

            {rows.map((row) => {
              const state = rowState[row.row] ?? {};
              return (
                <Card key={row.row} style={styles.rowCard}>
                  <View style={styles.rowHead}>
                    <Text style={styles.rowNumber}>Row {row.row}</Text>
                    <Switch
                      value={Boolean(state.included)}
                      onValueChange={(on) => toggleRow(row.row, on)}
                      trackColor={{ false: colors.hairline, true: colors.accent }}
                      thumbColor={colors.onColor}
                      ios_backgroundColor={colors.hairline}
                      accessibilityLabel={`Include row ${row.row}`}
                    />
                  </View>

                  <View style={{ opacity: state.included ? 1 : 0.55 }}>
                    <TextInput
                      style={styles.questionInput}
                      value={state.text}
                      onChangeText={(text) => editRow(row.row, text)}
                      multiline
                      accessibilityLabel={`Question text for row ${row.row}`}
                    />
                    <Text variant="meta" color={colors.inkMuted} style={styles.metaLine}>
                      {(row.data?.options ?? []).join(' · ')}
                    </Text>
                    <Text variant="meta" color={colors.inkFaint} style={styles.metaLine}>
                      Correct {LETTERS[row.data?.correctIndex] ?? '—'}
                      {'  ·  '}
                      {row.data?.difficulty ?? '—'}
                      {'  ·  '}
                      {row.data?.topicName || '—'}
                    </Text>

                    {(row.errors ?? []).map((e, i) => (
                      <Text key={i} variant="meta" color={colors.wrong} style={styles.problemLine}>
                        {e.field}: {e.problem}
                      </Text>
                    ))}
                    {row.duplicateOf?.existing ? (
                      <Text variant="meta" color={colors.optionC} style={styles.problemLine}>
                        Similar to a question already in this topic.
                      </Text>
                    ) : row.duplicateOf?.inFile ? (
                      <Text variant="meta" color={colors.optionC} style={styles.problemLine}>
                        Repeats row {row.duplicateOf.inFile} of this file.
                      </Text>
                    ) : null}
                    {state.edited ? (
                      <Text variant="meta" color={colors.accent} style={styles.problemLine}>
                        Edited — checked again on import.
                      </Text>
                    ) : null}
                  </View>
                </Card>
              );
            })}

            <Button
              variant="soft"
              size="md"
              label="Choose another file"
              onPress={startOver}
              style={{ marginTop: space.md }}
            />
          </ScrollView>

          <ConsoleFooter>
            {canPublish ? (
              <View style={styles.publishRow}>
                <Text variant="label" style={{ flex: 1 }}>
                  Publish immediately instead of saving as drafts
                </Text>
                <Switch
                  value={publishNow}
                  onValueChange={setPublishNow}
                  trackColor={{ false: colors.hairline, true: colors.accent }}
                  thumbColor={colors.onColor}
                  ios_backgroundColor={colors.hairline}
                  accessibilityLabel="Publish immediately instead of saving as drafts"
                />
              </View>
            ) : null}
            {blockedCount > 0 ? (
              <Text variant="label" color={colors.wrong} style={styles.footerNote}>
                {blockedCount === 1
                  ? '1 row still has errors — fix or exclude it'
                  : `${blockedCount} rows still have errors — fix or exclude them`}
              </Text>
            ) : includedCount === 0 ? (
              <Text variant="label" color={colors.inkFaint} style={styles.footerNote}>
                Nothing selected
              </Text>
            ) : (
              <Button
                label={`Import ${includedCount} ${includedCount === 1 ? 'question' : 'questions'}`}
                loading={importing}
                onPress={commit}
              />
            )}
          </ConsoleFooter>
        </>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Card style={styles.resultCard}>
            <View style={styles.resultIcon}>
              <Icon name="check" size={26} color={colors.correct} />
            </View>
            <Text variant="title" style={{ textAlign: 'center' }}>
              Imported {result?.imported ?? 0}.
            </Text>
            <Text
              variant="body"
              color={colors.inkMuted}
              style={{ textAlign: 'center', marginTop: space.xs }}
            >
              {publishNow && canPublish
                ? 'They are published and can come up in play now.'
                : 'They are saved as drafts and wait in the review queue.'}
            </Text>

            {result?.rejected?.length ? (
              <View style={styles.rejectedBlock}>
                <Text variant="label" color={colors.wrong}>
                  {result.rejected.length === 1
                    ? '1 row was turned away'
                    : `${result.rejected.length} rows were turned away`}
                </Text>
                {result.rejected.map((r) => (
                  <View key={r.row} style={{ marginTop: space.sm }}>
                    <Text style={styles.rowNumber}>Row {r.row}</Text>
                    {(r.errors ?? []).map((e, i) => (
                      <Text key={i} variant="meta" color={colors.wrong}>
                        {e.field}: {e.problem}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            ) : null}
          </Card>

          <Button label="Done" onPress={goBack} style={{ marginTop: space.xl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  // The header now closes with a hairline, so content needs a gap under it —
  // without one the first paragraph reads as part of the header bar.
  content: {
    paddingHorizontal: consoleLayout.gutter,
    paddingTop: space.lg,
    paddingBottom: space.xl,
  },
  field: { marginTop: space.xl },
  sampleCard: { marginTop: space.xl, gap: 0 },
  sampleActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },

  pickButton: { marginTop: space.xl },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusInput,
    paddingHorizontal: space.lg,
    minHeight: 48,
    marginTop: space.md,
  },
  fileName: { fontFamily: MONO, fontSize: 13, color: colors.ink, flex: 1 },
  pasteInput: {
    fontFamily: MONO,
    fontSize: 13,
    lineHeight: 19,
    color: colors.ink,
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusInput,
    borderWidth: 1.5,
    borderColor: colors.transparent,
    padding: space.lg,
    minHeight: 170,
    textAlignVertical: 'top',
    marginTop: space.xl,
  },
  inputFocused: { borderColor: colors.accent, backgroundColor: colors.nightRaised },

  columnsCard: { marginTop: space.xl },
  columnsHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 32 },
  columnsLabel: { marginTop: space.lg, marginBottom: space.xs },
  mono: { fontFamily: MONO, fontSize: 12, lineHeight: 18, color: colors.inkMuted },

  summary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
  },
  rowCard: { marginTop: layout.cardGap },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  rowNumber: { fontFamily: MONO, fontSize: 12, color: colors.inkFaint },
  questionInput: {
    ...type.option,
    color: colors.ink,
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusInput,
    padding: space.md,
    marginTop: space.sm,
    textAlignVertical: 'top',
  },
  metaLine: { marginTop: space.sm },
  problemLine: { marginTop: space.xs },
  publishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 44,
    marginBottom: space.md,
  },
  footerNote: { textAlign: 'center', paddingVertical: space.lg },

  resultCard: { marginTop: space.sm, alignItems: 'center' },
  resultIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.correctSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  rejectedBlock: { alignSelf: 'stretch', marginTop: space.xl },
});
