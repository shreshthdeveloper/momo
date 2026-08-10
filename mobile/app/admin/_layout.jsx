import { Stack } from 'expo-router';
import ConsoleShell from '../../src/components/ConsoleShell.jsx';
import { useAdminSpace } from '../../src/lib/admin.js';
import { colors, motion } from '../../src/theme/console.js';

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
/**
 * `tone` names the DOMAIN each section belongs to, and the sidebar draws its
 * rows in that hue — see the note in `ConsoleShell`. The five are fixed in the
 * theme so the same domain is the same colour in both consoles.
 */
const SECTIONS = [
  {
    title: 'Organization',
    tone: 'platform',
    base: 'admin',
    items: [{ route: 'index', label: 'Overview', icon: 'home' }],
  },
  {
    title: 'Content',
    tone: 'content',
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
    tone: 'people',
    base: 'admin',
    items: [
      { route: 'students', label: 'Students', icon: 'friends', match: ['students', 'student-detail'] },
      { route: 'batches', label: 'Batches', icon: 'grid' },
      { route: 'invite', label: 'Invite code', icon: 'share' },
    ],
  },
  {
    title: 'Learning',
    tone: 'learning',
    base: 'admin',
    items: [
      { route: 'contests', label: 'Contests', icon: 'trophy', match: ['contests', 'contest-new', 'contest-edit'] },
      {
        route: 'assignments',
        label: 'Assignments',
        icon: 'calendar',
        match: ['assignments', 'assignment-new', 'assignment-detail'],
      },
      /**
       * The two event shapes, beside the two paper shapes.
       *
       * A live session is a lesson and a bracket is a competition, but from this
       * console both are "a thing you set up and then run", which is what
       * Learning already means here.
       */
      {
        route: 'sessions',
        label: 'Live sessions',
        icon: 'play',
        match: ['sessions', 'session-report'],
      },
      {
        route: 'tournaments',
        label: 'Tournaments',
        icon: 'ranks',
        match: ['tournaments', 'tournament-detail'],
      },
    ],
  },
  {
    title: 'Oversight',
    tone: 'oversight',
    base: 'admin',
    items: [
      { route: 'reports', label: 'Reports', icon: 'chart' },
      { route: 'moderation', label: 'Reported questions', icon: 'shield' },
      /**
       * The organization's own audit, which had no door. Forty rows of it were
       * printed at the bottom of Settings, under the team list, under the join
       * code, under everything — so Settings scrolled forever and the log was
       * unsearchable. Settings keeps five; this is the rest.
       */
      { route: 'audit', label: 'Activity log', icon: 'history' },
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
