import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { api, BASE_URL, getAccessToken } from '../../src/lib/api.js';
import { useConsoleBack } from '../../src/lib/consoleBack.js';
import { useConsoleSpace } from '../../src/lib/admin.js';
import { useExport, csvName } from '../../src/lib/download.js';
import {
  Text,
  Badge,
  Button,
  Card,
  EmptyState,
  Select,
  ErrorNotice,
  Header,
  ConsoleFooter,
  Steps,
  Tabs,
  useScrollBottom,
} from '../../src/components/ui.jsx';
import { CardsSkeleton } from '../../src/components/Skeletons.jsx';
import Icon from '../../src/components/Icon.jsx';
import { colors, consoleLayout, layout, space, type } from '../../src/theme/console.js';

/**
 * Bulk question import, sized for a phone.
 *
 * ── Why this screen was rebuilt ─────────────────────────────────────────────
 *
 * The old one asked for the file first and the topic last, as a field called
 * "Default topic" whose first option read "None — every row must name its own"
 * and which only appeared at all if the space already had topics. The server
 * requires a topic for every row: it takes the row's own `topic` column when
 * there is one, falls back to the default when the column is blank, and
 * REJECTS the row when there is neither.
 *
 * So the ordinary case — a spreadsheet of questions with no topic column,
 * which is what a spreadsheet of questions looks like — went: pick file, press
 * Check, and get every single row back invalid with "This row has no topic".
 * The screen was working exactly as built and it read as broken, because the
 * one decision that made the difference was optional-looking, below the fold,
 * and phrased as if leaving it alone was fine.
 *
 * Now the destination comes FIRST and cannot be skipped. Naming the topics in
 * the file is still supported — it is just an explicit choice in the same
 * control rather than the silent default that fails.
 *
 * ── The three stages ────────────────────────────────────────────────────────
 *
 *   1. Set up   where the questions go, and where they come from
 *   2. Check    the server's verdict on every row, filterable to the problems
 *   3. Done     what was written, and what was turned away
 *
 * The server validates twice — once to build the review, once again on commit
 * — so nothing here can smuggle a bad row past it; the screen's job is to make
 * the verdicts legible and reversible before anything is written.
 *
 * Mounted at `/admin/import` for an organization's bank and at `/super/import`
 * for the Central Bank. See `useConsoleSpace`.
 */
const LETTERS = ['A', 'B', 'C', 'D'];
const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

const STAGES = ['Set up', 'Check', 'Done'];

/**
 * The destination option meaning "the file says". A sentinel rather than
 * `null`, because null is "not chosen yet" and the difference between those
 * two is the entire bug this screen had.
 */
const FILE_TOPICS = '__file__';

/**
 * A sample that is a real file, not a header line.
 *
 * Three rows, because three rows show the things one row cannot: that
 * `correct` takes a letter OR a number, that the optional columns can be left
 * empty, and that `tags` splits on a semicolon.
 *
 * No `topic` column, deliberately — that is what a real export looks like, and
 * the destination above the picker is what gives these rows a home.
 */
const TEMPLATE =
  'question,option_a,option_b,option_c,option_d,correct,difficulty,tags,explanation\n' +
  'What is the SI unit of force?,Newton,Joule,Watt,Pascal,a,easy,units;mechanics,Force is mass times acceleration.\n' +
  'Which planet is closest to the Sun?,Venus,Mercury,Mars,Earth,2,easy,,\n' +
  'Who wrote "Pride and Prejudice"?,Charlotte Brontë,Jane Austen,George Eliot,Emily Brontë,b,medium,novels;19th-century,Published in 1813.';

