import { Stack } from 'expo-router';

import { stackOptions } from '@/components/nav';

export default function InstructorLayout() {
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="class/new" options={{ title: 'New class', presentation: 'modal' }} />
      <Stack.Screen name="class/[id]" options={{ title: 'Manage class' }} />
      <Stack.Screen name="quiz/new" options={{ title: 'Create quiz' }} />
      <Stack.Screen name="quiz/[id]" options={{ title: 'Monitor results' }} />
      <Stack.Screen name="assignment" options={{ title: 'Post assignment' }} />
      <Stack.Screen name="announcement" options={{ title: 'Announcements' }} />
      <Stack.Screen name="schedule-new" options={{ title: 'Extra class meeting' }} />
      <Stack.Screen name="attendance" options={{ title: 'Attendance' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="grade/[id]" options={{ title: 'Grade answers' }} />
    </Stack>
  );
}
