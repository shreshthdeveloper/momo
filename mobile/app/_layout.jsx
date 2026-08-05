import { useCallback, useEffect } from 'react';
import { View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
/**
 * Imported from the per-weight entry points, not the package index.
 *
 * The index re-exports every weight of a family and Metro bundles every asset
 * it can reach, which put 6MB of unused TTFs in the binary. These five faces
 * are the entire type system (design.md §4.1), and the audience is on
 * mid-range Android over 4G — the download is not free.
 */
import Inter_400Regular from '@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf';
import Inter_500Medium from '@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf';
import Inter_600SemiBold from '@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf';
import Poppins_600SemiBold from '@expo-google-fonts/poppins/600SemiBold/Poppins_600SemiBold.ttf';
import Poppins_700Bold from '@expo-google-fonts/poppins/700Bold/Poppins_700Bold.ttf';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider, useAuth } from '../src/state/auth.jsx';
import { useConsolePath } from '../src/lib/admin.js';
import { GameProvider } from '../src/state/game.jsx';
import { ProgressionProvider } from '../src/state/progression.jsx';
import { NotificationsProvider } from '../src/state/notifications.jsx';
import { SessionProvider } from '../src/state/session.jsx';
import NotificationBanner from '../src/components/NotificationBanner.jsx';
import ErrorBoundary from '../src/components/ErrorBoundary.jsx';
import Splash from '../src/components/Splash.jsx';
import { colors, motion } from '../src/theme/index.js';

SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * design.md §7 — navigation is quiet. The match is not. So screen transitions
 * are a plain 240ms horizontal slide, and every bit of motion budget is spent
 * inside the match instead.
 */
/** The sign-up screens, in order. Reaching any of them is not "done". */
const ONBOARDING_STEPS = ['profile', 'avatar', 'country', 'organization', 'interests'];

