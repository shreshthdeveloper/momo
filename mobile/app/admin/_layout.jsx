import { Stack } from 'expo-router';
import ConsoleShell from '../../src/components/ConsoleShell.jsx';
import { useAdminSpace } from '../../src/lib/admin.js';
import { colors, motion } from '../../src/theme/index.js';

/**
 * The admin console is its own app: when an organization admin signs in they
 * land here, not in the player tabs (an admin runs the game, they do not play
 * it).
 *
 * Navigation is a SIDEBAR rather than a dock. A four-slot dock could show four
 * of this console's operations, and everything else — the review queue, the
 * import, contests, assignments, batches, moderation — was reachable only by
 * knowing it was there. The sidebar lists every one of them, which is the
 * whole point: the navigation doubles as the inventory of what an admin can
 * do here.
 */
const SECTIONS = [
  {
    title: 'Organization',
    base: 'admin',
    items: [{ route: 'index', label: 'Overview', icon: 'home' }],
  },
  {
    title: 'Content',
    base: 'admin',
    items: [
      // `match` is every route that belongs under this row, so an editor
      // pushed from a list keeps its own row lit rather than none at all.
      { route: 'questions', label: 'Question bank', icon: 'book', match: ['questions', 'question-edit'] },
      { route: 'topics', label: 'Topics', icon: 'grid', match: ['topics', 'topic-edit'] },
      { route: 'review', label: 'Review queue', icon: 'check' },
      { route: 'drafts', label: 'AI drafts', icon: 'robot' },
      { route: 'import', label: 'Import CSV', icon: 'download' },
    ],
  },
  {
    title: 'People',
    base: 'admin',
    items: [
      { route: 'students', label: 'Students', icon: 'friends' },
      { route: 'batches', label: 'Batches', icon: 'grid' },
      { route: 'invite', label: 'Invite code', icon: 'share' },
    ],
  },
  {
    title: 'Learning',
    base: 'admin',
    items: [
      { route: 'contests', label: 'Contests', icon: 'trophy', match: ['contests', 'contest-new', 'contest-edit'] },
      {
        route: 'assignments',
        label: 'Assignments',
        icon: 'calendar',
        match: ['assignments', 'assignment-new', 'assignment-detail'],
      },
    ],
  },
  {
    title: 'Oversight',
    base: 'admin',
    items: [
      { route: 'reports', label: 'Reports', icon: 'chart' },
      { route: 'moderation', label: 'Reported questions', icon: 'shield' },
      { route: 'settings', label: 'Settings', icon: 'gear' },
    ],
  },
];

export default function AdminLayout() {
  const adminSpace = useAdminSpace();

  return (
    <ConsoleShell sections={SECTIONS} title={adminSpace?.name ?? 'Console'}>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          animationDuration: motion.screen,
          contentStyle: { backgroundColor: colors.sunken },
        }}
      />
    </ConsoleShell>
  );
}
