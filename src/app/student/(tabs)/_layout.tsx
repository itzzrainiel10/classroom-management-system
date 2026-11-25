import { Tabs } from 'expo-router';

import { tabIcon, tabOptions } from '@/components/nav';

export default function StudentTabs() {
  return (
    <Tabs screenOptions={tabOptions}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon('home') }} />
      <Tabs.Screen name="classes" options={{ title: 'Classes', tabBarIcon: tabIcon('book') }} />
      <Tabs.Screen name="quizzes" options={{ title: 'Quizzes', tabBarIcon: tabIcon('create') }} />
      <Tabs.Screen name="schedule" options={{ title: 'Schedule', tabBarIcon: tabIcon('calendar') }} />
    </Tabs>
  );
}
