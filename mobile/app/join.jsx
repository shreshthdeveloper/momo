import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { api } from '../src/lib/api.js';
import { useAuth } from '../src/state/auth.jsx';
import { Text, Button, ErrorNotice, Avatar, IconButton } from '../src/components/ui.jsx';
import { BrandField } from '../src/components/Brand.jsx';
import Icon from '../src/components/Icon.jsx';
import { colors, layout, space, type } from '../src/theme/index.js';

/**
 * The server issues six-character codes and accepts 4–12 (`spaces.js`), so the
 * boxes show six and the field takes anything the backend would. Hard-coding
 * exactly six meant a shorter or longer code that the API would have honoured
 * simply could not be typed on this screen.
 */
const LENGTH = 6;
const MIN_LENGTH = 4;
const MAX_LENGTH = 12;

/**
 * prd.md F7.1 — join via 6-character code, invite link, or QR.
 *
 * On the night field, because this is the one moment a player crosses from the
 * Public Arena into somebody's organization. Six boxes rather than a text field:
 * a code handed out on a whiteboard is read one character at a time, and the
 * boxes let a student check their work the same way.
 */
export default function Join() {
  const router = useRouter();
  /**
   * An invite link carries the code. `wms.distrx.io/join/<code>` routes here
   * with it, and it used to be dropped on the floor — the screen read no
   * params at all, so following an invitation presented six empty boxes and
   * the code the link already contained had to be typed in by hand.
   */
  const { code: linked } = useLocalSearchParams();
  const { joinSpace, setActiveSpaceId } = useAuth();
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  /** Set when the organization has to approve — a request, not a join. */
  const [requested, setRequested] = useState(null);
  const inputRef = useRef(null);

  const lookup = async (value) => {
    setError(null);
    if (value.length < MIN_LENGTH) {
      setPreview(null);
      return;
    }
    try {
      setPreview(await api.get(`/spaces/lookup/${value}`));
    } catch (err) {
      setPreview(null);
      setError(err);
    }
  };

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await joinSpace(code);
      if (result.status === 'active') {
        setActiveSpaceId(result.space.id);
        router.back();
        return;
      }
      /**
       * Approval mode. Closing the sheet in silence told the player nothing
       * at all, and Settings then listed the organization exactly like a
       * joined one — so a request that was still waiting looked like a
       * membership that had gone through.
       */
      setRequested(result.space?.name ?? preview?.name ?? 'your organization');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (typeof linked !== 'string') return;
    const clean = linked.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MAX_LENGTH);
    if (!clean) return;
    setCode(clean);
    lookup(clean);
  }, [linked]);

  if (requested) {
    return (
      <BrandField>
        <StatusBar style="light" />
        <SafeAreaView style={styles.screen}>
          <View style={styles.top}>
            <IconButton name="close" tone="onColor" onPress={() => router.back()} label="Close" />
          </View>
          <View style={[styles.flex, styles.centred]}>
            <Icon name="check" size={44} color={colors.onColor} />
            <Text variant="display" color={colors.onColor} style={{ marginTop: space.lg }}>
              Request sent
            </Text>
            <Text
              variant="body"
              color="rgba(255,255,255,0.8)"
              style={{ marginTop: space.sm, textAlign: 'center' }}
            >
              {requested} has to approve new members. You will see it in your
              organizations once they do.
            </Text>
          </View>
          <View style={{ paddingBottom: space.xl }}>
            <Button variant="onColor" label="Done" onPress={() => router.back()} />
          </View>
        </SafeAreaView>
      </BrandField>
    );
  }

  return (
    <BrandField>
      <StatusBar style="light" />
      <SafeAreaView style={styles.screen}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
          <View style={styles.top}>
            <IconButton name="close" tone="onColor" onPress={() => router.back()} label="Cancel" />
          </View>

          <View style={styles.flex}>
            <Text variant="display" color={colors.onColor}>
              Join your organization
            </Text>
            <Text variant="body" color="rgba(255,255,255,0.8)" style={{ marginTop: space.sm }}>
              Enter the {LENGTH}-character code your organization gave you.
            </Text>

            <Pressable style={({ pressed }) => [styles.boxes, pressed && { opacity: 0.7 }]} onPress={() => inputRef.current?.focus()}>
              {Array.from({ length: LENGTH }).map((_, i) => {
                const char = code[i];
                const active = i === code.length;
                return (
                  <View key={i} style={[styles.box, char ? styles.boxFilled : null, active ? styles.boxActive : null]}>
                    <Text style={[type.title, { color: colors.onColor }]}>{char ?? ''}</Text>
                  </View>
                );
              })}
            </Pressable>

            <TextInput
              ref={inputRef}
              style={styles.hidden}
              value={code}
              onChangeText={(v) => {
                const next = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MAX_LENGTH);
                setCode(next);
                lookup(next);
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              maxLength={MAX_LENGTH}
              caretHidden
              accessibilityLabel="Join code"
            />

            {preview ? (
              <View style={styles.preview}>
                <Avatar url={preview.logoUrl} name={preview.name} size={48} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="label" numberOfLines={1}>
                    {preview.name}
                  </Text>
                  <Text variant="meta" color={colors.inkMuted}>
                    {preview.requiresApproval ? 'An admin approves new members' : 'You join immediately'}
                  </Text>
                </View>
                <Icon name="check" size={18} color={colors.correct} />
              </View>
            ) : null}
          </View>

          <View style={{ paddingBottom: space.xl }}>
            <ErrorNotice error={error} />
            <Button variant="onColor" label="Join" loading={busy} disabled={!preview} onPress={join} />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </BrandField>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: layout.gutter },
  flex: { flex: 1 },
  top: { flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: space.sm },
  boxes: { flexDirection: 'row', gap: space.sm, marginTop: space.xxl },
  centred: { alignItems: 'center', justifyContent: 'center' },
  box: {
    flex: 1,
    aspectRatio: 1,
    maxHeight: 58,
    borderRadius: layout.radiusInput,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1.5,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxFilled: { backgroundColor: 'rgba(255,255,255,0.24)' },
  boxActive: { borderColor: colors.onColor },
  hidden: { position: 'absolute', opacity: 0, height: 1, width: 1 },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.canvas,
    borderRadius: layout.radiusCard,
    padding: space.lg,
    marginTop: space.xl,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
});
