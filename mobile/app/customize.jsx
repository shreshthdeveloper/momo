import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../src/state/auth.jsx';
import { api } from '../src/lib/api.js';
import { Text, Button, ErrorNotice, Avatar, Header, Spinner } from '../src/components/ui.jsx';
import Icon from '../src/components/Icon.jsx';
import { resolveBanner } from '../src/lib/banner.js';
import CountryPicker from '../src/components/CountryPicker.jsx';
import { countryName, flagEmoji } from '../src/lib/country.js';
import { colors, elevation, layout, space, type } from '../src/theme/index.js';

/**
 * Edit profile — the parts of you the Shop does not sell.
 *
 * This was "Your look", and it was two screens wearing one name: a picker for
 * the avatar, the banner and the title, and a form for the country. Once the
 * Shop existed, the picker half was a second, worse copy of it — the same grid
 * with none of the prices, none of the tiers and its own idea of what was
 * locked. Two places to change your avatar is one place too many, and the one
 * that cannot show you what an avatar costs is the wrong one.
 *
 * So the split is by SOURCE, and it holds without a single judgement call:
 *
 *   the Shop  → anything out of the catalogue: avatars, banners, titles
 *   this      → anything you type or take: your name, your flag, your city,
 *               your own photographs
 *
 * ── The name ─────────────────────────────────────────────────────────────────
 *
 * It is editable here for the first time. Until now it could only be set during
 * sign-up, which meant a typo made at the very first prompt was permanent — a
 * genuine gap rather than a decision, and the natural place to close it was the
 * screen that was already called "edit".
 *
 * The server owns the rules (length, characters, reserved words, uniqueness),
 * so this does not restate them. It shows what comes back, which is the only
 * way "that name is taken" can ever be correct.
 */
