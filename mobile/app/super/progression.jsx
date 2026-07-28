import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../../src/lib/api.js';
import { useIsSuperadmin } from '../../src/lib/admin.js';
import { useProgression } from '../../src/state/progression.jsx';
import {
  Text,
  Badge,
  Button,
  Chip,
  ErrorNotice,
  Segmented,
  SectionHeader,
  Spinner,
} from '../../src/components/ui.jsx';
import ConsoleHeader from '../../src/components/ConsoleHeader.jsx';
import { CardsSkeleton } from '../../src/components/Skeletons.jsx';
import Icon from '../../src/components/Icon.jsx';
import { faceSource } from '../../src/lib/avatar.js';
import { BANNERS } from '../../src/lib/banner.js';
import { LEAGUE_METALS, SPACE_ACCENTS } from '../../src/shared/constants.js';
import { colors, elevation, layout, space, type } from '../../src/theme/index.js';

/**
 * The ladder, as an operator sees it (leagues-and-progression.md §9).
 *
 * Four things live behind one screen because they are one decision made four
 * ways: what a player can wear, what it costs, what the bands are called, and
 * what a chest hands over. Editing them apart would let them disagree — an
 * avatar gated behind a league that was just renamed, a chest promising an
 * avatar that was just deleted — so they are edited together and the server
 * refuses the combinations that would break.
 *
 * Every save is a platform-wide change. The screen says so where it matters:
 * the curve tab reports how many players were pinned so the edit could not
 * demote them, and nothing is written until Save is pressed.
 */
const TABS = [
  { value: 'cosmetics', label: 'Items' },
  { value: 'levels', label: 'Levels' },
  { value: 'leagues', label: 'Leagues' },
  { value: 'chests', label: 'Chests' },
];

export default function SuperProgression() {
  const router = useRouter();
  const isSuper = useIsSuperadmin();
  const { refresh: refreshApp } = useProgression();

  const [tab, setTab] = useState('cosmetics');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!isSuper) router.replace('/');
  }, [isSuper, router]);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await api.get('/super/progression'));
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    if (isSuper) load();
  }, [isSuper, load]);

  /**
   * After any write: re-read the console's copy AND the app's own, because the
   * operator is a player too — their rewards screen is drawing from the same
   * config they just changed.
   */
  const afterWrite = useCallback(async () => {
    await load();
    await refreshApp();
  }, [load, refreshApp]);

  if (!isSuper) return null;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ConsoleHeader
        title="Ladder"
        subtitle={data ? `Config v${data.version}` : 'Progression'}
      />

      <ErrorNotice error={error} onRetry={load} />

      {!data && !error ? (
        <CardsSkeleton count={4} />
      ) : !data ? null : (
        <>
          <View style={styles.tabs}>
            <Segmented options={TABS} value={tab} onChange={setTab} />
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                tintColor={colors.accent}
                onRefresh={async () => {
                  setRefreshing(true);
                  await load();
                  setRefreshing(false);
                }}
              />
            }
          >
            {tab === 'cosmetics' ? <CosmeticsTab data={data} onSaved={afterWrite} /> : null}
            {tab === 'levels' ? <LevelsTab data={data} onSaved={afterWrite} /> : null}
            {tab === 'leagues' ? <LeaguesTab data={data} onSaved={afterWrite} /> : null}
            {tab === 'chests' ? <ChestsTab data={data} onSaved={afterWrite} /> : null}
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  );
}

// ── Items ──────────────────────────────────────────────────────────────────

const TYPES = [
  { value: 'avatar', label: 'Avatars' },
  { value: 'banner', label: 'Banners' },
  { value: 'title', label: 'Titles' },
];

