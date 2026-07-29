import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useConsoleBack } from '../../src/lib/consoleBack.js';
import { useAdminSpace } from '../../src/lib/admin.js';
import { Text, Button, Chip, ErrorNotice, Header } from '../../src/components/ui.jsx';
import { colors, consoleLayout, layout, space, type } from '../../src/theme/index.js';

/**
 * prd.md F8.5.1 — scheduling a contest, sized for a phone: a name, a topic,
 * and two decisions made of chips. Full calendar control lives in the web
 * portal; on the move an admin schedules "tonight" or "tomorrow", not the
 * 14th at 16:45, so the chips carry the cases that actually happen.
 */
const START_PRESETS = [
  { key: 'hour', label: 'In 1 hour', at: () => new Date(Date.now() + 60 * 60 * 1000) },
  { key: 'tonight', label: 'Tonight 8pm', at: () => atHour(20) },
  { key: 'tomorrow', label: 'Tomorrow 9am', at: () => atHour(9, 1) },
];
const DURATIONS = [
  { key: '2h', label: '2 hours', ms: 2 * 3600_000 },
  { key: '6h', label: '6 hours', ms: 6 * 3600_000 },
  { key: '24h', label: '24 hours', ms: 24 * 3600_000 },
];
const SIZES = [7, 14, 21];

function atHour(hour, plusDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + plusDays);
  d.setHours(hour, 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d;
}

export default function AdminContestNew() {
  const goBack = useConsoleBack();
  const adminSpace = useAdminSpace();

  const [name, setName] = useState('');
  const [topics, setTopics] = useState(null);
  const [topicId, setTopicId] = useState(null);
  const [start, setStart] = useState('hour');
  const [duration, setDuration] = useState('6h');
  const [size, setSize] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [focused, setFocused] = useState(false);

  const loadTopics = useCallback(async () => {
    if (!adminSpace) return;
    try {
      const data = await api.get('/admin/topics', { spaceId: adminSpace.id });
      const live = (data.items ?? []).filter((t) => t.readiness?.isLive);
      setTopics(live);
      if (live.length === 1) setTopicId(live[0].id);
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
      const startsAt = START_PRESETS.find((p) => p.key === start).at();
      const endsAt = new Date(startsAt.getTime() + DURATIONS.find((d) => d.key === duration).ms);
      await api.post('/admin/contests', {
        spaceId: adminSpace.id,
        name: name.trim(),
        topicIds: [topicId],
        questionCount: size,
        selectionMode: 'auto',
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        publish: true,
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
      <Header title="Schedule a contest" subtitle={adminSpace?.name} onBack={goBack} />

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
          style={[styles.input, focused && styles.inputFocused]}
          value={name}
          onChangeText={setName}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          maxLength={80}
          placeholder="Friday Physics Sprint"
          placeholderTextColor={colors.inkFaint}
          accessibilityLabel="Contest name"
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
          Questions
        </Text>
        <View style={styles.chips}>
          {SIZES.map((n) => (
            <Chip key={n} label={`${n}`} active={size === n} onPress={() => setSize(n)} />
          ))}
        </View>

        <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
          Opens
        </Text>
        <View style={styles.chips}>
          {START_PRESETS.map((preset) => (
            <Chip
              key={preset.key}
              label={preset.label}
              active={start === preset.key}
              onPress={() => setStart(preset.key)}
            />
          ))}
        </View>

        <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
          Stays open for
        </Text>
        <View style={styles.chips}>
          {DURATIONS.map((d) => (
            <Chip key={d.key} label={d.label} active={duration === d.key} onPress={() => setDuration(d.key)} />
          ))}
        </View>

        <Text variant="meta" color={colors.inkFaint} style={styles.note}>
          Every student answers the same paper, one attempt each. The paper locks when the
          contest opens.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <ErrorNotice error={error} />
        <Button
          label="Schedule contest"
          loading={busy}
          disabled={name.trim().length < 2 || !topicId}
          onPress={create}
        />
      </View>
    </SafeAreaView>
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
  note: { marginTop: space.xl },
  footer: { padding: consoleLayout.gutter, paddingTop: space.sm },
});