export default function Customize() {
  const router = useRouter();
  const { user, updateProfile } = useAuth();

  const [name, setName] = useState(user?.displayName ?? '');
  const [country, setCountry] = useState(user?.country ?? null);
  const [city, setCity] = useState(user?.city ?? '');
  /** Held as wire values: a URL for an upload, `mimo:…/<key>` for a catalogue item. */
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? null);
  const [banner, setBanner] = useState(user?.banner ?? null);

  const [pickingCountry, setPickingCountry] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(null);
  const [error, setError] = useState(null);

  const previewBanner = resolveBanner(banner, user?.displayName);
  const customBanner = Boolean(banner && /^https?:/.test(banner));

  /**
   * One picker for both, because the only thing that differs is the crop and
   * where the result lands. A 1:1 for the face, 16:7 for the banner — the two
   * shapes they are actually drawn at, so what is framed here is what appears.
   */
  const pickPhoto = async (kind) => {
    setError(null);
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: kind === 'banner' ? [16, 7] : [1, 1],
        quality: 0.85,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      setUploading(kind);
      const asset = picked.assets[0];
      const stored = await api.upload(kind, asset.uri, asset.mimeType ?? 'image/jpeg');
      if (kind === 'banner') setBanner(stored.url);
      else setAvatarUrl(stored.url);
    } catch (err) {
      setError(err);
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const patch = {};
      const trimmed = name.trim();
      if (trimmed && trimmed !== user?.displayName) patch.displayName = trimmed;
      if (country && country !== user?.country) patch.country = country;
      // An emptied city is a real edit, so it is sent as an empty string rather
      // than skipped the way an untouched field is.
      if (city.trim() !== (user?.city ?? '')) patch.city = city.trim();
      if (avatarUrl && avatarUrl !== user?.avatarUrl) patch.avatarUrl = avatarUrl;
      if (banner && banner !== user?.banner) patch.banner = banner;

      if (Object.keys(patch).length) await updateProfile(patch);
      router.back();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Edit profile" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* ── The preview: your half of the versus screen, in miniature. That is
            the whole pitch for editing any of this — it is how you appear at
            the moment two players slam together. */}
        <View style={[styles.preview, elevation.raised]}>
          <Image source={previewBanner} style={StyleSheet.absoluteFill} contentFit="cover" />
          <View style={styles.previewShade} />
          <View style={styles.previewRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="title" color={colors.onColor} numberOfLines={1}>
                {name.trim() || 'You'}
              </Text>
              {user?.title ? (
                <Text variant="tiny" color="rgba(255,255,255,0.86)" numberOfLines={1}>
                  {user.title.replace(/-/g, ' ')}
                </Text>
              ) : null}
              <View style={styles.fromRow}>
                {country ? (
                  <>
                    <Text allowFontScaling={false} style={styles.flag}>
                      {flagEmoji(country)}
                    </Text>
                    <Text variant="meta" color="rgba(255,255,255,0.8)" numberOfLines={1}>
                      {[city.trim(), countryName(country)].filter(Boolean).join(', ')}
                    </Text>
                  </>
                ) : (
                  <Text variant="meta" color="rgba(255,255,255,0.6)">
                    Pick a country below
                  </Text>
                )}
              </View>
            </View>
            <Avatar url={avatarUrl} name={name} size={64} style={styles.previewFace} />
          </View>
        </View>

        <ErrorNotice error={error} />

        {/* ── Your name. */}
        <Text variant="label" color={colors.inkMuted} style={styles.label}>
          Display name
        </Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          maxLength={24}
          autoCapitalize="words"
          autoCorrect={false}
          placeholder="What people call you"
          placeholderTextColor={colors.inkFaint}
          accessibilityLabel="Display name"
        />
        <Text variant="meta" color={colors.inkFaint} style={styles.hint}>
          Everyone sees this — on the versus screen, on the leaderboards, on friend lists.
        </Text>

        {/* ── Where you are. The flag sits beside your name everywhere. */}
        <Text variant="label" color={colors.inkMuted} style={styles.label}>
          Country
        </Text>
        <Pressable
          onPress={() => setPickingCountry(true)}
          accessibilityRole="button"
          accessibilityLabel={
            country ? `Country: ${countryName(country)}. Tap to change.` : 'Choose your country'
          }
          style={({ pressed }) => [styles.field, pressed && { opacity: 0.85 }]}
        >
          <Text allowFontScaling={false} style={styles.countryFieldFlag}>
            {country ? flagEmoji(country) : '🌍'}
          </Text>
          <Text
            variant="body"
            color={country ? colors.ink : colors.inkFaint}
            style={{ flex: 1 }}
            numberOfLines={1}
          >
            {country ? countryName(country) : 'Choose your country'}
          </Text>
          <Icon name="chevronRight" size={16} color={colors.inkFaint} />
        </Pressable>

        <Text variant="label" color={colors.inkMuted} style={styles.label}>
          City
        </Text>
        <TextInput
          style={styles.input}
          value={city}
          onChangeText={setCity}
          maxLength={60}
          autoCapitalize="words"
          placeholder="Optional"
          placeholderTextColor={colors.inkFaint}
          accessibilityLabel="City"
        />
        <Text variant="meta" color={colors.inkFaint} style={styles.hint}>
          Only used for the city leaderboard, and only if your profile is public.
        </Text>

        {/* ── Your own photographs.
            These stay here rather than moving to the Shop because they are not
            catalogue items: nothing gates them, nothing prices them, and there
            is nothing to browse. They are a thing you supply. */}
        <Text variant="label" color={colors.inkMuted} style={styles.label}>
          Your own photos
        </Text>

        <Pressable
          onPress={uploading ? undefined : () => pickPhoto('avatar')}
          accessibilityRole="button"
          accessibilityLabel="Use your own picture as your avatar"
          style={({ pressed }) => [styles.uploadRow, pressed && !uploading && { opacity: 0.88 }]}
        >
          <View style={styles.uploadDisc}>
            {uploading === 'avatar' ? (
              <Spinner size={18} />
            ) : (
              <Icon name="user" size={18} color={colors.accent} />
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="label">{uploading === 'avatar' ? 'Uploading…' : 'Use your own picture'}</Text>
            <Text variant="meta" color={colors.inkFaint}>
              Replaces whichever avatar you are wearing.
            </Text>
          </View>
          <Icon name="chevronRight" size={16} color={colors.inkFaint} />
        </Pressable>

        <Pressable
          onPress={uploading ? undefined : () => pickPhoto('banner')}
          accessibilityRole="button"
          accessibilityLabel={customBanner ? 'Change your banner photo' : 'Upload your own banner'}
          accessibilityState={{ selected: Boolean(customBanner) }}
          style={({ pressed }) => [
            customBanner ? styles.uploadPreview : styles.uploadRow,
            customBanner && styles.uploadPreviewOn,
            pressed && !uploading && { opacity: 0.88 },
          ]}
        >
          {customBanner ? (
            <>
              <Image source={{ uri: banner }} style={StyleSheet.absoluteFill} contentFit="cover" />
              <View style={styles.changePill}>
                {uploading === 'banner' ? (
                  <Spinner size={14} tone="onColor" />
                ) : (
                  <Icon name="plus" size={13} color={colors.onColor} />
                )}
                <Text variant="tiny" color={colors.onColor}>
                  {uploading === 'banner' ? 'Uploading…' : 'Change photo'}
                </Text>
              </View>
            </>
          ) : (
            <>
              <View style={styles.uploadDisc}>
                {uploading === 'banner' ? (
                  <Spinner size={18} />
                ) : (
                  <Icon name="plus" size={18} color={colors.accent} />
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="label">
                  {uploading === 'banner' ? 'Uploading…' : 'Upload your own banner'}
                </Text>
                <Text variant="meta" color={colors.inkFaint}>
                  A wide shot works best — it sits behind your name.
                </Text>
              </View>
              <Icon name="chevronRight" size={16} color={colors.inkFaint} />
            </>
          )}
        </Pressable>

        {/* ── And the signpost. The avatars, banners and titles all live in one
            place now, and this screen says which one rather than quietly being
            a second, worse copy of it. */}
        <Pressable
          onPress={() => router.push('/shop')}
          accessibilityRole="button"
          accessibilityLabel="Open the shop to change your avatar, banner or title"
          style={({ pressed }) => [styles.shopRow, pressed && { opacity: 0.85 }]}
        >
          <View style={styles.shopSeal}>
            <Icon name="gift" size={18} color={colors.gold} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="label">Avatars, banners and titles</Text>
            <Text variant="meta" color={colors.inkMuted}>
              All in the Shop — buy them, wear them, see what a chest is holding.
            </Text>
          </View>
          <Icon name="chevronRight" size={16} color={colors.gold} />
        </Pressable>
      </ScrollView>

      <CountryPicker
        visible={pickingCountry}
        value={country}
        onSelect={setCountry}
        onClose={() => setPickingCountry(false)}
      />

      <View style={styles.footer}>
        <Button label="Save" loading={busy} onPress={save} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: layout.gutter, paddingBottom: layout.scrollBottom },

  preview: { borderRadius: layout.radiusCard, overflow: 'hidden', marginBottom: space.lg },
  previewShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(18, 14, 30, 0.38)' },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    minHeight: 108,
  },
  previewFace: { borderWidth: 3, borderColor: colors.onColor },
  fromRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flag: { fontSize: 15, lineHeight: 19 },

  label: { marginTop: space.lg, marginBottom: space.sm },
  hint: { marginTop: space.sm },
  input: {
    ...type.body,
    color: colors.ink,
    minHeight: 54,
    paddingHorizontal: space.lg,
    borderRadius: layout.radiusInput,
    backgroundColor: colors.sunken,
    borderWidth: 1.5,
    borderColor: colors.hairline,
  },

  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: layout.radiusInput,
    backgroundColor: colors.sunken,
    borderWidth: 1.5,
    borderColor: colors.hairline,
  },
  countryFieldFlag: { fontSize: 22, lineHeight: 28 },

  uploadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 66,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: layout.radiusInput,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.hairline,
    backgroundColor: colors.sunken,
    marginBottom: space.md,
  },
  uploadDisc: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  uploadPreview: {
    height: 96,
    borderRadius: layout.radiusInput,
    borderWidth: 3,
    borderColor: colors.transparent,
    overflow: 'hidden',
    backgroundColor: colors.sunken,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    padding: space.sm,
    marginBottom: space.md,
  },
  uploadPreviewOn: { borderColor: colors.accent },
  changePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: space.md,
    paddingVertical: 5,
    borderRadius: layout.radiusPill,
  },

  shopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 66,
    padding: space.md,
    marginTop: space.lg,
    borderRadius: layout.radiusInput,
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: 'rgba(245, 182, 46, 0.34)',
  },
  shopSeal: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245, 182, 46, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(245, 182, 46, 0.34)',
  },

  footer: {
    paddingHorizontal: layout.gutter,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    backgroundColor: colors.canvas,
  },
});
