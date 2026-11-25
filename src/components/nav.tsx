import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { colors, shadow } from '@/constants/theme';

export const stackOptions: ComponentProps<typeof Stack>['screenOptions'] = {
  headerStyle: { backgroundColor: colors.background },
  headerTintColor: colors.primary,
  headerTitleStyle: { fontWeight: '700', fontSize: 17, color: colors.text },
  headerShadowVisible: false,
  headerBackButtonDisplayMode: 'minimal',
  contentStyle: { backgroundColor: colors.background },
};

export const tabOptions: ComponentProps<typeof Tabs>['screenOptions'] = {
  headerShown: false,
  tabBarActiveTintColor: colors.primary,
  tabBarInactiveTintColor: colors.muted,
  tabBarStyle: { backgroundColor: colors.card, borderTopWidth: 0, paddingTop: 6, ...shadow.md },
  tabBarLabelStyle: { fontWeight: '700', fontSize: 11, letterSpacing: 0.2 },
  sceneStyle: { backgroundColor: colors.background },
};

type IconName = ComponentProps<typeof Ionicons>['name'];
export const tabIcon =
  (name: IconName) =>
  ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={String(color ?? '')} size={size} />;
