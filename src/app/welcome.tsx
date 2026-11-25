import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HeroBackdrop } from '@/components/hero';
import { colors, radius, shadow } from '@/constants/theme';
import type { Role } from '@/lib/auth';

const SEAL = require('../../assets/images/splash-icon.png');

function RoleButton({ role, title, body, icon }: { role: Role; title: string; body: string; icon: 'school' | 'person' }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/sign-in', params: { role } })}
      style={({ pressed }) => [styles.role, pressed && styles.rolePressed]}>
      <View style={styles.roleIcon}>
        <Ionicons name={icon} size={22} color={colors.primary} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.roleTitle}>{title}</Text>
        <Text style={styles.roleBody}>{body}</Text>
      </View>
      <View style={styles.roleArrow}>
        <Ionicons name="arrow-forward" size={18} color={colors.onPrimary} />
      </View>
    </Pressable>
  );
}

export default function Welcome() {
  return (
    <View style={styles.root}>
      <HeroBackdrop sealSize={0} />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.top}>
          <View style={styles.halo}>
            <Image source={SEAL} style={styles.seal} resizeMode="contain" accessibilityLabel="Cavite State University seal" />
          </View>
          <Text style={styles.uni}>CAVITE STATE UNIVERSITY</Text>
          <Text style={styles.title}>Classroom{'\n'}Management System</Text>
          <Text style={styles.tagline}></Text>
        </View>
      </SafeAreaView>
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.sheetTitle}>Get started</Text>
        <Text style={styles.sheetLabel}></Text>
        <View style={{ gap: 12, marginTop: 6 }}>
          <RoleButton role="instructor" icon="school" title="I’m an Instructor" body="Manage classes, quizzes and results." />
          <RoleButton role="student" icon="person" title="I’m a Student" body="Join classes, take quizzes, see scores." />
        </View>
        <Text style={styles.footer}>Truth · Excellence · Service</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary, overflow: 'hidden' },
  top: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 10 },
  halo: {
    width: 148,
    height: 148,
    borderRadius: 74,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  seal: { width: 116, height: 116 },
  uni: { color: colors.gold, fontWeight: '800', letterSpacing: 2.4, fontSize: 11.5 },
  title: { color: colors.onPrimary, fontSize: 31, fontWeight: '800', textAlign: 'center', letterSpacing: -0.8, lineHeight: 37 },
  tagline: { color: colors.onPrimarySoft, fontSize: 14.5, textAlign: 'center', lineHeight: 21, maxWidth: 290, marginTop: 2 },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 36,
    gap: 4,
    ...shadow.lg,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.mint, marginBottom: 14 },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: colors.text, letterSpacing: -0.4 },
  sheetLabel: { fontSize: 14, color: colors.textSoft },
  role: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.md,
  },
  rolePressed: { transform: [{ scale: 0.985 }], backgroundColor: colors.primarySoft },
  roleIcon: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  roleTitle: { fontSize: 16, fontWeight: '800', color: colors.text, letterSpacing: -0.2 },
  roleBody: { fontSize: 13, color: colors.textSoft, lineHeight: 18 },
  roleArrow: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  footer: { textAlign: 'center', color: colors.muted, fontSize: 11.5, fontWeight: '700', letterSpacing: 1.2, marginTop: 18 },
});
