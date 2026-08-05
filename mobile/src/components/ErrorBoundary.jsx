import { Component } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, Button } from './ui.jsx';
import Icon from './Icon.jsx';
import { colors, layout, space } from '../theme/index.js';

/**
 * The last line of defence.
 *
 * Everything else in this app degrades politely: a failed request becomes an
 * `ErrorNotice` with a Retry, a missing topic becomes an `EmptyState`. A throw
 * during RENDER has no such manners — React unmounts the entire tree and leaves
 * a white screen, and on a release build there is no dev menu, no reload
 * gesture and no logcat within reach. The player's only move is to kill the app,
 * and if the throw is in something restored on launch (a cached feed, a stale
 * match) killing it lands them right back on the white screen.
 *
 * So: catch, say something true, and offer the two ways out that actually work
 * from here — try rendering again, or go back to Home, which is the one route
 * guaranteed to exist.
 *
 * ── Why this is a class ──────────────────────────────────────────────────────
 *
 * `componentDidCatch` and `getDerivedStateFromError` have no hook equivalent.
 * React has never shipped one, so an error boundary is the single place a class
 * component is still the correct answer rather than a leftover.
 *
 * ── What it deliberately does not do ─────────────────────────────────────────
 *
 * It does not show the stack. The audience is students on mid-range Android, and
 * a component stack tells them nothing they can act on while making a bug look
 * like a breach. `onError` is the hook for reporting — wire it to a crash
 * reporter when there is one; until then the console log is what a `--dev` build
 * needs and a release build discards.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
    this.props.onError?.(error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <View style={styles.screen}>
        <View style={styles.icon}>
          <Icon name="alert" size={30} color={colors.wrong} />
        </View>

        <Text variant="display" style={styles.title}>
          That screen stopped working.
        </Text>
        <Text variant="body" color={colors.inkMuted} style={styles.body}>
          Nothing you did caused this and nothing has been lost — your coins,
          rating and streak all live on the server. Try again, and if it keeps
          happening, restart the app.
        </Text>

        <Button label="Try again" onPress={this.reset} style={styles.action} />
        {this.props.onGoHome ? (
          <Button
            variant="soft"
            label="Back to Home"
            onPress={() => {
              this.reset();
              this.props.onGoHome();
            }}
            style={styles.action}
          />
        ) : null}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: layout.gutter,
  },
  icon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.wrongSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  title: { textAlign: 'center', marginBottom: space.sm },
  body: { textAlign: 'center', maxWidth: 320, marginBottom: space.xl },
  action: { alignSelf: 'stretch', marginTop: space.md },
});
