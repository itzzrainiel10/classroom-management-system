import { Tabs } from 'expo-router';

import { tabIcon, screenLayout, tabOptions } from '@/components/nav';
import { useThemeVersion } from '@/constants/theme';

export default function StudentTabs() {
  useThemeVersion(); // re-apply tab bar colors after a theme change
  return (
    <Tabs screenOptions={tabOptions} screenLayout={screenLayout}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon('home') }} />
      <Tabs.Screen name="classes" options={{ title: 'Classes', tabBarIcon: tabIcon('book') }} />
      <Tabs.Screen name="quizzes" options={{ title: 'Quizzes', tabBarIcon: tabIcon('create') }} />
      <Tabs.Screen name="schedule" options={{ title: 'Schedule', tabBarIcon: tabIcon('calendar') }} />
    </Tabs>
  );
}
