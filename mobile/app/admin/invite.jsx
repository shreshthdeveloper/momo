import { useCallback, useEffect, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useConsoleBack } from '../../src/lib/consoleBack.js';
import { useAdminSpace } from '../../src/lib/admin.js';
import { Text, Button, ConfirmSheet, ErrorNotice, Header, Loading } from '../../src/components/ui.jsx';
import { colors, consoleLayout, elevation, layout, space, type } from '../../src/theme/index.js';

/**
 * prd.md F8.4.1 — the join code, big enough to read off a phone held up at
 * the front of a classroom, which is how these actually get distributed.
 * Rotation kills the old code instantly, so it goes through a confirm.
 */
export default function AdminInvite() {
  const goBack = useConsoleBack();
  const adminSpace = useAdminSpace();
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotating, setRotating] = useState(false);

  const load = useCallback(async () => {
    if (!adminSpace) return;
    try {
      setError(null);
      setInvite(await api.get('/admin/invite', { spaceId: adminSpace.id }));
    } catch (err) {
      setError(err);
    }
  }, [adminSpace]);

  useEffect(() => {
    load();
  }, [load]);

  const rotate = async () => {
    setRotating(true);
    try {
      setError(null);
      const data = await api.post('/admin/invite/rotate', { spaceId: adminSpace.id });
      setInvite((current) => ({ ...current, joinCode: data.joinCode }));
    } catch (err) {
      setError(err);
    } finally {
      setRotating(false);
      setConfirmRotate(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Invite code" subtitle={adminSpace?.name} onBack={goBack} />

      <ErrorNotice error={error} onRetry={load} />

      {!invite && !error ? (
        <Loading />
      ) : invite ? (
        <View style={styles.body}>
          <View style={[styles.codeCard, elevation.raised]}>
            <Text variant="meta" color={colors.inkFaint}>
              Students join with
            </Text>
            <Text allowFontScaling={false} style={styles.code}>
              {invite.joinCode}
            </Text>
            <Text variant="meta" color={colors.inkFaint}>
              {invite.joinMode === 'approval'
                ? 'You approve each student before they get in.'
                : 'Students get in immediately.'}
            </Text>
          </View>

          <Button
            label="Share the code"
            icon="share"
            onPress={() =>
              Share.share({
                message: `Join ${adminSpace.name} on Mimo with code ${invite.joinCode}. ${invite.link ?? ''}`.trim(),
              }).catch(() => {})
            }
          />
          <Button
            variant="danger"
            size="md"
            label="Rotate the code"
            style={{ marginTop: space.md }}
            onPress={() => setConfirmRotate(true)}
          />
          <Text variant="meta" color={colors.inkFaint} style={styles.note}>
            Rotating kills the old code the moment the new one exists. Anyone still holding the
            old one cannot join with it.
          </Text>
        </View>
      ) : null}

      <ConfirmSheet
        visible={confirmRotate}
        destructive
        icon="share"
        title="Rotate the join code?"
        body="The current code stops working immediately. Posters and messages carrying it go stale."
        confirmLabel="Rotate code"
        loading={rotating}
        onConfirm={rotate}
        onCancel={() => setConfirmRotate(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  body: { padding: consoleLayout.gutter },
  codeCard: {
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: space.xxl,
    marginBottom: space.xl,
  },
  code: {
    ...type.scoreHero,
    fontSize: 44,
    lineHeight: 54,
    color: colors.accent,
    letterSpacing: 10,
    includeFontPadding: false,
  },
  note: { textAlign: 'center', marginTop: space.md },
});
