import { Tabs } from 'expo-router';
import ConsoleDock from '../../src/components/ConsoleDock.jsx';
import { colors } from '../../src/theme/index.js';

/**
 * The admin console is its own app: when an organization admin signs in they
 * land here, not in the player tabs (an admin runs the game, they do not
 * play it). Four tabs cover the daily jobs; everything else — editors,
 * forms, settings — pushes on top with a back arrow.
 */
const TABS = [
  { name: 'index', label: 'Home', icon: 'home' },
  { name: 'students', label: 'Students', icon: 'friends' },
  { name: 'questions', label: 'Bank', icon: 'book' },
  { name: 'reports', label: 'Reports', icon: 'target' },
];

export default function AdminLayout() {
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
      {/* Pushed screens — reachable, never in the dock. */}
      {['review', 'topics', 'topic-edit', 'question-edit', 'import', 'contests', 'contest-new', 'assignments', 'assignment-new', 'invite', 'settings'].map(
        (name) => (
          <Tabs.Screen key={name} name={name} options={{ href: null }} />
        ),
      )}
    </Tabs>
  );
}
