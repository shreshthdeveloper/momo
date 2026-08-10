import { Stack } from 'expo-router';
import ConsoleShell from '../../src/components/ConsoleShell.jsx';
import { colors, motion } from '../../src/theme/console.js';

/**
 * The platform operator's console — the superadmin's whole app.
 *
 * Same sidebar shell as the organization console, for the same reason: a dock
 * of five could not carry the platform's operations, so announcements, the
 * audit trail and tenant plans had no door at all despite being fully built on
 * the server. Listing them IS the fix.
 */
/** `tone` is the domain hue the sidebar draws each section in. */
const SECTIONS = [
  {
    title: 'Platform',
    tone: 'platform',
    base: 'super',
    items: [
      { route: 'index', label: 'Pulse', icon: 'bolt' },
      { route: 'announce', label: 'Announcement', icon: 'megaphone' },
      { route: 'audit', label: 'Audit trail', icon: 'history' },
    ],
  },
  {
    title: 'People',
    tone: 'people',
    base: 'super',
    items: [
      { route: 'tenants', label: 'Organizations', icon: 'building', match: ['tenants', 'tenant-new'] },
      { route: 'users', label: 'Users', icon: 'friends' },
    ],
  },
  /**
   * The Central Bank, as a bank rather than as a single read-only page.
   *
   * This section was one row — a topic list with a feature toggle — while the
   * operator's actual content job (make a category, make a topic, bring in a
   * CSV, clear the queue behind it) had no door anywhere in the platform
   * console. The endpoints existed the whole time and the organization console
   * has had these four screens since F8.2; the platform console simply never
   * listed them. Listing them IS the fix, and they are the SAME screens: see
   * `useConsoleSpace`.
   */
  {
    title: 'Central bank',
    tone: 'content',
    base: 'super',
    items: [
      { route: 'central', label: 'Overview', icon: 'chart' },
      { route: 'topics', label: 'Topics', icon: 'grid', match: ['topics', 'topic-edit'] },
      { route: 'questions', label: 'Questions', icon: 'book', match: ['questions', 'question-edit'] },
      { route: 'review', label: 'Review queue', icon: 'check' },
      { route: 'import', label: 'Import CSV', icon: 'download' },
    ],
  },
  {
    title: 'Progression',
    tone: 'learning',
    base: 'super',
    items: [{ route: 'progression', label: 'Ladder & rewards', icon: 'ranks' }],
  },
  {
    title: 'Oversight',
    tone: 'oversight',
    base: 'super',
    items: [{ route: 'moderation', label: 'Reports', icon: 'shield' }],
  },
];

export default function SuperLayout() {
  return (
    <ConsoleShell sections={SECTIONS} title="Mimo platform">
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
