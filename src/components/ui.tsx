import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { colors, radius, shadow, text } from '@/constants/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Screen({
  children,
  onRefresh,
  refreshing = false,
  footer,
}: {
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  footer?: ReactNode;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.screenContent}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}>
        {children}
      </ScrollView>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

/** "CvSU / INSTRUCTOR" breadcrumb + title, as on every CMS screen. */
export function AppHeader({ crumb, title, subtitle, right }: { crumb: string; title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.crumbChip}>
        <View style={styles.crumbDot} />
        <Text style={styles.crumb}>CvSU  ·  {crumb.toUpperCase()}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={text.display}>{title}</Text>
          {subtitle ? <Text style={text.caption}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
    </View>
  );
}

export function Card({
  children,
  style,
  tone = 'plain',
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: 'plain' | 'primary' | 'soft' | 'gold';
}) {
  return <View style={[styles.card, tone !== 'plain' && toneStyles[tone], style]}>{children}</View>;
}

const toneStyles = StyleSheet.create({
  primary: { backgroundColor: colors.primary, borderColor: colors.primary, ...shadow.primary },
  soft: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft, boxShadow: 'none' },
  gold: { backgroundColor: colors.goldSoft, borderColor: '#F3E3A0' },
});

type TextProps = { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number };
export const H1 = (p: TextProps) => <Text {...p} style={[text.h1, p.style]} />;
export const H2 = (p: TextProps) => <Text {...p} style={[text.h2, p.style]} />;
export const Body = (p: TextProps) => <Text {...p} style={[text.body, p.style]} />;
export const Caption = (p: TextProps) => <Text {...p} style={[text.caption, p.style]} />;
export const Label = (p: TextProps) => <Text {...p} style={[text.label, p.style]} />;
export const OnPrimary = (p: TextProps & { size?: 'lg' | 'sm' }) => (
  <Text {...p} style={[p.size === 'lg' ? styles.onPrimaryLg : styles.onPrimarySm, p.style]} />
);

const buttonVariants = {
  primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary, lift: shadow.primary },
  gold: { bg: colors.gold, fg: colors.text, border: colors.gold, lift: shadow.sm },
  secondary: { bg: colors.card, fg: colors.text, border: colors.line, lift: shadow.sm },
  ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent', lift: undefined },
  danger: { bg: colors.card, fg: colors.danger, border: '#F2D3CF', lift: undefined },
} as const;

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  iconRight,
  disabled,
  loading,
  style,
  small,
}: {
  title: string;
  onPress?: () => void;
  variant?: keyof typeof buttonVariants;
  icon?: IconName;
  iconRight?: IconName;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const v = buttonVariants[variant];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: v.bg, borderColor: v.border },
        !small && !(disabled || loading) && v.lift,
        pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
        (disabled || loading) && { opacity: 0.5 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={small ? 16 : 18} color={v.fg} /> : null}
          <Text style={[styles.buttonText, small && { fontSize: 14 }, { color: v.fg }]}>{title}</Text>
          {iconRight ? <Ionicons name={iconRight} size={small ? 16 : 18} color={v.fg} /> : null}
        </>
      )}
    </Pressable>
  );
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        {...props}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        style={[styles.input, focused && styles.inputFocused, props.multiline && { minHeight: 96, textAlignVertical: 'top' }, props.style]}
      />
      {hint ? <Caption>{hint}</Caption> : null}
    </View>
  );
}

export function Pill({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'green' | 'gold' | 'red' }) {
  const t = {
    muted: { bg: colors.background, fg: colors.textSoft, border: colors.line },
    green: { bg: colors.primarySoft, fg: colors.primary, border: colors.primarySoft },
    gold: { bg: colors.goldSoft, fg: '#7A5F00', border: colors.goldSoft },
    red: { bg: colors.dangerSoft, fg: colors.danger, border: colors.dangerSoft },
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg, borderColor: t.border }]}>
      <Text style={[styles.pillText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

/** Draft or live for students; exams are labelled. */
export function QuizStatusPill({ status, kind }: { status: 'draft' | 'published'; kind?: string }) {
  const what = kind === 'exam' ? 'Exam · ' : '';
  return status === 'draft' ? <Pill label={`${what}Draft`} tone="muted" /> : <Pill label={`${what}Published`} tone="green" />;
}

export function Stat({ label, value, style }: { label: string; value: string; style?: StyleProp<ViewStyle> }) {
  return (
    <Card style={[{ flex: 1, gap: 2, paddingVertical: 14, paddingHorizontal: 14 }, style]}>
      <Text style={styles.statValue}>{value}</Text>
      <Caption numberOfLines={1}>{label}</Caption>
    </Card>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 12 }, style]}>{children}</View>;
}

