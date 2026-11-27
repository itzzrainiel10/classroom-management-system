import { Stack } from 'expo-router';

import { screenLayout, stackOptions } from '@/components/nav';
import { useThemeVersion } from '@/constants/theme';

export default function InstructorLayout() {
  useThemeVersion(); // re-apply header colors after a theme change
  return (
    <Stack screenOptions={stackOptions} screenLayout={screenLayout}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="class/[id]" options={{ title: 'Manage class' }} />
      <Stack.Screen name="quiz/new" options={{ title: 'Create quiz' }} />
      <Stack.Screen name="quiz/[id]" options={{ title: 'Monitor results' }} />
      <Stack.Screen name="assignment" options={{ title: 'Post assignment' }} />
      <Stack.Screen name="announcement" options={{ title: 'Announcements' }} />
      <Stack.Screen name="schedule-new" options={{ title: 'Extra class meeting' }} />
      <Stack.Screen name="attendance" options={{ title: 'Attendance' }} />
      <Stack.Screen name="omr/index" options={{ title: 'OMR Scanner' }} />
      <Stack.Screen name="omr/camera" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
      <Stack.Screen name="omr/review/[id]" options={{ title: 'Review answer sheet' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="grade/[id]" options={{ title: 'Grade answers' }} />
      <Stack.Screen name="semesters" options={{ title: 'Previous Semesters' }} />
      <Stack.Screen name="renew" options={{ title: 'Confirm Status' }} />
      <Stack.Screen name="semester/[id]" options={{ title: 'Semester' }} />
      <Stack.Screen name="archived-class/[id]" options={{ title: 'Archived class' }} />
    </Stack>
  );
}