function CosmeticsTab({ data, onSaved }) {
  const [type, setType] = useState('avatar');
  const [editing, setEditing] = useState(null);

  const rows = useMemo(
    () =>
      (data.cosmetics ?? [])
        .filter((c) => c.type === type)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [data, type],
  );

  return (
    <>
      <View style={styles.subTabs}>
        <Segmented options={TYPES} value={type} onChange={setType} />
      </View>

      <Pressable
        onPress={() =>
          setEditing({
            type,
            key: '',
            name: '',
            unlockKind: type === 'title' ? 'level' : 'shop',
            unlockLevel: 5,
            rarity: type === 'title' ? null : 'common',
            price: 250,
            enabled: true,
          })
        }
        accessibilityRole="button"
        accessibilityLabel={`Add ${type}`}
        style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
      >
        <Icon name="plus" size={16} color={colors.accent} />
        <Text variant="label" color={colors.accent}>
          Add {type}
        </Text>
      </Pressable>

      <View style={styles.rows}>
        {rows.map((row, i) => (
          <Pressable
            key={`${row.type}/${row.key}`}
            onPress={() => setEditing(row)}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${row.name}`}
            style={({ pressed }) => [styles.row, i > 0 && styles.rowDivided, pressed && styles.pressed]}
          >
            <CosmeticArt row={row} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="label" numberOfLines={1}>
                {row.name}
              </Text>
              <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
                {row.key} · {requirementOf(row)}
              </Text>
            </View>
            {row.enabled === false ? <Badge label="off" tone="wrong" /> : null}
            {row.imageUrl ? <Badge label="uploaded" tone="soft" /> : null}
            <Icon name="chevronRight" size={16} color={colors.inkFaint} />
          </Pressable>
        ))}
      </View>

      {editing ? (
        <CosmeticEditor
          row={editing}
          leagues={data.leagues}
          maxLevel={data.maxAccountLevel}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onSaved();
          }}
        />
      ) : null}
    </>
  );
}

function CosmeticArt({ row }) {
  const source =
    row.type === 'avatar'
      ? (row.imageUrl ? { uri: row.imageUrl } : faceSource(row.key))
      : row.type === 'banner'
        ? (row.imageUrl ? { uri: row.imageUrl } : BANNERS[row.key])
        : null;

  if (!source) {
    return (
      <View style={[styles.art, styles.artEmpty]}>
        <Icon name="sparkle" size={14} color={colors.inkFaint} />
      </View>
    );
  }
  return <Image source={source} style={styles.art} contentFit="cover" />;
}

const UNLOCK_KINDS = [
  { value: 'shop', label: 'Shop' },
  { value: 'free', label: 'Free' },
  { value: 'chest', label: 'Chest' },
  { value: 'level', label: 'Level' },
  { value: 'league', label: 'League' },
];

/**
 * The four tiers, with the band each one's price is expected to sit in.
 *
 * The band is a HINT, not a rule: the server takes any price, because an
 * operator putting one item outside its band is a decision, and a form that
 * refused it would be a form arguing with the person who owns the economy.
 */
const RARITIES = [
  { value: 'common', label: 'Common' },
  { value: 'uncommon', label: 'Uncommon' },
  { value: 'rare', label: 'Rare' },
  { value: 'legendary', label: 'Legendary' },
];

function CosmeticEditor({ row, leagues, maxLevel, onClose, onSaved }) {
  const isNew = !row.key;
  const [name, setName] = useState(row.name ?? '');
  const [key, setKey] = useState(row.key ?? '');
  const [unlockKind, setUnlockKind] = useState(row.unlockKind ?? 'free');
  const [unlockLevel, setUnlockLevel] = useState(String(row.unlockLevel || 1));
  const [rarity, setRarity] = useState(row.rarity ?? 'common');
  const [price, setPrice] = useState(String(row.price ?? ''));
  const [unlockLeague, setUnlockLeague] = useState(row.unlockLeague ?? leagues[0]?.key ?? null);
  const [imageUrl, setImageUrl] = useState(row.imageUrl ?? null);
  const [enabled, setEnabled] = useState(row.enabled !== false);
  const [order, setOrder] = useState(String(row.order ?? 0));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const pickImage = async () => {
    setError(null);
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: row.type === 'banner' ? [16, 7] : [1, 1],
        quality: 0.9,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      setUploading(true);
      const asset = picked.assets[0];
      const stored = await api.upload(row.type, asset.uri, asset.mimeType ?? 'image/png');
      setImageUrl(stored.url);
    } catch (err) {
      setError(err);
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put('/super/progression/cosmetics', {
        type: row.type,
        key: key.trim().toLowerCase(),
        name: name.trim() || key.trim(),
        unlockKind,
        unlockLevel: unlockKind === 'level' ? Number(unlockLevel) || 1 : 0,
        unlockLeague: unlockKind === 'league' ? unlockLeague : null,
        // A title is earned, so it has neither. Sending them would be refused.
        ...(row.type === 'title'
          ? {}
          : { rarity, price: unlockKind === 'shop' ? Number(price) || 0 : null, imageUrl }),
        enabled,
        order: Number(order) || 0,
      });
      await onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/super/progression/cosmetics/${row.type}/${row.key}`);
      await onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={isNew ? `New ${row.type}` : row.name} onClose={onClose}>
      <ErrorNotice error={error} />

      <Field label="Key">
        <TextInput
          style={[styles.input, !isNew && styles.inputLocked]}
          value={key}
          onChangeText={(v) => setKey(v.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase())}
          editable={isNew}
          autoCapitalize="none"
          placeholder="sphinx"
          placeholderTextColor={colors.inkFaint}
          accessibilityLabel="Key"
        />
      </Field>
      {isNew ? (
        <Text variant="meta" color={colors.inkFaint}>
          The key is how every profile stores this. It can never be changed afterwards — pick it
          the way you would name a file.
        </Text>
      ) : null}

      <Field label="Name">
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          maxLength={40}
          placeholder="Sphinx"
          placeholderTextColor={colors.inkFaint}
          accessibilityLabel="Name"
        />
      </Field>

      {row.type !== 'title' ? (
        <Field label="Rarity">
          <View style={styles.chipRow}>
            {RARITIES.map((r) => (
              <Chip
                key={r.value}
                label={r.label}
                active={rarity === r.value}
                onPress={() => setRarity(r.value)}
              />
            ))}
          </View>
        </Field>
      ) : null}

      <Field label="Unlocked by">
        <Segmented options={UNLOCK_KINDS} value={unlockKind} onChange={setUnlockKind} />
      </Field>

      {unlockKind === 'shop' && row.type !== 'title' ? (
        <Field label="Price in coins">
          <TextInput
            style={styles.input}
            value={price}
            onChangeText={(v) => setPrice(v.replace(/\D/g, '').slice(0, 7))}
            keyboardType="number-pad"
            placeholder="250"
            placeholderTextColor={colors.inkFaint}
            accessibilityLabel="Price in coins"
          />
        </Field>
      ) : null}

      {unlockKind === 'level' ? (
        <Field label={`Level (1–${maxLevel})`}>
          <TextInput
            style={styles.input}
            value={unlockLevel}
            onChangeText={(v) => setUnlockLevel(v.replace(/\D/g, '').slice(0, 2))}
            keyboardType="number-pad"
            accessibilityLabel="Unlock level"
          />
        </Field>
      ) : null}

      {unlockKind === 'league' ? (
        <Field label="League">
          <View style={styles.chipRow}>
            {leagues.map((l) => (
              <Chip
                key={l.key}
                label={l.name}
                active={unlockLeague === l.key}
                onPress={() => setUnlockLeague(l.key)}
              />
            ))}
          </View>
        </Field>
      ) : null}

      {unlockKind === 'chest' ? (
        <Text variant="meta" color={colors.inkMuted}>
          Only a chest can hand this over. Climbing never will — add it to a chest on the Chests
          tab, or nobody will ever own it.
        </Text>
      ) : null}

      {row.type !== 'title' ? (
        <Field label="Art">
          <Pressable
            onPress={uploading ? undefined : pickImage}
            accessibilityRole="button"
            accessibilityLabel="Upload art"
            style={({ pressed }) => [styles.upload, pressed && styles.pressed]}
          >
            {uploading ? (
              <Spinner size={16} />
            ) : (
              <Icon name="plus" size={15} color={colors.accent} />
            )}
            <Text variant="label" color={colors.accent}>
              {imageUrl ? 'Replace image' : 'Upload image'}
            </Text>
          </Pressable>
          <Text variant="meta" color={colors.inkFaint}>
            {imageUrl
              ? 'Served from storage. Players on any build will see it.'
              : 'No upload: the app draws the art it ships with for this key. Uploading is the only way to add something the build has never seen.'}
          </Text>
        </Field>
      ) : null}

      <Field label="Order">
        <TextInput
          style={styles.input}
          value={order}
          onChangeText={(v) => setOrder(v.replace(/[^0-9-]/g, '').slice(0, 4))}
          keyboardType="number-pad"
          accessibilityLabel="Order"
        />
      </Field>

      <View style={styles.switchRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="label">Available</Text>
          <Text variant="meta" color={colors.inkFaint}>
            Turning this off withdraws it from the shelf. Anyone already wearing it keeps it.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={setEnabled}
          trackColor={{ true: colors.accent, false: colors.hairline }}
        />
      </View>

      <Button label="Save" loading={busy} onPress={save} />
      {!isNew ? (
        <Button label="Delete" variant="ghost" onPress={remove} />
      ) : null}
    </Sheet>
  );
}

// ── Levels ─────────────────────────────────────────────────────────────────

function LevelsTab({ data, onSaved }) {
  const [rows, setRows] = useState(() => data.accountCurve.map(String));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);

  useEffect(() => {
    setRows(data.accountCurve.map(String));
  }, [data.accountCurve]);

  /** The first row that does not cost more than the one before it. */
  const badRow = useMemo(() => {
    const nums = rows.map((r) => Number(r));
    if (nums[0] !== 0) return 0;
    for (let i = 1; i < nums.length; i += 1) {
      if (!Number.isFinite(nums[i]) || nums[i] <= nums[i - 1]) return i;
    }
    return -1;
  }, [rows]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const result = await api.put('/super/progression/curve', { curve: rows.map(Number) });
      setNote(
        result.floored
          ? `Saved. ${result.floored} ${result.floored === 1 ? 'player was' : 'players were'} pinned at the level they had already reached.`
          : 'Saved. Nobody was above the new curve, so nothing had to be pinned.',
      );
      await onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionHeader title="Account XP" />
      <Text variant="meta" color={colors.inkFaint} style={styles.note}>
        Total XP to reach each level. A match pays roughly 70. Levels can only be made to arrive
        sooner or later — never to be taken away: anyone already past a level stays there whatever
        this table says afterwards.
      </Text>

      {note ? (
        <View style={styles.okNote} accessibilityLiveRegion="polite">
          <Icon name="check" size={14} color={colors.correct} />
          <Text variant="meta" color={colors.ink} style={{ flex: 1 }}>
            {note}
          </Text>
        </View>
      ) : null}

      <ErrorNotice error={error} />

      <View style={styles.rows}>
        {rows.map((value, i) => (
          <View key={i} style={[styles.curveRow, i > 0 && styles.rowDivided]}>
            <Text variant="label" color={colors.inkMuted} style={styles.curveLevel}>
              {i + 1}
            </Text>
            <TextInput
              style={[
                styles.curveInput,
                i === 0 && styles.inputLocked,
                badRow === i && styles.inputBad,
              ]}
              value={value}
              editable={i > 0}
              onChangeText={(v) =>
                setRows((prev) => prev.map((r, j) => (j === i ? v.replace(/\D/g, '').slice(0, 8) : r)))
              }
              keyboardType="number-pad"
              accessibilityLabel={`XP for level ${i + 1}`}
            />
            <Text variant="meta" color={colors.inkFaint} style={styles.curveDelta}>
              {i === 0 ? 'start' : `+${Math.max(0, Number(value) - Number(rows[i - 1]) || 0)}`}
            </Text>
          </View>
        ))}
      </View>

      {badRow >= 0 ? (
        <Text variant="meta" color={colors.wrong} style={styles.note}>
          {badRow === 0
            ? 'Level 1 always starts at 0.'
            : `Level ${badRow + 1} has to cost more than level ${badRow}.`}
        </Text>
      ) : null}

      <Button label="Save curve" loading={busy} disabled={badRow >= 0} onPress={save} />
    </>
  );
}

// ── Leagues ────────────────────────────────────────────────────────────────

function LeaguesTab({ data, onSaved }) {
  const [rows, setRows] = useState(() => data.leagues.map((l) => ({ ...l, floor: String(l.floor) })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setRows(data.leagues.map((l) => ({ ...l, floor: String(l.floor) })));
  }, [data.leagues]);

  const patch = (i, key, value) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [key]: value } : r)));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put('/super/progression/leagues', {
        leagues: rows.map((r) => ({
          key: r.key,
          name: r.name,
          floor: Number(r.floor),
          color: r.color ?? null,
        })),
      });
      await onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionHeader title="Bands" />
      <Text variant="meta" color={colors.inkFaint} style={styles.note}>
        A league is a band of ranked rating — there is no separate ladder. The bottom one has to
        start at {data.ratingFloor}, because every rating needs a badge. Divisions are{' '}
        {data.divisions} × {data.divisionWidth} points inside each band.
      </Text>

      <ErrorNotice error={error} />

      <View style={styles.rows}>
        {rows.map((row, i) => (
          <View key={row.key} style={[styles.leagueRow, i > 0 && styles.rowDivided]}>
            <View style={styles.leagueHead}>
              <View style={[styles.swatch, { backgroundColor: row.color ?? colors.hairline }]} />
              <TextInput
                style={[styles.input, styles.leagueName]}
                value={row.name}
                onChangeText={(v) => patch(i, 'name', v)}
                maxLength={24}
                accessibilityLabel={`${row.key} name`}
              />
              <TextInput
                style={[styles.input, styles.leagueFloor]}
                value={row.floor}
                onChangeText={(v) => patch(i, 'floor', v.replace(/\D/g, '').slice(0, 5))}
                editable={i > 0}
                keyboardType="number-pad"
                accessibilityLabel={`${row.key} floor rating`}
              />
            </View>
            <View style={styles.chipRow}>
              {/* The metals first — they are what a league badge is struck in,
                  and the org accents are only there for a ladder that wants a
                  colour outside the set. */}
              {[...LEAGUE_METALS, ...SPACE_ACCENTS].map((hex) => (
                <Pressable
                  key={hex}
                  onPress={() => patch(i, 'color', row.color === hex ? null : hex)}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.name} colour ${hex}`}
                  style={[
                    styles.colorDot,
                    { backgroundColor: hex },
                    row.color === hex && styles.colorDotOn,
                  ]}
                />
              ))}
            </View>
          </View>
        ))}
      </View>

      <Button label="Save leagues" loading={busy} onPress={save} />
    </>
  );
}

// ── Chests ─────────────────────────────────────────────────────────────────

function ChestsTab({ data, onSaved }) {
  const [editing, setEditing] = useState(null);

  return (
    <>
      <SectionHeader title="Chests" />
      <Text variant="meta" color={colors.inkFaint} style={styles.note}>
        A chest opens on a rating or on a league, and waits on the player’s rewards screen until
        they open it. Won once, kept forever — a demotion never takes back what was inside.
      </Text>

      <Pressable
        onPress={() =>
          setEditing({
            key: '',
            name: '',
            description: '',
            triggerKind: 'league',
            triggerLeague: data.leagues[1]?.key ?? data.leagues[0]?.key,
            triggerRating: 1400,
            rewards: [],
            enabled: true,
          })
        }
        accessibilityRole="button"
        accessibilityLabel="Add chest"
        style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
      >
        <Icon name="plus" size={16} color={colors.accent} />
        <Text variant="label" color={colors.accent}>
          Add chest
        </Text>
      </Pressable>

      <View style={styles.rows}>
        {(data.chests ?? []).map((chest, i) => (
          <Pressable
            key={chest.key}
            onPress={() => setEditing(chest)}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${chest.name}`}
            style={({ pressed }) => [styles.row, i > 0 && styles.rowDivided, pressed && styles.pressed]}
          >
            <View style={styles.chestSeal}>
              <Icon name="gift" size={18} color={colors.gold} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="label" numberOfLines={1}>
                {chest.name}
              </Text>
              <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
                {triggerOf(chest, data.leagues)} · {chest.rewards.length} slots
                {chest.period ? ` · rolled ${chest.period}` : ''}
              </Text>
            </View>
            {chest.enabled === false ? <Badge label="off" tone="wrong" /> : null}
            <Icon name="chevronRight" size={16} color={colors.inkFaint} />
          </Pressable>
        ))}
      </View>

      {editing ? (
        <ChestEditor
          chest={editing}
          data={data}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onSaved();
          }}
        />
      ) : null}
    </>
  );
}