export function ListCard({ children }: { children: ReactNode }) {
  return <View style={styles.listCard}>{children}</View>;
}

export function ListItem({
  title,
  subtitle,
  right,
  icon,
  onPress,
  last,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  icon?: IconName;
  onPress?: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.listItem, last && { borderBottomWidth: 0 }, pressed && { backgroundColor: colors.primarySoft }]}>
      {icon ? (
        <View style={styles.listIcon}>
          <Ionicons name={icon} size={18} color={colors.primary} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <H2 numberOfLines={1}>{title}</H2>
        {subtitle ? <Caption numberOfLines={2}>{subtitle}</Caption> : null}
      </View>
      {right}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}
    </Pressable>
  );
}

export function Empty({ icon, title, body, children }: { icon: IconName; title: string; body: string; children?: ReactNode }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: 28, gap: 8 }}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={26} color={colors.primary} />
      </View>
      <H2 style={{ textAlign: 'center' }}>{title}</H2>
      <Caption style={{ textAlign: 'center', maxWidth: 280 }}>{body}</Caption>
      {children ? <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 8 }}>{children}</View> : null}
    </Card>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable key={String(o.value)} onPress={() => onChange(o.value)} style={[styles.segment, active && styles.segmentActive]}>
            <Text numberOfLines={1} style={[styles.segmentText, active && { color: colors.primary }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ProgressBar({ value, tone = 'gold' }: { value: number; tone?: 'gold' | 'green' }) {
  const w = `${Math.max(0, Math.min(1, value)) * 100}%` as const;
  return (
    <View style={styles.track}>
      <View style={[styles.bar, { width: w, backgroundColor: tone === 'gold' ? colors.gold : colors.primary }]} />
    </View>
  );
}

/** Shown when a screen is using the copy saved on the phone. */
export function OfflineNote({ show, savedAt }: { show: boolean; savedAt: string | null }) {
  if (!show) return null;
  return (
    <View style={styles.offline}>
      <Ionicons name="cloud-offline-outline" size={16} color={colors.textSoft} />
      <Caption style={{ flex: 1 }}>
        You’re offline — showing what’s saved on this phone{savedAt ? ` (${new Date(savedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})` : ''}.
      </Caption>
    </View>
  );
}

export function Loading() {
  return (
    <View style={{ paddingVertical: 40, alignItems: 'center' }}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: 20, gap: 16, paddingBottom: 56 },
  footer: { padding: 16, paddingBottom: 28, backgroundColor: colors.card, ...shadow.lg },
  crumbChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  crumbDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.gold },
  crumb: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.1, color: colors.primary },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, ...shadow.sm },
  onPrimaryLg: { color: colors.onPrimary, fontSize: 26, fontWeight: '800', letterSpacing: -0.6, lineHeight: 32 },
  onPrimarySm: { color: colors.onPrimarySoft, fontSize: 14, lineHeight: 20 },
  button: {
    minHeight: 52,
    borderRadius: radius.md,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
  },
  buttonSmall: { minHeight: 40, paddingHorizontal: 14, borderRadius: radius.sm },
  buttonText: { fontSize: 16, fontWeight: '700', letterSpacing: 0.1 },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
  },
  inputFocused: { borderColor: colors.primary, boxShadow: '0px 0px 0px 3px rgba(7, 91, 57, 0.12)' },
  pill: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', borderWidth: 1 },
  pillText: { fontSize: 12, fontWeight: '700' },
  statValue: { fontSize: 26, fontWeight: '800', color: colors.primary, letterSpacing: -0.6 },
  listCard: { borderRadius: radius.lg, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, backgroundColor: colors.card, ...shadow.sm },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    backgroundColor: colors.card,
  },
  listIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { width: 60, height: 60, borderRadius: radius.pill, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  segmented: { flexDirection: 'row', backgroundColor: '#E8EDE9', borderRadius: radius.md, padding: 4, gap: 4 },
  segment: { flex: 1, paddingVertical: 10, paddingHorizontal: 4, borderRadius: radius.sm, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.card, ...shadow.sm },
  segmentText: { fontSize: 14, fontWeight: '700', color: colors.textSoft },
  track: { height: 8, borderRadius: radius.pill, backgroundColor: colors.mint, overflow: 'hidden' },
  bar: { height: 8, borderRadius: radius.pill },
  offline: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12, borderRadius: radius.md, backgroundColor: colors.goldSoft },
});