export default function AdminImport() {
  const goBack = useConsoleBack();
  const scrollBottom = useScrollBottom();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { spaceId, spaceName, inTenant, canPublish, href } = useConsoleSpace();
  const { exporting, error: exportError, run: runExport } = useExport();

  // 'setup' → 'check' → 'done'
  const [stage, setStage] = useState('setup');
  const [error, setError] = useState(null);

  // ── Stage 1: where they go, and where they come from. ────────────────────
  /**
   * Arriving from a topic's own row means the destination is already decided —
   * "import questions HERE" is the whole reason that door exists, so the
   * screen must not then ask the question again.
   */
  const pushedFromTopic = typeof params.topicId === 'string' && params.topicId.length > 0;
  const [topicId, setTopicId] = useState(() => (pushedFromTopic ? params.topicId : null));
  const [topics, setTopics] = useState(null);
  const [file, setFile] = useState(null); // { uri, name }
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const [pasteFocused, setPasteFocused] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [checking, setChecking] = useState(false);

  // ── Stage 2: the server's verdicts, plus what the admin did with them. ───
  const [report, setReport] = useState(null);
  const [rowState, setRowState] = useState({}); // row → { included, text, edited }
  const [filter, setFilter] = useState('all');
  const [publishNow, setPublishNow] = useState(false);
  const [importing, setImporting] = useState(false);

  // ── Stage 3: what the commit came back with. ─────────────────────────────
  const [result, setResult] = useState(null);

  const loadTopics = useCallback(async () => {
    if (!spaceId) return;
    try {
      const data = await api.get('/admin/topics', { spaceId });
      // Archived topics are not a destination — importing into one writes
      // questions nobody can reach.
      const usable = (data.items ?? []).filter((t) => t.status !== 'archived');
      setTopics(usable);
      // A topicId handed in by a link to a topic that has since been archived
      // (or belongs to another space) would leave the Select showing its
      // placeholder while the screen believed a destination was chosen. Make
      // the person pick again rather than import somewhere invisible.
      setTopicId((current) => (current && !usable.some((t) => t.id === current) ? null : current));
    } catch {
      setTopics([]);
    }
  }, [spaceId]);

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
   * destination field appended BEFORE the file part because the server only
   * reads fields it has seen by the time the file streams in.
   */
  const runValidate = async (uri) => {
    const form = new FormData();
    if (topicId && topicId !== FILE_TOPICS) form.append('topicId', topicId);
    form.append('file', { uri, name: 'questions.csv', type: 'text/csv' });

    let res;
    try {
      res = await fetch(
        `${BASE_URL}/api/v1/admin/questions/import/validate?spaceId=${encodeURIComponent(spaceId)}`,
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
      // Land on whatever needs attention. A clean file opens on everything,
      // because there is nothing to hunt for.
      setFilter(data.invalidRows > 0 ? 'problems' : 'all');
      setStage('check');
    } catch (err) {
      setError(err);
    } finally {
      setChecking(false);
    }
  };

  /** Back to the picker, keeping the destination — the next file usually shares it. */
  const startOver = () => {
    setStage('setup');
    setReport(null);
    setRowState({});
    setResult(null);
    setError(null);
    setFile(null);
    setPasted('');
    setPasteOpen(false);
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
        spaceId,
        /**
         * Not published means IN REVIEW, which is what this screen has always
         * told the admin ("they wait in the review queue") — while committing
         * them as plain drafts, which that queue does not list.
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
  const problem = (r) => !r.valid || Boolean(r.duplicateOf);
  const includedCount = rows.filter((r) => rowState[r.row]?.included).length;
  const blockedCount = rows.filter(
    (r) => rowState[r.row]?.included && !r.valid && !rowState[r.row]?.edited,
  ).length;
  const shownRows =
    filter === 'problems' ? rows.filter(problem) : filter === 'ready' ? rows.filter((r) => !problem(r)) : rows;

  const hasSource = pasteOpen ? pasted.trim().length > 0 : Boolean(file);
  const destination = topics?.find((t) => t.id === topicId) ?? null;
  const stageIndex = stage === 'setup' ? 0 : stage === 'check' ? 1 : 2;

  if (!spaceId) {
    return (
      <SafeAreaView style={styles.screen} edges={[]}>
        <Header title="Import questions" />
        <EmptyState
          tone="content"
          icon="alert"
          title="No organization to manage"
          body="This console appears when an organization has made you an admin."
        />
      </SafeAreaView>
    );
  }

  /**
   * A space with no topics cannot receive an import at all — every row would
   * be rejected for having nowhere to go. Saying so here, with the way out, is
   * the difference between a dead end and a next step; the old screen let you
   * upload a file first and only then produced a wall of identical errors.
   */
  if (topics && topics.length === 0) {
    return (
      <SafeAreaView style={styles.screen} edges={[]}>
        <Header title="Import questions" subtitle={spaceName} />
        <EmptyState
          tone="content"
          icon="book"
          title="Make a topic first"
          body="Imported questions have to land in a topic. Create one and the import can fill it."
          actionLabel="New topic"
          onAction={() => router.push(href('topic-edit'))}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={[]}>
      <Header
        title="Import questions"
        subtitle={destination ? `into ${destination.name}` : spaceName}
        /**
         * This screen is both a sidebar row and a pushed screen now, so it
         * wears whichever corner it arrived by — the rule in `ConsoleShell` is
         * about how you GOT here, not about which screen it is. Reached from a
         * topic's own menu there is somewhere to go back to, and going back is
         * what you want after filling that topic.
         */
        onBack={pushedFromTopic || inTenant ? goBack : undefined}
      />

      <Steps steps={STAGES} current={stageIndex} />

      <ErrorNotice error={error} />
      <ErrorNotice error={exportError} />

      {/* ── 1. Where they go, then where they come from. ─────────────────── */}
      {stage === 'setup' ? (
        !topics ? (
          <CardsSkeleton count={2} lines={3} bar={false} />
        ) : (
          <>
            <ScrollView
              /* A form, not a list — and a dense one whose fields run to the
                 bottom of the screen, so the keyboard must not cover them. */
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/**
               * The destination, first and required.
               *
               * "My file names its own topic" is the escape hatch for a
               * multi-topic export, and it is a CHOICE rather than the
               * default — the whole failure mode this screen had was a
               * default that quietly rejected every row.
               */}
              <Select
                label="Where do these questions go?"
                value={topicId}
                options={[
                  ...topics.map((topic) => ({
                    value: topic.id,
                    label: topic.name,
                    meta: `${topic.readiness?.published ?? 0} published`,
                  })),
                  {
                    value: FILE_TOPICS,
                    label: 'My file names its own topic',
                    meta: 'Needs a topic column on every row',
                  },
                ]}
                onChange={setTopicId}
                placeholder="Choose a topic"
              />
              <Text variant="meta" color={colors.inkFaint} style={styles.hint}>
                {topicId === FILE_TOPICS
                  ? 'Every row must carry a topic column naming a topic that already exists here.'
                  : topicId
                    ? 'Rows that name a different topic in the file go there instead.'
                    : 'Every question has to land somewhere. Pick the topic before the file.'}
              </Text>

              <Text variant="label" color={colors.inkMuted} style={styles.sectionLabel}>
                The file
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
                  <Button variant="soft" label="Pick a CSV file" icon="download" onPress={pickFile} />
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
                        style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
                      >
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

              {/**
               * The sample, up front and usable: press, see three valid
               * rows, press Check, watch it work — and then replace them
               * with your own.
               */}
              <Card flat style={styles.sampleCard}>
                <Text variant="label">Not sure of the format?</Text>
                <Text variant="meta" color={colors.inkFaint} style={{ marginTop: space.xs }}>
                  Three example rows with every column filled in. Load them to see a valid file,
                  or send yourself the CSV and edit it in a spreadsheet.
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
                  accessibilityLabel="Every column, in full"
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
                      difficulty (easy | medium | hard){'\n'}tags (split on ; , |){'\n'}
                      explanation
                    </Text>
                    <Text variant="meta" color={colors.inkFaint} style={styles.columnsLabel}>
                      topic
                    </Text>
                    <Text variant="meta" color={colors.inkMuted}>
                      {topicId === FILE_TOPICS
                        ? 'Required, since you chose to let the file decide. It must match a topic name here exactly.'
                        : 'Optional. A row that names a topic goes there; a row that leaves it blank goes to the topic chosen above.'}
                    </Text>
                  </>
                ) : null}
              </Card>
            </ScrollView>

            <ConsoleFooter>
              {/**
               * The footer keeps its button and says what is missing above it.
               *
               * A bare disabled Check was the first version of this and it went
               * quiet on the person using it — greyed out, no reason. Replacing
               * it with the reason ALONE swapped one problem for another: the
               * footer became a floating grey sentence where every other screen
               * in the console has an action, so it read as a bar that had
               * failed to load. Both, then: the reason in a helper line, and the
               * button still standing under it, honestly disabled.
               */}
              {!topicId || !hasSource ? (
                <>
                  <Text variant="meta" color={colors.inkFaint} style={styles.footerReason}>
                    {!topicId
                      ? 'Choose where the questions go'
                      : pasteOpen
                        ? 'Paste your rows above'
                        : 'Pick a CSV file above'}
                  </Text>
                  <Button label="Check the file" disabled />
                </>
              ) : (
                <Button label="Check the file" loading={checking} onPress={check} />
              )}
            </ConsoleFooter>
          </>
        )
      ) : stage === 'check' ? (
        /**
         * ── 2. The verdicts. ────────────────────────────────────────────────
         *
         * Virtualized, and filterable. A 400-row import with 30 bad rows was
         * the case this screen was worst at: every row was a full card, valid
         * and invalid interleaved, so finding the thirty meant scrolling all
         * four hundred — after mounting all four hundred at once.
         */
        <>
          <FlatList
            data={shownRows}
            keyExtractor={(row) => String(row.row)}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
            initialNumToRender={8}
            windowSize={7}
            ListHeaderComponent={
              <>
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
                      tone="amber"
                    />
                  ) : null}
                </View>

                {rows.some(problem) ? (
                  <Tabs
                    style={styles.filterTabs}
                    value={filter}
                    onChange={setFilter}
                    options={[
                      { value: 'problems', label: `Problems ${rows.filter(problem).length}` },
                      { value: 'ready', label: `Ready ${rows.filter((r) => !problem(r)).length}` },
                      { value: 'all', label: `All ${rows.length}` },
                    ]}
                  />
                ) : null}

                {/**
                 * The broken loop, closed: the server has built exactly the
                 * right artefact for fixing a file in a spreadsheet since
                 * F8.2.5 (row, question, field, problem — one line per
                 * problem) and nothing could ask for it.
                 *
                 * It POSTS the validation report rather than fetching: the
                 * rows it describes are in the client's hand, never saved, so
                 * there is nothing for a GET to name.
                 */}
                {report.invalidRows > 0 ? (
                  <Button
                    variant="soft"
                    size="sm"
                    fullWidth={false}
                    label={
                      exporting ? 'Building the list…' : `Send me the ${report.invalidRows} problems`
                    }
                    disabled={exporting}
                    style={styles.errorExport}
                    onPress={() =>
                      runExport('/admin/questions/import/errors.csv', {
                        query: { spaceId },
                        filename: csvName(spaceName, 'import-errors'),
                        body: report,
                      })
                    }
                  />
                ) : null}
              </>
            }
            renderItem={({ item: row }) => (
              <RowCard
                row={row}
                state={rowState[row.row] ?? {}}
                onToggle={toggleRow}
                onEdit={editRow}
              />
            )}
            ListEmptyComponent={
              <EmptyState
                tone="content"
                icon="check"
                title={filter === 'problems' ? 'Nothing to fix' : 'Nothing here'}
                body={
                  filter === 'problems'
                    ? 'Every row in this file passed. Import them below.'
                    : 'No rows in this view.'
                }
              />
            }
            ListFooterComponent={
              <Button
                variant="soft"
                size="md"
                label="Choose another file"
                onPress={startOver}
                style={{ marginTop: space.lg }}
              />
            }
          />

          <ConsoleFooter>
            {canPublish ? (
              <View style={styles.publishRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="label">Publish straight away</Text>
                  <Text variant="meta" color={colors.inkFaint}>
                    {publishNow
                      ? 'They can come up in play immediately.'
                      : 'Otherwise they wait in the review queue.'}
                  </Text>
                </View>
                <Switch
                  value={publishNow}
                  onValueChange={setPublishNow}
                  trackColor={{ false: colors.hairline, true: colors.accent }}
                  thumbColor={colors.onColor}
                  ios_backgroundColor={colors.hairline}
                  accessibilityLabel="Publish straight away instead of sending to the review queue"
                />
              </View>
            ) : null}
            {blockedCount > 0 ? (
              <>
                <Text variant="meta" color={colors.wrong} style={styles.footerReason}>
                  {blockedCount === 1
                    ? '1 row still has errors — fix or exclude it'
                    : `${blockedCount} rows still have errors — fix or exclude them`}
                </Text>
                <Button label="Import" disabled />
              </>
            ) : includedCount === 0 ? (
              <>
                <Text variant="meta" color={colors.inkFaint} style={styles.footerReason}>
                  Nothing selected
                </Text>
                <Button label="Import" disabled />
              </>
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
        /* ── 3. What was written. ──────────────────────────────────────────── */
        <FlatList
          data={result?.rejected ?? []}
          keyExtractor={(r) => String(r.row)}
          /* The only stage with no ConsoleFooter under it, so this is the one
             that owes the navigation bar its height. */
          contentContainerStyle={[styles.content, { paddingBottom: scrollBottom }]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
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
                  ? `They are published${destination ? ` in ${destination.name}` : ''} and can come up in play now.`
                  : 'They wait in the review queue until someone publishes them.'}
              </Text>
              {result?.rejected?.length ? (
                <Text variant="label" color={colors.wrong} style={styles.rejectedHead}>
                  {result.rejected.length === 1
                    ? '1 row was turned away'
                    : `${result.rejected.length} rows were turned away`}
                </Text>
              ) : null}
            </Card>
          }
          renderItem={({ item }) => (
            <View style={styles.rejectedRow}>
              <Text style={styles.rowNumber}>Row {item.row}</Text>
              {(item.errors ?? []).map((e, i) => (
                <Text key={i} variant="meta" color={colors.wrong}>
                  {e.field}: {e.problem}
                </Text>
              ))}
            </View>
          )}
          ListFooterComponent={
            <View style={styles.doneActions}>
              {/**
               * Where the questions actually WENT is the next screen.
               *
               * Unpublished rows are sitting in the review queue and this
               * screen was the only thing that knew it — "Done" put the
               * operator back at the sidebar to work out where a hundred
               * questions had gone. Published ones went into the bank, filtered
               * to the topic they landed in.
               */}
              {(result?.imported ?? 0) > 0 ? (
                publishNow && canPublish ? (
                  <Button
                    label="See them in the bank"
                    onPress={() =>
                      router.push(
                        href(
                          'questions',
                          destination ? { topicId: destination.id, status: 'published' } : { status: 'published' },
                        ),
                      )
                    }
                  />
                ) : (
                  <Button
                    label={`Review the ${result.imported} waiting`}
                    onPress={() => router.push(href('review'))}
                  />
                )
              ) : null}
              {/* Importing a bank is rarely one file, so the way back to the
                  picker is a real button rather than a return trip through the
                  sidebar. The destination is kept. */}
              <Button variant="soft" label="Import another file" onPress={startOver} />
              <Button variant="ghost" label="Done" onPress={goBack} />
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

/**
 * One row's verdict. The question text is editable in place — most invalid
 * rows are invalid for something the text itself fixes — and the switch is
 * whether it goes in at all.
 */
function RowCard({ row, state, onToggle, onEdit }) {
  const bad = !row.valid;
  return (
    <Card style={[styles.rowCard, bad && styles.rowCardBad]}>
      <View style={styles.rowHead}>
        <Text style={styles.rowNumber}>Row {row.row}</Text>
        {bad ? <Badge label="Has errors" tone="danger" /> : null}
        {row.duplicateOf ? <Badge label="Duplicate" tone="amber" /> : null}
        <View style={{ flex: 1 }} />
        <Switch
          value={Boolean(state.included)}
          onValueChange={(on) => onToggle(row.row, on)}
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
          onChangeText={(text) => onEdit(row.row, text)}
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
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  content: {
    paddingHorizontal: consoleLayout.gutter,
    paddingTop: space.md,
    paddingBottom: space.xl,
  },
  hint: { marginTop: space.sm },
  sectionLabel: { marginTop: space.xl, marginBottom: space.sm },
  sampleCard: { marginTop: space.xl, gap: 0 },
  sampleActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },

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
  },
  inputFocused: { borderColor: colors.accent, backgroundColor: colors.nightRaised },

  columnsCard: { marginTop: space.lg },
  columnsHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 32 },
  columnsLabel: { marginTop: space.lg, marginBottom: space.xs },
  mono: { fontFamily: MONO, fontSize: 12, lineHeight: 18, color: colors.inkMuted },

  summary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
    paddingBottom: space.sm,
  },
  filterTabs: { marginBottom: space.sm },
  rowCard: { marginTop: layout.cardGap },
  // A bad row is findable at a glance in a scroll of cards, not only by
  // reading the red line at the bottom of each one.
  rowCardBad: { borderColor: colors.wrong, borderWidth: 1 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowNumber: { fontFamily: MONO, fontSize: 12, color: colors.inkFaint },
  questionInput: {
    ...type.option,
    color: colors.ink,
    // An inset INSIDE a card, so it takes `canvas` — the console's inset
    // tone — not the card fill it is sitting on. Filled with `nightRaised`
    // it was the card's own colour and had no edge at all, which paper only
    // makes more obvious: a white box on a white card.
    backgroundColor: colors.control,
    borderRadius: layout.radiusInput,
    padding: space.md,
    marginTop: space.sm,
    textAlignVertical: 'top',
  },
  metaLine: { marginTop: space.sm },
  problemLine: { marginTop: space.xs },
  errorExport: { marginBottom: space.sm, alignSelf: 'flex-start' },
  publishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 44,
    marginBottom: space.md,
  },
  /** Why the button under it is disabled. See the setup footer. */
  footerReason: { textAlign: 'center', paddingBottom: space.sm },

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
  rejectedHead: { alignSelf: 'stretch', marginTop: space.xl },
  rejectedRow: { marginTop: space.md },
  doneActions: { gap: space.md, marginTop: space.xl },
});