const TRIGGERS = [
  { value: 'league', label: 'League' },
  { value: 'rating', label: 'Rating' },
];

/** The three amounts a coin slot is worth (coins-and-cosmetics.md §5.2). */
const COIN_SLOTS = [25, 50, 100];

function ChestEditor({ chest, data, onClose, onSaved }) {
  const isNew = !chest.key;
  const [key, setKey] = useState(chest.key ?? '');
  const [name, setName] = useState(chest.name ?? '');
  const [description, setDescription] = useState(chest.description ?? '');
  const [triggerKind, setTriggerKind] = useState(chest.triggerKind ?? 'league');
  const [triggerLeague, setTriggerLeague] = useState(chest.triggerLeague ?? data.leagues[0]?.key);
  const [triggerRating, setTriggerRating] = useState(String(chest.triggerRating ?? 1400));
  const [rewards, setRewards] = useState(chest.rewards ?? []);
  const [enabled, setEnabled] = useState(chest.enabled !== false);
  const [picking, setPicking] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put('/super/progression/chests', {
        key: key.trim().toLowerCase(),
        name: name.trim() || key.trim(),
        description: description.trim(),
        triggerKind,
        triggerLeague: triggerKind === 'league' ? triggerLeague : null,
        triggerRating: triggerKind === 'rating' ? Number(triggerRating) || 0 : null,
        rewards,
        enabled,
      });
      await onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/super/progression/chests/${chest.key}`);
      await onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={isNew ? 'New chest' : chest.name} onClose={onClose}>
      <ErrorNotice error={error} />

      <Field label="Key">
        <TextInput
          style={[styles.input, !isNew && styles.inputLocked]}
          value={key}
          onChangeText={(v) => setKey(v.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase())}
          editable={isNew}
          autoCapitalize="none"
          placeholder="gold-chest"
          placeholderTextColor={colors.inkFaint}
          accessibilityLabel="Key"
        />
      </Field>

      <Field label="Name">
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          maxLength={40}
          placeholder="Gold chest"
          placeholderTextColor={colors.inkFaint}
          accessibilityLabel="Name"
        />
      </Field>

      <Field label="Description">
        <TextInput
          style={styles.input}
          value={description}
          onChangeText={setDescription}
          maxLength={160}
          placeholder="For reaching Gold."
          placeholderTextColor={colors.inkFaint}
          accessibilityLabel="Description"
        />
      </Field>

      <Field label="Opens on">
        <Segmented options={TRIGGERS} value={triggerKind} onChange={setTriggerKind} />
      </Field>

      {triggerKind === 'league' ? (
        <View style={styles.chipRow}>
          {data.leagues.map((l) => (
            <Chip
              key={l.key}
              label={l.name}
              active={triggerLeague === l.key}
              onPress={() => setTriggerLeague(l.key)}
            />
          ))}
        </View>
      ) : (
        <Field label="Ranked rating">
          <TextInput
            style={styles.input}
            value={triggerRating}
            onChangeText={(v) => setTriggerRating(v.replace(/\D/g, '').slice(0, 5))}
            keyboardType="number-pad"
            accessibilityLabel="Trigger rating"
          />
        </Field>
      )}

      <Field label={`Slots (${rewards.length})`}>
        {/* Opening draws ONE of these, so this list is the drop table rather
            than an inventory. Editing it changes the odds, and there is no
            second weighting table anywhere that could disagree with it. */}
        <Text variant="meta" color={colors.inkFaint} style={{ marginBottom: space.sm }}>
          Opening draws one slot at random, so this list is the odds. The two monthly chests are
          re-rolled from the catalogue on the 1st — anything set by hand here is replaced then.
        </Text>
        {rewards.length === 0 ? (
          <Text variant="meta" color={colors.inkFaint}>
            Nothing yet. A chest has to hold something.
          </Text>
        ) : null}
        <View style={styles.chipRow}>
          {rewards.map((r, i) => (
            <Chip
              key={`${r.type}/${r.key ?? r.amount}/${i}`}
              label={`${r.type === 'coins' ? `${r.amount} coins` : r.key} ✕`}
              active
              onPress={() => setRewards((prev) => prev.filter((_, at) => at !== i))}
            />
          ))}
        </View>
        <View style={styles.chipRow}>
          {TYPES.map((t) => (
            <Chip key={t.value} label={`Add ${t.value}`} onPress={() => setPicking(t.value)} />
          ))}
          {COIN_SLOTS.map((amount) => (
            <Chip
              key={amount}
              label={`+${amount} coins`}
              onPress={() =>
                setRewards((prev) =>
                  prev.length >= 20 ? prev : [...prev, { type: 'coins', amount, key: null }],
                )
              }
            />
          ))}
        </View>
      </Field>

      <View style={styles.switchRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="label">Active</Text>
          <Text variant="meta" color={colors.inkFaint}>
            Off stops it being awarded. Chests already won stay openable.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={setEnabled}
          trackColor={{ true: colors.accent, false: colors.hairline }}
        />
      </View>

      <Button label="Save" loading={busy} disabled={!rewards.length} onPress={save} />
      {!isNew ? <Button label="Delete" variant="ghost" onPress={remove} /> : null}

      {picking ? (
        <Sheet title={`Pick a ${picking}`} onClose={() => setPicking(null)}>
          <View style={styles.chipRow}>
            {(data.cosmetics ?? [])
              .filter((c) => c.type === picking)
              .map((c) => (
                <Chip
                  key={c.key}
                  label={c.name}
                  active={rewards.some((r) => r.type === c.type && r.key === c.key)}
                  onPress={() => {
                    setRewards((prev) =>
                      prev.some((r) => r.type === c.type && r.key === c.key)
                        ? prev
                        : [...prev, { type: c.type, key: c.key }],
                    );
                    setPicking(null);
                  }}
                />
              ))}
          </View>
        </Sheet>
      ) : null}
    </Sheet>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function Sheet({ title, onClose, children }) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={[styles.sheet, elevation.raised]}>
          <View style={styles.sheetHead}>
            <Text variant="title" style={{ flex: 1 }} numberOfLines={1}>
              {title}
            </Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
              <Icon name="close" size={20} color={colors.inkMuted} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.sheetBody}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Field({ label, children }) {
  return (
    <View style={styles.field}>
      <Text variant="label" color={colors.inkMuted}>
        {label}
      </Text>
      {children}
    </View>
  );
}

function requirementOf(row) {
  if (row.unlockKind === 'shop') return `${row.rarity ?? '—'} · ${row.price ?? '—'} coins`;
  if (row.unlockKind === 'level') return `level ${row.unlockLevel}`;
  if (row.unlockKind === 'league') return `${row.unlockLeague} league`;
  if (row.unlockKind === 'chest') return `${row.rarity ?? 'chest'} · chest only`;
  return 'free';
}

function triggerOf(chest, leagues) {
  if (chest.triggerKind === 'rating') return `at ${chest.triggerRating}`;
  return `at ${leagues.find((l) => l.key === chest.triggerLeague)?.name ?? chest.triggerLeague}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  tabs: { paddingHorizontal: layout.gutter, paddingBottom: space.sm },
  subTabs: { paddingBottom: space.md },
  content: { padding: layout.gutter, paddingTop: space.sm, paddingBottom: space.xxxl },
  note: { marginBottom: space.md },
  okNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.correctSoft,
    borderRadius: layout.radiusInput,
    padding: space.md,
    marginBottom: space.md,
  },
  rows: {
    backgroundColor: colors.canvas,
    borderRadius: layout.radiusCard,
    paddingHorizontal: space.lg,
    marginBottom: layout.cardGap,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 62 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.hairline },
  pressed: { opacity: 0.7 },
  art: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.sunken },
  artEmpty: { alignItems: 'center', justifyContent: 'center' },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: colors.canvas,
    borderRadius: layout.radiusCard,
    height: 52,
    marginBottom: layout.cardGap,
  },
  chestSeal: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sunken,
  },

  // Curve
  curveRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52 },
  curveLevel: { width: 26, textAlign: 'right', fontVariant: ['tabular-nums'] },
  curveInput: {
    ...type.option,
    flex: 1,
    color: colors.ink,
    backgroundColor: colors.sunken,
    borderRadius: layout.radiusInput,
    borderWidth: 1.5,
    borderColor: colors.transparent,
    paddingHorizontal: space.md,
    height: 40,
    fontVariant: ['tabular-nums'],
  },
  curveDelta: { width: 64, textAlign: 'right', fontVariant: ['tabular-nums'] },

  // Leagues
  leagueRow: { paddingVertical: space.md, gap: space.sm },
  leagueHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  leagueName: { flex: 1, height: 44 },
  leagueFloor: { width: 92, height: 44, textAlign: 'center', fontVariant: ['tabular-nums'] },
  swatch: { width: 12, height: 34, borderRadius: 4 },
  colorDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.transparent },
  colorDotOn: { borderColor: colors.ink },

  // Sheet
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(10,10,20,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.canvas,
    borderTopLeftRadius: layout.radiusCard,
    borderTopRightRadius: layout.radiusCard,
    maxHeight: '88%',
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.gutter,
    paddingTop: space.lg,
    paddingBottom: space.md,
  },
  sheetBody: { paddingHorizontal: layout.gutter, paddingBottom: space.xxxl, gap: space.md },
  field: { gap: space.sm },
  input: {
    ...type.option,
    color: colors.ink,
    backgroundColor: colors.sunken,
    borderRadius: layout.radiusInput,
    borderWidth: 1.5,
    borderColor: colors.transparent,
    paddingHorizontal: space.lg,
    height: 50,
  },
  inputLocked: { opacity: 0.55 },
  inputBad: { borderColor: colors.wrong },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  upload: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 50,
    borderRadius: layout.radiusInput,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.hairline,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
});
