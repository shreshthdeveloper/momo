import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, IconButton, SearchField } from './ui.jsx';
import Icon from './Icon.jsx';
import { COUNTRIES, POPULAR_COUNTRY_CODES, countryByCode, flagEmoji, searchCountries } from '../lib/country.js';
import { colors, layout, space } from '../theme/index.js';

/**
 * Every country, searchable.
 *
 * A wrapped chip cloud was fine for a dozen countries and impossible at two
 * hundred, so the list moves into a sheet with a search field: type two
 * letters and the answer is there. The likely homes still sit at the top when
 * nothing is typed, because a picker that opens on the answer beats a picker
 * that opens on the alphabet.
 *
 * Rows are virtualised — two hundred rows is exactly the size where a mapped
 * ScrollView starts costing frames on a mid-range Android.
 */
const POPULAR_LABEL = 'Common choices';
const ALL_LABEL = 'All countries';

export default function CountryPicker({ visible, value, onSelect, onClose }) {
  const [query, setQuery] = useState('');

  const data = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed) return searchCountries(trimmed);

    const popular = POPULAR_COUNTRY_CODES.map(countryByCode).filter(Boolean);
    const popularCodes = new Set(popular.map((c) => c.code));
    return [
      { label: POPULAR_LABEL },
      ...popular,
      { label: ALL_LABEL },
      ...COUNTRIES.filter((c) => !popularCodes.has(c.code)),
    ];
  }, [query]);

  const close = () => {
    setQuery('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={close}
    >
      <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
        <View style={styles.head}>
          <Text variant="title" style={{ flex: 1 }}>
            Where are you from?
          </Text>
          <IconButton name="close" onPress={close} label="Close" />
        </View>

        <SearchField
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          placeholder="Search countries"
          autoCorrect={false}
          autoCapitalize="none"
        />

        <FlatList
          data={data}
          keyExtractor={(item) => item.code ?? `label-${item.label}`}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.list}
          initialNumToRender={14}
          windowSize={10}
          ListEmptyComponent={
            <Text variant="body" color={colors.inkFaint} style={styles.empty}>
              No country matches that. Try the first few letters, or the dialling code.
            </Text>
          }
          renderItem={({ item }) => {
            if (item.label) {
              return (
                <Text variant="meta" color={colors.inkFaint} style={styles.sectionLabel}>
                  {item.label}
                </Text>
              );
            }
            const selected = item.code === value;
            return (
              <Pressable
                onPress={() => {
                  onSelect(item.code);
                  close();
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${item.name}, ${item.dial}`}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <Text allowFontScaling={false} style={styles.flag}>
                  {flagEmoji(item.code)}
                </Text>
                <Text
                  variant={selected ? 'option' : 'body'}
                  color={selected ? colors.accent : colors.ink}
                  style={{ flex: 1 }}
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
                <Text variant="meta" color={colors.inkFaint}>
                  {item.dial}
                </Text>
                {selected ? (
                  <Icon name="check" size={16} color={colors.accent} />
                ) : (
                  <View style={styles.checkSpacer} />
                )}
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.canvas },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: layout.gutter,
    paddingRight: space.sm,
    paddingVertical: space.sm,
  },
  search: { marginHorizontal: layout.gutter, marginBottom: space.sm },
  list: { paddingHorizontal: layout.gutter, paddingBottom: space.xl },
  sectionLabel: { marginTop: space.lg, marginBottom: space.xs, textTransform: 'uppercase', letterSpacing: 0.6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 52,
    paddingHorizontal: space.md,
    borderRadius: layout.radiusInput,
  },
  rowPressed: { backgroundColor: colors.sunken },
  flag: { fontSize: 22, lineHeight: 28 },
  checkSpacer: { width: 16 },
  empty: { paddingTop: space.xxl, textAlign: 'center' },
});
