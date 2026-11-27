import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, Tabs } from 'expo-router';
import { Fragment, type ComponentProps, type ReactElement } from 'react';
import type { ColorValue } from 'react-native';

import { colors, getA11y, shadow, useThemeVersion } from '@/constants/theme';

/** Header look for stack screens. A function, so it always uses the current theme and text size. */
export const headerOptions = () =>
  ({
    headerStyle: { backgroundColor: colors.background },
    headerTintColor: colors.primary,
    headerTitleStyle: { fontWeight: '700', fontSize: 17 * getA11y().scale, color: colors.text },
    headerShadowVisible: false,
    headerBackButtonDisplayMode: 'minimal',
    contentStyle: { backgroundColor: colors.background },
  }) as const;

export const stackOptions: ComponentProps<typeof Stack>['screenOptions'] = () => headerOptions();

export const tabOptions: ComponentProps<typeof Tabs>['screenOptions'] = () => ({
  headerShown: false,
  tabBarActiveTintColor: colors.primary,
  tabBarInactiveTintColor: colors.muted,
  tabBarStyle: { backgroundColor: colors.card, borderTopWidth: 0, paddingTop: 6, ...shadow.md },
  tabBarLabelStyle: { fontWeight: '700', fontSize: 11 * getA11y().scale, letterSpacing: 0.2 },
  sceneStyle: { backgroundColor: colors.background },
});

/** Re-draws a screen when the theme or text size changes (navigation history is kept). */
function ThemedScreen({ children }: { children: ReactElement }) {
  const v = useThemeVersion();
  return <Fragment key={v}>{children}</Fragment>;
}

// Routes that hold another navigator: their own screens re-draw themselves.
const NESTED = new Set(['student', 'instructor', '(tabs)']);

/** Pass as `screenLayout` on every navigator. */
export const screenLayout = ({ route, children }: { route: { name: string }; children: ReactElement }) =>
  NESTED.has(route.name) ? children : <ThemedScreen>{children}</ThemedScreen>;

type IconName = ComponentProps<typeof Ionicons>['name'];
export const tabIcon =
  (name: IconName) =>
  ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={String(color ?? '')} size={size} />;
