import { Stack } from 'expo-router';

import { stackOptions } from '@/components/nav';

export default function StudentLayout() {
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="class/[id]" options={{ title: 'My class' }} />
      <Stack.Screen name="quiz/[id]" options={{ title: 'Quiz' }} />
      <Stack.Screen name="quiz/take/[id]" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="quiz/result/[id]" options={{ title: 'Quiz results', headerBackVisible: false, gestureEnabled: false }} />
      <Stack.Screen name="assignments" options={{ title: 'Assignments' }} />
      <Stack.Screen name="announcements" options={{ title: 'Announcements' }} />
      <Stack.Screen name="attendance" options={{ title: 'My attendance' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
    </Stack>
  );
}
