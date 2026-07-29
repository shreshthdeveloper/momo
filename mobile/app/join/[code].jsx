import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * The invite link, landed on.
 *
 * `wms.distrx.io/join/<code>` is what an organization's invite carries, and
 * with no route for it the link opened a browser on a page nothing serves —
 * the whole invite loop, dead. This exists only to hand the code to the join
 * modal, which is where the actual flow lives; a screen of its own would be a
 * second copy of that screen kept in step by hand.
 */
export default function JoinByLink() {
  const { code } = useLocalSearchParams();
  const clean = String(code ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);

  return <Redirect href={clean ? `/join?code=${clean}` : '/join'} />;
}
