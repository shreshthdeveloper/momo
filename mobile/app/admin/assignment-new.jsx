import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useConsoleBack } from '../../src/lib/consoleBack.js';
import { useAdminSpace } from '../../src/lib/admin.js';
import { ConsoleFooter, Text, Button, Chip, ErrorNotice, Header } from '../../src/components/ui.jsx';
import { colors, consoleLayout, layout, space, type } from '../../src/theme/index.js';

/**
 * prd.md F8.5.5 — setting work: a title, a topic, what counts as done, and
 * when it is due. Requirements are the three the product supports — play N
 * matches, hit an accuracy bar, or reach a mastery level.
 */
const REQUIREMENTS = [
  { key: 'matches3', label: '3 matches', requirement: { type: 'matches', matches: 3 } },
  { key: 'matches5', label: '5 matches', requirement: { type: 'matches', matches: 5 } },
  { key: 'accuracy70', label: '2 at 70%+', requirement: { type: 'accuracy', matches: 2, minAccuracy: 70 } },
  { key: 'level3', label: 'Reach level 3', requirement: { type: 'mastery', level: 3 } },
];
const DUE = [
  { key: '1d', label: 'Tomorrow 8pm', days: 1 },
  { key: '3d', label: 'In 3 days', days: 3 },
  { key: '7d', label: 'In a week', days: 7 },
];

export default function AdminAssignmentNew() {
  const goBack = useConsoleBack();
  const adminSpace = useAdminSpace();

  const [title, setTitle] = useState('');
  const [topics, setTopics] = useState(null);
  const [topicId, setTopicId] = useState(null);
  const [requirement, setRequirement] = useState('matches3');
  const [due, setDue] = useState('3d');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [focused, setFocused] = useState(false);

  const loadTopics = useCallback(async () => {
    if (!adminSpace) return;
    try {
      const data = await api.get('/admin/topics', { spaceId: adminSpace.id });
      const usable = (data.items ?? []).filter((t) => t.readiness?.isLive);
      setTopics(usable);
      if (usable.length === 1) setTopicId(usable[0].id);
    } catch (err) {
      setError(err);
    }
  }, [adminSpace]);

  useEffect(() => {
    loadTopics();
  }, [loadTopics]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + DUE.find((d) => d.key === due).days);
      dueDate.setHours(20, 0, 0, 0);
      await api.post('/admin/assignments', {
        spaceId: adminSpace.id,
        title: title.trim(),
        topicId,
        dueAt: dueDate.toISOString(),
        requirement: REQUIREMENTS.find((r) => r.key === requirement).requirement,
      });
      goBack();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Set an assignment" subtitle={adminSpace?.name} onBack={goBack} />

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
          Title
        </Text>
        <TextInput
          style={[styles.input, focused && styles.inputFocused]}
          value={title}
          onChangeText={setTitle}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          maxLength={80}
          placeholder="Mechanics practice"
          placeholderTextColor={colors.inkFaint}
          accessibilityLabel="Assignment title"
        />

        <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
          Topic
        </Text>
        <View style={styles.chips}>
          {(topics ?? []).map((topic) => (
            <Chip
              key={topic.id}
              label={topic.name}
              active={topicId === topic.id}
              onPress={() => setTopicId(topic.id)}
            />
          ))}
          {topics && topics.length === 0 ? (
            <Text variant="meta" color={colors.inkFaint}>
              No topic is live yet — a topic needs 21 published questions first.
            </Text>
          ) : null}
        </View>

        <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
          Counts as done
        </Text>
        <View style={styles.chips}>
          {REQUIREMENTS.map((option) => (
            <Chip
              key={option.key}
              label={option.label}
              active={requirement === option.key}
              onPress={() => setRequirement(option.key)}
            />
          ))}
        </View>

        <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
          Due
        </Text>
        <View style={styles.chips}>
          {DUE.map((option) => (
            <Chip key={option.key} label={option.label} active={due === option.key} onPress={() => setDue(option.key)} />
          ))}
        </View>

        <Text variant="meta" color={colors.inkFaint} style={styles.note}>
          Progress counts automatically as students play. They see it on their home screen the
          moment you set it.
        </Text>
      </ScrollView>

      <ConsoleFooter>
        <ErrorNotice error={error} />
        <Button
          label="Set assignment"
          loading={busy}
          disabled={title.trim().length < 2 || !topicId}
          onPress={create}
        />
      </ConsoleFooter>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  content: { paddingHorizontal: consoleLayout.gutter, paddingBottom: space.xl },
  fieldLabel: { marginTop: space.xl, marginBottom: space.sm },
  input: {
    ...type.option,
    color: colors.ink,
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusInput,
    borderWidth: 1.5,
    borderColor: colors.transparent,
    paddingHorizontal: space.lg,
    height: 54,
  },
  inputFocused: { borderColor: colors.accent, backgroundColor: colors.nightRaised },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  note: { marginTop: space.xl },
});
