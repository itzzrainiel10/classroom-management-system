import { Stack } from 'expo-router';

import { screenLayout, stackOptions } from '@/components/nav';
import { useThemeVersion } from '@/constants/theme';

export default function StudentLayout() {
  useThemeVersion(); // re-apply header colors after a theme change
  return (
    <Stack screenOptions={stackOptions} screenLayout={screenLayout}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="class/[id]" options={{ title: 'My class' }} />
      <Stack.Screen name="quiz/[id]" options={{ title: 'Quiz' }} />
      <Stack.Screen name="quiz/take/[id]" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="quiz/result/[id]" options={{ title: 'Quiz results', headerBackVisible: false, gestureEnabled: false }} />
      <Stack.Screen name="assignments" options={{ title: 'Assignments' }} />
      <Stack.Screen name="announcements" options={{ title: 'Announcements' }} />
      <Stack.Screen name="attendance" options={{ title: 'My attendance' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="semesters" options={{ title: 'My Semesters' }} />
      <Stack.Screen name="renew" options={{ title: 'Renew Enrollment' }} />
      <Stack.Screen name="semester/[id]" options={{ title: 'Semester records' }} />
    </Stack>
  );
}
