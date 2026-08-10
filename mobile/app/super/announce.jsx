import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import {
  Text,
  Button,
  ConfirmSheet,
  ErrorNotice,
  Header,
  Select,
  ConsoleFooter,
} from '../../src/components/ui.jsx';
import { colors, consoleLayout, layout, space } from '../../src/theme/console.js';

/**
 * prd.md F9.4.5 — the platform announcement.
 *
 * The endpoint has been complete for a long time — segment filter, per-user
 * `notify`, its own rate limit — and there was no way to reach it from
 * anywhere, because the console's dock had five slots and this was not one of
 * them. It writes a notification to every matching account, so it is one of
 * the few things in the product that cannot be taken back: the confirmation
 * names the audience and the count before anything is sent.
 */
const SEGMENTS = [
  { value: 'all', label: 'Everyone' },
  { value: 'active_7d', label: 'Active' },
  { value: 'inactive_7d', label: 'Lapsed' },
];

const SEGMENT_COPY = {
  all: 'Every active account on the platform.',
  active_7d: 'Accounts that have played in the last seven days.',
  inactive_7d: 'Accounts that have not played in the last seven days.',
};

export default function SuperAnnounce() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [segment, setSegment] = useState('all');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  const [error, setError] = useState(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post('/super/announce', {
        title: title.trim(),
        body: body.trim() || undefined,
        segment,
      });
      setSent(result?.sent ?? 0);
      setTitle('');
      setBody('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={[]}>
      <Header title="Announcement" subtitle="Every account you choose" />

      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ErrorNotice error={error} />

        {sent != null ? (
          <View style={styles.sentNote}>
            <Text variant="label" color={colors.correct}>
              Sent to {sent} {sent === 1 ? 'account' : 'accounts'}.
            </Text>
            <Text variant="meta" color={colors.inkMuted}>
              It is in their notifications now.
            </Text>
          </View>
        ) : null}

        {/**
         * A `Select`, like every other "choose one" in the console.
         *
         * This was a pill track while the same choice on Users was a tab bar,
         * so two screens in the same console asked the same kind of question
         * in two different shapes. Audience is also the one field here that
         * cannot be taken back once Send is pressed, and a Select states the
         * current answer in words rather than as a lit segment.
         */}
        <Select
          label="Who"
          value={segment}
          options={SEGMENTS.map((s) => ({ ...s, meta: SEGMENT_COPY[s.value] }))}
          onChange={setSegment}
          style={styles.field}
        />
        <Text variant="meta" color={colors.inkFaint} style={styles.hint}>
          {SEGMENT_COPY[segment]}
        </Text>

        <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
          Title
        </Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Scheduled maintenance on Sunday"
          placeholderTextColor={colors.inkFaint}
          maxLength={80}
          accessibilityLabel="Announcement title"
        />

        <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
          Body
        </Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={body}
          onChangeText={setBody}
          placeholder="Optional. One or two sentences."
          placeholderTextColor={colors.inkFaint}
          maxLength={200}
          multiline
          accessibilityLabel="Announcement body"
        />

        <Text variant="meta" color={colors.inkFaint} style={styles.hint}>
          Five announcements an hour. There is no way to unsend one.
        </Text>
      </ScrollView>

      {/* In the footer, like every other primary in both consoles. It was the
          last thing inside the scroll view, so on a filled-in form it sat below
          the fold with the keyboard over it. */}
      <ConsoleFooter>
        <Button
          label="Send announcement"
          disabled={!title.trim()}
          onPress={() => setConfirm(true)}
        />
      </ConsoleFooter>

      <ConfirmSheet
        visible={confirm}
        icon="megaphone"
        title="Send this to everybody?"
        body={`${SEGMENT_COPY[segment]} They each get a notification, and it cannot be taken back.`}
        confirmLabel="Send it"
        loading={busy}
        onConfirm={send}
        onCancel={() => setConfirm(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  content: { paddingHorizontal: consoleLayout.gutter , paddingBottom: space.xl},
  fieldLabel: { marginTop: space.lg, marginBottom: space.xs },
  field: { marginTop: space.lg },
  hint: { marginTop: space.xs },
  sentNote: {
    backgroundColor: colors.correctSoft,
    borderRadius: layout.radiusCard,
    padding: space.lg,
    marginTop: space.md,
    gap: 2,
  },
  input: {
    backgroundColor: colors.control,
    borderRadius: layout.radiusInput,
    borderWidth: 1,
    borderColor: colors.hairline,
    color: colors.ink,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: 15,
  },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
});
