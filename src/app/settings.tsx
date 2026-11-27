import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { router, type Href } from 'expo-router';
import { Children, Fragment, useState, type ReactNode } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Label, Screen, Segmented, type IconName } from '@/components/ui';
import { TEXT_SCALES, colors, radius, resetA11y, setA11y, shadow, themed, useA11y, type ThemeChoice } from '@/constants/theme';
import { useRemote } from '@/hooks/use-remote';
import { useAuth } from '@/lib/auth';
import { fetchMyRenewal } from '@/lib/renewal';

/**
 * Settings: profile card, then labelled groups (Account, Preferences) of same-size rows, and
 * Sign out set apart at the bottom — the same layout as the websites' profile menu.
 */
export default function Settings() {
  const { fullName, email, role, signOut } = useAuth();
  const renewal = useRemote('my-renewal', fetchMyRenewal).data;
  const isStudent = role === 'student';
  const renewStatus = !renewal?.open
    ? 'Opens when the next semester starts'
    : renewal.renewal?.status === 'approved'
      ? isStudent
        ? `Renewed${renewal.renewal.assigned_section_name ? ` · ${renewal.renewal.assigned_section_name}` : ''}`
        : 'Confirmed for this semester'
      : renewal.renewal?.status === 'pending'
        ? 'Sent · waiting for the administrator'
        : renewal.renewal?.status === 'rejected'
          ? 'Not approved · tap to send again'
          : `Not yet done for ${renewal.label}`;
  const a = useA11y();
  // Changing the theme re-draws every screen; remember that the popup was open so it stays open.
  const [sheet, setSheetState] = useState(() => a11ySheetOpen);
  const setSheet = (open: boolean) => {
    a11ySheetOpen = open;
    setSheetState(open);
  };
  const i = TEXT_SCALES.indexOf(a.scale);
  const initials =
    (fullName || email || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?';

  const confirmSignOut = () =>
    Alert.alert('Log out?', 'You can log back in any time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: signOut },
    ]);

  return (
    <Screen>
      <View style={styles.profile}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.name} numberOfLines={1}>
            {fullName || 'My account'}
          </Text>
          {email ? (
            <Text style={styles.email} numberOfLines={1}>
              {email}
            </Text>
          ) : null}
          <View style={styles.rolePill}>
            <Text style={styles.roleText}>{role === 'instructor' ? 'Instructor' : role === 'student' ? 'Student' : 'Account'}</Text>
          </View>
        </View>
      </View>

      <Section title="Account">
        <Row
          icon={isStudent ? 'school-outline' : 'checkmark-done-outline'}
          title={isStudent ? 'Renew Enrollment' : 'Confirm Status'}
          subtitle={renewStatus}
          onPress={renewal?.open ? () => router.push(`/${isStudent ? 'student' : 'instructor'}/renew` as Href) : undefined}
          chevron={!!renewal?.open}
        />
        <Row
          icon="archive-outline"
          title={isStudent ? 'My Semesters' : 'Previous Semesters'}
          subtitle={isStudent ? 'Grades and attendance from past semesters' : 'Classes you handled before'}
          onPress={() => router.push(`/${isStudent ? 'student' : 'instructor'}/semesters` as Href)}
          chevron
        />
        <Row icon="key-outline" title="Reset password" subtitle="Get a code by email and set a new password" onPress={() => router.push('/change-password')} chevron />
      </Section>

      <Section title="Preferences">
        <Row
          icon="accessibility-outline"
          title="Accessibility"
          subtitle={`${Math.round(a.scale * 100)}% text · ${a.theme === 'system' ? 'Device' : a.theme === 'dark' ? 'Dark' : 'Light'} theme · ${a.contrast === 'high' ? 'High' : 'Standard'} contrast`}
          onPress={() => setSheet(true)}
          chevron
        />
      </Section>

      <Pressable onPress={confirmSignOut} accessibilityRole="button" style={({ pressed }) => [styles.signOut, pressed && { backgroundColor: colors.dangerSoft }]}>
        <Ionicons name="log-out-outline" size={18} color={colors.danger} />
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
      <Text style={styles.version}>CvSU Classroom Management System · v{Constants.expoConfig?.version ?? '1.0.0'}</Text>
      <Modal visible={sheet} transparent animationType="slide" onRequestClose={() => setSheet(false)} statusBarTranslucent>
        <Pressable style={styles.sheetBackdrop} onPress={() => setSheet(false)} accessibilityLabel="Close accessibility" />
        <View style={styles.sheet}>
          <View style={styles.sheetGrip} />
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Accessibility</Text>
            <Pressable onPress={() => setSheet(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Done" style={styles.sheetDone}>
              <Text style={styles.sheetDoneText}>Done</Text>
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 460 }}>
            <View style={styles.group}>
              <Row
                icon="text"
                title="Text size"
                subtitle="Make words bigger or smaller"
                right={
                  <View style={styles.stepper}>
                    <StepButton label="−" a11y="Smaller text" disabled={i <= 0} onPress={() => setA11y({ scale: TEXT_SCALES[i - 1] })} />
                    <Text style={styles.stepValue}>{Math.round(a.scale * 100)}%</Text>
                    <StepButton label="+" a11y="Larger text" disabled={i >= TEXT_SCALES.length - 1} onPress={() => setA11y({ scale: TEXT_SCALES[i + 1] })} />
                  </View>
                }
              />
              <Row icon="moon-outline" title="Theme" subtitle="“Device” follows your phone’s setting">
                <Segmented<ThemeChoice>
                  small
                  options={[
                    { label: 'Light', value: 'light' },
                    { label: 'Dark', value: 'dark' },
                    { label: 'Device', value: 'system' },
                  ]}
                  value={a.theme}
                  onChange={(theme) => setA11y({ theme })}
                />
              </Row>
              <Row icon="contrast-outline" title="Color contrast" subtitle="High uses darker text and stronger outlines">
                <Segmented<'normal' | 'high'>
                  small
                  options={[
                    { label: 'Standard', value: 'normal' },
                    { label: 'High', value: 'high' },
                  ]}
                  value={a.contrast}
                  onChange={(contrast) => setA11y({ contrast })}
                />
              </Row>
              <Row icon="refresh" title="Reset accessibility" subtitle="Back to normal text, light theme, standard contrast" onPress={resetA11y} chevron />
            </View>
          </ScrollView>
        </View>
      </Modal>
    </Screen>
  );
}

