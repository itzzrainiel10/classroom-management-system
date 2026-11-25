import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Bell } from '@/components/notifications';
import type { IconName } from '@/components/ui';
import { colors } from '@/constants/theme';

/**
 * Compact dashboard pieces that match the admin website: flat green top bar with a gold line,
 * plain page title, stat boxes with a green top edge, and bordered panels with a grey header strip.
 */

const SEAL = require('../../assets/images/splash-icon.png');
const BORDER = '#D5DDD7';

/** Full-width green bar at the very top (place first inside <Screen>). */
export function DashTopBar({ role, onBell, onSignOut }: { role: string; onBell?: () => void; onSignOut: () => void }) {
  return (
    <View style={styles.top}>
      <Image source={SEAL} style={styles.seal} resizeMode="contain" />
      <View style={{ flex: 1 }}>
        <Text style={styles.topName}>Cavite State University</Text>
        <Text style={styles.topSub}>Classroom Management System · {role}</Text>
      </View>
      {onBell ? <Bell onPress={onBell} /> : null}
      <Pressable onPress={onSignOut} hitSlop={8} accessibilityLabel="Log out" style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}>
        <Ionicons name="log-out-outline" size={18} color={colors.onPrimary} />
      </Pressable>
    </View>
  );
}

export function DashTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.title}>
      <Text style={styles.titleText}>{title}</Text>
      {subtitle ? <Text style={styles.titleSub}>{subtitle}</Text> : null}
    </View>
  );
}

/** Two stat boxes per row. */
export function StatGrid({ items }: { items: { label: string; value: string | number; sub?: string }[] }) {
  return (
    <View style={styles.grid}>
      {items.map((s) => (
        <View key={s.label} style={styles.tile}>
          <Text style={styles.tileLabel}>{s.label}</Text>
          <Text style={styles.tileValue}>{s.value}</Text>
          {s.sub ? (
            <Text style={styles.tileSub} numberOfLines={1}>
              {s.sub}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function Panel({ title, right, children, pad }: { title: string; right?: ReactNode; children: ReactNode; pad?: boolean }) {
  return (
    <View style={styles.panel}>
      <View style={styles.panelHead}>
        <Text style={styles.panelTitle}>{title}</Text>
        {right}
      </View>
      <View style={pad ? { padding: 12, gap: 8 } : undefined}>{children}</View>
    </View>
  );
}

/** One tappable line inside a Panel. */
export function PanelRow({ icon, title, body, onPress, badge, last }: { icon: IconName; title: string; body?: string; onPress: () => void; badge?: string; last?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.row, !last && styles.rowLine, pressed && { backgroundColor: '#F1F4F2' }]}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {body ? (
          <Text style={styles.rowBody} numberOfLines={1}>
            {body}
          </Text>
        ) : null}
      </View>
      {badge ? <Text style={styles.badge}>{badge}</Text> : null}
      <Ionicons name="chevron-forward" size={16} color={colors.muted} />
    </Pressable>
  );
}

export function PanelLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.primary,
    borderBottomWidth: 3,
    borderBottomColor: colors.gold,
    marginHorizontal: -20,
    marginTop: -20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  seal: { width: 32, height: 32 },
  topName: { color: colors.onPrimary, fontWeight: '700', fontSize: 13.5 },
  topSub: { color: 'rgba(255,255,255,0.8)', fontSize: 11 },
  iconBtn: { width: 36, height: 36, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  title: { paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 1 },
  titleText: { fontSize: 19, fontWeight: '600', color: colors.text },
  titleSub: { fontSize: 12, color: colors.textSoft },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: BORDER,
    borderTopWidth: 3,
    borderTopColor: colors.primary,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tileLabel: { fontSize: 11.5, color: colors.textSoft },
  tileValue: { fontSize: 20, fontWeight: '600', color: colors.text },
  tileSub: { fontSize: 11, color: colors.textSoft },
  panel: { backgroundColor: colors.card, borderWidth: 1, borderColor: BORDER, borderRadius: 6, overflow: 'hidden' },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#F8FAF8',
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  panelTitle: { fontSize: 13.5, fontWeight: '600', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: colors.line },
  rowTitle: { fontSize: 13.5, fontWeight: '600', color: colors.text },
  rowBody: { fontSize: 11.5, color: colors.textSoft },
  badge: { fontSize: 11, fontWeight: '700', color: colors.text, backgroundColor: colors.gold, borderRadius: 3, paddingHorizontal: 6, overflow: 'hidden' },
  link: { fontSize: 12.5, fontWeight: '600', color: colors.primary },
});
