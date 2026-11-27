import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';

import { AnimatedSplash } from '@/components/animated-splash';
import { headerOptions, screenLayout } from '@/components/nav';
import { colors, isDark, useThemeVersion } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/lib/auth';
import { LiveUpdates } from '@/lib/live';
import { OutboxProvider } from '@/lib/outbox';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <AuthProvider>
      <OutboxProvider>
        <LiveUpdates />
        <Root />
      </OutboxProvider>
    </AuthProvider>
  );
}

function Root() {
  const { status } = useAuth();
  useThemeVersion(); // re-draw with the new colors after a theme change
  const ready = status !== 'loading';
  return (
    <View style={{ flex: 1, backgroundColor: colors.primary }}>
      <StatusBar style={ready && !isDark() ? 'dark' : 'light'} />
      {ready ? <RootStack /> : null}
      <AnimatedSplash ready={ready} />
    </View>
  );
}

function RootStack() {
  const { status, role, application } = useAuth();
  const signedIn = status === 'signed-in';
  // Pending / rejected instructor applicants only get the application status screen.
  const applicant = signedIn && !role && !!application;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} screenLayout={screenLayout}>
      <Stack.Screen name="index" />
      <Stack.Screen name="auth-callback" />
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="welcome" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="forgot-password" />
      </Stack.Protected>
      <Stack.Protected guard={applicant}>
        <Stack.Screen name="application" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="settings" options={() => ({ ...headerOptions(), headerShown: true, title: 'Settings' })} />
        <Stack.Screen name="change-password" options={() => ({ ...headerOptions(), headerShown: true, title: 'Reset password' })} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && role === 'instructor'}>
        <Stack.Screen name="instructor" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && role === 'student'}>
        <Stack.Screen name="student" />
      </Stack.Protected>
    </Stack>
  );
}
