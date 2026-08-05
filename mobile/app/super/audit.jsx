import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { Text, Badge, EmptyState, ErrorNotice, Header, useScrollBottom } from '../../src/components/ui.jsx';
import { ListSkeleton } from '../../src/components/Skeletons.jsx';
import { colors, consoleLayout, space } from '../../src/theme/index.js';

/**
 * prd.md F9.1.4 — the platform audit trail.
 *
 * Every admin action and every impersonation session is written to `AuditLog`
 * and `GET /super/audit` has always returned them; an organization's own audit
 * was shown in its console while the PLATFORM's — the one that records what we
 * did to a tenant, including signing in as one of their admins — could only be
 * read from the database. Impersonated rows are marked, because that is the
 * whole reason a superadmin audit exists.
 */
export default function SuperAudit() {
  const scrollBottom = useScrollBottom();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.get('/super/audit');
      setRows(data.items ?? []);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Audit trail" subtitle="The last 200 actions" />

      <ErrorNotice error={error} onRetry={load} />

      {!rows && !error ? (
        <ListSkeleton rows={8} />
      ) : rows?.length === 0 ? (
        <EmptyState
          icon="history"
          title="Nothing recorded yet"
          body="Admin actions and impersonation sessions appear here as they happen."
        />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: scrollBottom }]}
          showsVerticalScrollIndicator={false}
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
          {(rows ?? []).map((row) => (
            <View key={row.id} style={styles.row}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.head}>
                  <Text variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {row.action}
                  </Text>
                  {row.impersonated ? <Badge label="Impersonated" tone="danger" /> : null}
                </View>
                <Text variant="meta" color={colors.inkMuted} numberOfLines={2}>
                  {row.summary || '—'}
                </Text>
                <Text variant="tiny" color={colors.inkFaint} numberOfLines={1}>
                  {[row.actor, row.space, new Date(row.at).toLocaleString()]
                    .filter(Boolean)
                    .join('  ·  ')}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  list: { paddingHorizontal: consoleLayout.gutter, paddingTop: space.md },
  row: {
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
