import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api } from '../lib/api.js';
import { Text, Sheet, Avatar } from './ui.jsx';
import Icon from './Icon.jsx';
import { tap, success, failure } from '../lib/haptics.js';
import { colors, layout, space } from '../theme/index.js';
import { FRIEND_REACTIONS } from '../shared/constants.js';

/**
 * The whole of what one player can say to another.
 *
 * prd.md excludes in-app chat from v1 and the reasoning holds — see the note on
 * `FRIEND_REACTIONS` in constants.js. Six taps is what shipped instead: enough
 * to acknowledge a match or ask for another, and short of anything that needs a
 * moderation queue behind it. There is deliberately no text input on this
 * screen and no way to reach one.
 *
 * ── It closes itself, and only on success ────────────────────────────────────
 *
 * A send is one tap and the sheet has nothing else to offer afterwards, so it
 * confirms and leaves. A failure keeps it open with the reason on it, because
 * the two things that can go wrong — the one-a-minute cooldown, and no network
 * — are both things the sender would otherwise have to guess at from a sheet
 * that simply vanished.
 */
export default function ReactionSheet({ visible, person, onClose }) {
  const [busy, setBusy] = useState(null);
  const [sent, setSent] = useState(null);
  const [error, setError] = useState(null);
  /** The self-close, cancelled if the sheet goes away before it fires. */
  const closeTimer = useRef(null);

  // A fresh sheet every time. Without this, re-opening on the same person shows
  // the tick from last time for a frame before the state settles.
  useEffect(() => {
    if (visible) {
      setBusy(null);
      setSent(null);
      setError(null);
    }
  }, [visible, person?.id]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const send = useCallback(
    async (reaction) => {
      if (busy || sent) return;
      setBusy(reaction.key);
      setError(null);
      tap();
      try {
        await api.post(`/friends/${person.id}/react`, { key: reaction.key });
        success();
        setSent(reaction.key);
        clearTimeout(closeTimer.current);
        closeTimer.current = setTimeout(onClose, 850);
      } catch (err) {
        failure();
        setError(err);
      } finally {
        setBusy(null);
      }
    },
    [busy, sent, person?.id, onClose],
  );

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      accessibilityLabel={`Send a reaction to ${person?.displayName ?? 'your friend'}`}
    >
      <View style={styles.head}>
        <Avatar url={person?.avatarUrl} name={person?.displayName} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="title" numberOfLines={1}>
            {person?.displayName ?? 'Your friend'}
          </Text>
          <Text variant="meta" color={colors.inkFaint}>
            {sent ? 'Sent.' : 'Send them one of these.'}
          </Text>
        </View>
      </View>

      <View style={styles.grid}>
        {FRIEND_REACTIONS.map((reaction) => {
          const isSent = sent === reaction.key;
          // Everything dims once one is on its way, so a second tap during the
          // round trip cannot queue a send the cooldown would then refuse.
          const off = (busy !== null || sent !== null) && !isSent;
          return (
            <Pressable
              key={reaction.key}
              onPress={() => send(reaction)}
              disabled={busy !== null || sent !== null}
              accessibilityRole="button"
              accessibilityLabel={reaction.label}
              accessibilityState={{ disabled: off }}
              style={({ pressed }) => [
                styles.tile,
                isSent && styles.tileSent,
                off && styles.tileOff,
                pressed && !off && styles.tilePressed,
              ]}
            >
              <Icon
                name={isSent ? 'check' : reaction.icon}
                size={22}
                color={isSent ? colors.correct : colors.gold}
              />
              <Text
                variant="label"
                color={isSent ? colors.correct : colors.ink}
                numberOfLines={1}
              >
                {reaction.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {error ? (
        <View style={styles.error}>
          <Icon name="alert" size={15} color={colors.wrong} />
          <Text variant="meta" color={colors.wrong} style={{ flex: 1 }}>
            {error.message ?? 'That did not send. Try again.'}
          </Text>
        </View>
      ) : (
        /* Said up front rather than discovered by hitting it. A limit you are
           told about is a rule; one you only meet as an error is a bug. */
        <Text variant="tiny" color={colors.inkFaint} style={styles.footnote}>
          One a minute, so nobody gets buried.
        </Text>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingBottom: space.lg,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    // Three across on a 360dp screen, two on nothing narrower than a watch.
    flexBasis: '31%',
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 76,
    paddingHorizontal: space.sm,
    borderRadius: layout.radiusInput,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.sunken,
  },
  tilePressed: { backgroundColor: colors.nightRaised, transform: [{ scale: 0.97 }] },
  tileSent: { backgroundColor: colors.correctSoft, borderColor: 'rgba(58, 178, 122, 0.34)' },
  /** Material's disabled band — visibly off without disappearing. */
  tileOff: { opacity: 0.4 },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
    padding: space.md,
    borderRadius: layout.radiusInput,
    backgroundColor: colors.wrongSoft,
  },
  footnote: { textAlign: 'center', marginTop: space.md },
});
