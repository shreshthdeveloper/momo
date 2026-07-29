import { Stack } from 'expo-router';
import ConsoleShell from '../../src/components/ConsoleShell.jsx';
import { colors, motion } from '../../src/theme/index.js';

/**
 * The platform operator's console — the superadmin's whole app.
 *
 * Same sidebar shell as the organization console, for the same reason: a dock
 * of five could not carry the platform's operations, so announcements, the
 * audit trail and tenant plans had no door at all despite being fully built on
 * the server. Listing them IS the fix.
 */
const SECTIONS = [
  {
    title: 'Platform',
    base: 'super',
    items: [
      { route: 'index', label: 'Pulse', icon: 'bolt' },
      { route: 'announce', label: 'Announcement', icon: 'megaphone' },
      { route: 'audit', label: 'Audit trail', icon: 'history' },
    ],
  },
  {
    title: 'People',
    base: 'super',
    items: [
      { route: 'tenants', label: 'Organizations', icon: 'building', match: ['tenants', 'tenant-new'] },
      { route: 'users', label: 'Users', icon: 'friends' },
    ],
  },
  {
    title: 'Content',
    base: 'super',
    items: [{ route: 'central', label: 'Central bank', icon: 'book' }],
  },
  {
    title: 'Progression',
    base: 'super',
    items: [{ route: 'progression', label: 'Ladder & rewards', icon: 'ranks' }],
  },
  {
    title: 'Oversight',
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