let a11ySheetOpen = false;

/** Label + white card; rows inside are separated by hairlines. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const rows = Children.toArray(children);
  return (
    <View style={{ gap: 8 }}>
      <Label style={{ marginLeft: 4 }}>{title}</Label>
      <View style={styles.group}>
        {rows.map((row, n) => (
          <Fragment key={n}>
            {n > 0 ? <View style={styles.divider} /> : null}
            {row}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

/** One settings row: icon (or custom leading), title, description, right-side control, optional control below. */
function Row({
  icon,
  leading,
  title,
  subtitle,
  right,
  chevron,
  danger,
  onPress,
  children,
}: {
  icon?: IconName;
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  chevron?: boolean;
  danger?: boolean;
  onPress?: () => void;
  children?: ReactNode;
}) {
  const tint = danger ? colors.danger : colors.primary;
  const body = (
    <>
      <View style={styles.rowTop}>
        {leading ?? (
          <View style={[styles.rowIcon, danger && { backgroundColor: colors.dangerSoft }]}>
            <Ionicons name={icon ?? 'ellipse-outline'} size={18} color={tint} />
          </View>
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.rowTitle, danger && { color: colors.danger }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.rowSub} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right}
        {chevron ? <Ionicons name="chevron-forward" size={18} color={danger ? colors.danger : colors.muted} /> : null}
      </View>
      {children ? <View style={styles.rowBelow}>{children}</View> : null}
    </>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && { backgroundColor: danger ? colors.dangerSoft : colors.primarySoft }]}>
      {body}
    </Pressable>
  ) : (
    <View style={styles.row}>{body}</View>
  );
}

function StepButton({ label, onPress, disabled, a11y }: { label: string; onPress: () => void; disabled: boolean; a11y: string }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={({ pressed }) => [styles.stepBtn, disabled && { opacity: 0.35 }, pressed && { backgroundColor: colors.primarySoft }]}>
      <Text style={styles.stepText}>{label}</Text>
    </Pressable>
  );
}

const ICON = 36;
const GAP = 12;
const PAD = 16;

const styles = themed(() =>
  StyleSheet.create({
    group: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, overflow: 'hidden', ...shadow.sm },
    // Divider starts where the text starts, so icons line up in one column.
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginLeft: PAD + ICON + GAP },

    row: { paddingHorizontal: PAD, paddingVertical: 12, gap: 10 },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: GAP },
    rowBelow: { marginLeft: ICON + GAP },
    rowIcon: { width: ICON, height: ICON, borderRadius: radius.sm, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
    rowTitle: { color: colors.text, fontSize: 15.5, fontWeight: '700' },
    rowSub: { color: colors.textSoft, fontSize: 12.5, lineHeight: 17 },

    profile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      padding: 16,
      borderRadius: radius.lg,
      backgroundColor: colors.primarySoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
    },
    avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#164B35', alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: '#FFFFFF', fontSize: 19, fontWeight: '800' },
    name: { color: colors.text, fontSize: 17, fontWeight: '800' },
    email: { color: colors.textSoft, fontSize: 13 },
    rolePill: { alignSelf: 'flex-start', marginTop: 4, backgroundColor: '#164B35', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 2 },
    roleText: { color: '#FFFFFF', fontSize: 11.5, fontWeight: '800', letterSpacing: 0.3 },
    signOut: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      height: 50,
      borderRadius: radius.md,
      borderWidth: 1.5,
      borderColor: colors.dangerLine,
      backgroundColor: colors.card,
    },
    signOutText: { color: colors.danger, fontSize: 15.5, fontWeight: '800' },
    sheetBackdrop: { flex: 1, backgroundColor: 'rgba(10, 20, 15, 0.45)' },
    sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: 16, paddingBottom: 34, paddingTop: 8, gap: 10, ...shadow.lg },
    sheetGrip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line },
    sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
    sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
    sheetDone: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
    sheetDoneText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
    version: { textAlign: 'center', color: colors.muted, fontSize: 12 },

    stepper: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.track, borderRadius: radius.sm, padding: 2 },
    stepBtn: { width: 28, height: 26, borderRadius: 8, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
    stepText: { color: colors.primary, fontSize: 15, fontWeight: '800', lineHeight: 17 },
    stepValue: { minWidth: 40, textAlign: 'center', color: colors.text, fontSize: 12.5, fontWeight: '800' },
  }),
);
