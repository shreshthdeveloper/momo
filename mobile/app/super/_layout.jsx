import { Tabs } from 'expo-router';
import ConsoleDock from '../../src/components/ConsoleDock.jsx';
import { colors } from '../../src/theme/index.js';

/**
 * The platform operator's console — the superadmin's whole app. Tenants of
 * every kind live under Organizations; the central question bank and
 * moderation get their own doors; Platform is the pulse.
 */
const TABS = [
  { name: 'index', label: 'Platform', icon: 'bolt' },
  { name: 'tenants', label: 'Orgs', icon: 'grid' },
  { name: 'central', label: 'Bank', icon: 'book' },
  /** Progression is configuration now — the ladder gets its own door. */
  { name: 'progression', label: 'Ladder', icon: 'ranks' },
  { name: 'moderation', label: 'Reports', icon: 'flag' },
];

export default function SuperLayout() {
  return (
    <Tabs
      tabBar={(props) => <ConsoleDock tabs={TABS} {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.sunken },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />
      ))}
      <Tabs.Screen name="tenant-new" options={{ href: null }} />
    </Tabs>
  );
}
