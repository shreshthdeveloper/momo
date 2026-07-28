import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from './ui.jsx';
import { useAuth } from '../state/auth.jsx';
import { coins as fmtCoins } from '../lib/rarity.js';
import { colors, fonts, layout, space } from '../theme/index.js';

/**
 * The balance, in a header, on every screen that has one.
 *
 * It reads from the auth profile rather than taking a prop, so there is exactly
 * one number in the app and no screen can show a stale copy of it. A caller may
 * still pass `value` — the Shop does, because its own payload is fresher than
 * the profile by one request after a purchase.
 *
 * ── Gold, and not a button ───────────────────────────────────────────────────
 *
 * design.md reserves gold for achievement and forbids it on anything that
 * offers an action. Coins are earned and can never be bought, so the colour is
 * right; the pill is therefore drawn as a TINT with gold ink rather than a gold
 * fill, which is what keeps it reading as a readout.
 *
 * It is tappable anyway, everywhere except inside the Shop itself, because a
 * number you can spend should take you to where it is spent. That is a
 * navigation affordance, not a call to action — hence the chevron-free,
 * outline-only treatment.
 */
export default function CoinBalance({ value, style, onPress }) {
  const router = useRouter();
  const { user } = useAuth();
  const amount = value ?? user?.coins ?? 0;
  const go = onPress === null ? null : (onPress ?? (() => router.push('/shop')));

  const body = (
    <>
      {/* A struck disc rather than a glyph: the icon set has no coin, and one
          bespoke glyph for one component is how an icon set stops being a set. */}
      <View style={styles.coin}>
        <View style={styles.coinInner} />
      </View>
      <Text allowFontScaling={false} style={styles.amount}>
        {fmtCoins(amount)}
      </Text>
    </>
  );

  if (!go) {
    return (
      <View style={[styles.pill, style]} accessibilityRole="text" accessibilityLabel={`${fmtCoins(amount)} coins`}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={go}
      accessibilityRole="button"
      accessibilityLabel={`${fmtCoins(amount)} coins. Opens the shop.`}
      style={({ pressed }) => [styles.pill, pressed && { opacity: 0.7 }, style]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    height: 34,
    borderRadius: layout.radiusPill,
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: 'rgba(245, 182, 46, 0.34)',
  },
  coin: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** The one detail that makes it a coin and not a dot. */
  coinInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(23, 20, 34, 0.35)',
  },
  amount: {
    fontFamily: fonts.display,
    fontSize: 15,
    lineHeight: 20,
    color: colors.gold,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
});