function RootNavigator() {
  const { booting, isAuthenticated, needsProfile, onboardingStep } = useAuth();
  const consolePath = useConsolePath();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (booting) return;
    const inAuthGroup = segments[0] === '(auth)';

    // Sign-up runs over several screens and saves as it goes, so a name
    // exists from step one onward. Without this the guard below would call
    // the profile complete and eject the player mid-flow, between picking a
    // face and picking a country.
    const inOnboarding = inAuthGroup && ONBOARDING_STEPS.includes(segments[1]);

    /**
     * A manager never sees the player sign-up: their whole onboarding is the
     * name, after which `profile.jsx` sends them to their console. Only a
     * player is resumed through the remaining steps.
     */
    const resumeStep = consolePath ? null : onboardingStep;

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/welcome');
    } else if (isAuthenticated && needsProfile && !inOnboarding) {
      router.replace('/(auth)/profile');
    } else if (isAuthenticated && !needsProfile && resumeStep && !inOnboarding) {
      // Killed mid-flow. Pick it up where it stopped rather than stranding the
      // account half-made.
      router.replace(`/(auth)/${resumeStep}`);
    } else if (isAuthenticated && !needsProfile && !resumeStep) {
      // Each account lands in ITS app. A manager signs in to run the game —
      // the player experience is not theirs; a player never sees a console.
      const inPlayerApp = segments[0] === '(tabs)' || segments[0] === 'match' || segments[0] === 'play';
      const inConsole = segments[0] === 'admin' || segments[0] === 'super';
      if (inAuthGroup) {
        if (!inOnboarding) router.replace(consolePath ?? '/');
      } else if (consolePath && inPlayerApp) {
        router.replace(consolePath);
      } else if (!consolePath && inConsole) {
        router.replace('/');
      }
    }
  }, [booting, isAuthenticated, needsProfile, onboardingStep, consolePath, segments, router]);

  // Nothing mounts until the stored session has been confirmed. A screen that
  // rendered first would fire its own fetch without a token and land on the
  // sign-in wall a moment before the redirect corrects it. This is the exact
  // field the splash on top of it uses, so there is no seam underneath and no
  // frame of another colour if the splash fades a beat early.
  if (booting) return <View style={{ flex: 1, backgroundColor: colors.night }} />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        animationDuration: motion.screen,
        contentStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      {/* The match flow has no back gesture — leaving forfeits, and that has to
          go through the confirmation in play.jsx. */}
      <Stack.Screen name="match/searching" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="match/versus" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="match/play" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="match/result" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="topic/[id]" />
      <Stack.Screen name="review/[matchId]" />
      {/* Phase 3 (prd.md F7.4, F7.5). Ordinary pushed screens — navigation
          stays quiet, per design.md §7. */}
      <Stack.Screen name="contest/[id]" />
      <Stack.Screen name="assignments" />
      <Stack.Screen name="settings" />
      {/* What the account level has handed over, and what is next
          (leagues-and-progression.md §5). Pushed from the profile, from
          Your look, and from a level-up on the result screen. */}
      <Stack.Screen name="achievements" />
      <Stack.Screen name="leaderboard" />
      {/* prd.md §6.9 — the in-app list, reached from the bell on Home. */}
      <Stack.Screen name="notifications" />
      {/* The two lists the profile previews five of. */}
      <Stack.Screen name="my-topics" />
      <Stack.Screen name="history" />
      {/* The revision deck — the questions you got wrong and have not since got
          right. Reached from the banner on Play, and a row per subject inside. */}
      <Stack.Screen name="mistakes" />
      {/* Class against class, inside an organization. */}
      <Stack.Screen name="class-table" />
      {/* The brackets in this organization, and one of them. */}
      <Stack.Screen name="tournaments" />
      <Stack.Screen name="tournament/[id]" />
      {/**
       * A live class session.
       *
       * `gestureEnabled: false` for the same reason a match has it: swiping back
       * out of a question you are being timed on, in front of a class, is not a
       * gesture anybody meant to make. Leaving is the header's back button, which
       * tells the room.
       */}
      <Stack.Screen name="session" options={{ gestureEnabled: false }} />
      <Stack.Screen name="join" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  const onReady = useCallback(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    onReady();
  }, [onReady]);

  // A font failure must not brick the app — it falls back to the system face.
  // Until then this renders nothing and the native splash stays up, so the
  // first thing drawn in the app's own type is already correct.
  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <SafeAreaProvider>
        <AuthProvider>
          {/* Outside the game so the sign-up avatar picker has the catalogue
              before there is an account, and every screen resolves an uploaded
              face the same way. */}
          <ProgressionProvider>
            <GameProvider>
              {/* Inside the game provider: the banner has to know whether a
                  match is on the board, because the one place it must never
                  appear is over a question with a clock running. */}
              <NotificationsProvider>
                {/* Inside the game provider too, and for the same reason: a live
                    class session rides on the game socket rather than opening a
                    second one — thirty phones on one classroom access point is
                    the constraint the whole feature has to survive. */}
                <SessionProvider>
                  <Boot />
                </SessionProvider>
              </NotificationsProvider>
            </GameProvider>
          </ProgressionProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * The handoff from the native splash to the app.
 *
 * `booting` is a network round trip — restoring tokens and confirming the
 * session against `/me` — so on a cold start over 4G it is the longest wait in
 * the product. The in-app splash covers exactly that, and the status bar
 * stays light throughout — one night field throughout.
 */
function Boot() {
  const { booting } = useAuth();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      {/**
       * Around the navigator, not around the whole app.
       *
       * Everything above this point — the providers, the fonts, the splash — has
       * to survive a screen blowing up, or "Try again" would remount the session
       * and sign the player out to recover from a bad render. Inside it is every
       * screen, which is where the throws are.
       *
       * Home is the offer rather than "back", because a boundary catches on the
       * way UP: whatever route threw is still the current one, and going back to
       * it is how a player gets a loop instead of a way out.
       */}
      <ErrorBoundary onGoHome={() => router.replace('/')}>
        <RootNavigator />
      </ErrorBoundary>
      {/* Above every screen and below the splash: it announces things that
          arrive while the player is somewhere else, which is everywhere. */}
      {booting ? null : <NotificationBanner />}
      <Splash ready={!booting} />
    </View>
  );
}
