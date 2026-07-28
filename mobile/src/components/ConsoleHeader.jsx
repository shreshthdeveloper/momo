import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useAuth } from '../state/auth.jsx';
import { useAdminSpace } from '../lib/admin.js';
import { signOutCopy } from '../lib/account.js';
import { Text, Avatar, ConfirmSheet, Header } from './ui.jsx';
import Icon from './Icon.jsx';
import { colors, elevation, layout, space } from '../theme/index.js';

/**
 * The header every console screen wears.
 *
 * Sign-out used to be a text link in the header of each console's HOME tab and
 * nowhere else, which made it hard to find from four of the five screens and
 * easy to mistake for a section title on the one that had it. Worse, neither
 * console said whose session it was — an operator with a player account and a
 * superadmin account had no way to tell which one they were holding.
 *
 * So the account becomes what it is everywhere else in software: a face in the
 * corner. Tapping it says who you are and what this console is, and offers the
 * one action that belongs to an account rather than to a screen.
 *
 * @param {object} props
 * @param {string} props.title
 * @param {string} [props.subtitle]
 * @param {Function} [props.onBack]
 * @param {React.ReactNode} [props.right]  screen-specific action, left of the face
 */
export default function ConsoleHeader({ title, subtitle, onBack, right }) {
  const { user, signOut } = useAuth();
  const adminSpace = useAdminSpace();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const isSuper = user?.role === 'superadmin';
  const role = isSuper
    ? 'Platform superadmin'
    : adminSpace
      ? `Admin · ${adminSpace.name}`
      : 'Signed in';
  const copy = signOutCopy(false);

  return (
    <>
      <Header
        title={title}
        subtitle={subtitle}
        onBack={onBack}
        right={
          <View style={styles.rightRow}>
            {right}
            <Pressable
              onPress={() => setOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Account — ${user?.displayName ?? 'signed in'}`}
              hitSlop={8}
              style={({ pressed }) => [styles.face, pressed && { opacity: 0.7 }]}
            >
              <Avatar url={user?.avatarUrl} name={user?.displayName} size={32} />
            </Pressable>
          </View>
        }
      />

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close">
          {/* The sheet swallows taps so pressing inside it does not dismiss. */}
          <Pressable style={[styles.sheet, elevation.raised]} onPress={() => {}}>
            <View style={styles.identity}>
              <Avatar url={user?.avatarUrl} name={user?.displayName} size={48} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="title" numberOfLines={1}>
                  {user?.displayName ?? 'Signed in'}
                </Text>
                <Text variant="meta" color={colors.inkMuted} numberOfLines={1}>
                  {role}
                </Text>
                {user?.phone ? (
                  <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
                    {user.phone}
                  </Text>
                ) : null}
              </View>
            </View>

            <Pressable
              onPress={() => {
                setOpen(false);
                setConfirming(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Sign out"
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}
            >
              <Icon name="logout" size={18} color={colors.wrong} />
              <Text variant="label" color={colors.wrong} style={{ flex: 1 }}>
                Sign out
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <ConfirmSheet
        visible={confirming}
        icon="user"
        title={copy.title}
        body={copy.body}
        confirmLabel={copy.confirmLabel}
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          await signOut();
        }}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  rightRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  face: {
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    padding: 1,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(10,10,20,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.canvas,
    borderTopLeftRadius: layout.radiusCard,
    borderTopRightRadius: layout.radiusCard,
    padding: layout.gutter,
    paddingBottom: space.xxl,
    gap: space.lg,
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 52,
    paddingHorizontal: space.md,
    borderRadius: layout.radiusInput,
    backgroundColor: colors.sunken,
  },
});
