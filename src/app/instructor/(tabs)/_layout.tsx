import { Tabs } from 'expo-router';

import { tabIcon, tabOptions } from '@/components/nav';

export default function InstructorTabs() {
  return (
    <Tabs screenOptions={tabOptions}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon('home') }} />
      <Tabs.Screen name="classes" options={{ title: 'Classes', tabBarIcon: tabIcon('people') }} />
      <Tabs.Screen name="results" options={{ title: 'Results', tabBarIcon: tabIcon('bar-chart') }} />
      <Tabs.Screen name="schedule" options={{ title: 'Schedule', tabBarIcon: tabIcon('calendar') }} />
    </Tabs>
  );
}
