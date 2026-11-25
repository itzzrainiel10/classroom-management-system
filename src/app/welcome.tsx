import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Image, ImageBackground, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import type { Role } from '@/lib/auth';

const SEAL = require('../../assets/images/splash-icon.png');
const BG = require('../../assets/images/cvsu.jpg');
const GOLD = '#E9C24A';

function RoleCard({ role, title, body, icon }: { role: Role; title: string; body: string; icon: 'school' | 'person' }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={() => router.push({ pathname: '/sign-in', params: { role } })}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
      <View style={styles.iconTile}>
        <Ionicons name={icon} size={26} color={colors.primary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardBody}>{body}</Text>
      </View>
      <Ionicons name="chevron-forward" size={22} color={colors.muted} />
    </Pressable>
  );
}

export default function Welcome() {
  const { height: h } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const seal = h < 720 ? 96 : 130;

  return (
    <ImageBackground source={BG} style={styles.root} resizeMode="cover">
      <View style={styles.tint} />
      <View style={[styles.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.hero}>
          <Image source={SEAL} style={{ width: seal, height: seal }} resizeMode="contain" accessibilityLabel="Cavite State University seal" />
          <Text style={styles.uni}>CAVITE STATE UNIVERSITY</Text>
          <Text style={styles.title}>Classroom{'\n'}Management System</Text>
        </View>

        <View style={styles.sheet}>
          <RoleCard role="instructor" icon="school" title="I’m an Instructor" body="Manage classes, quizzes and results." />
          <RoleCard role="student" icon="person" title="I’m a Student" body="Join classes, take quizzes, see scores." />
          <Text style={styles.footer}>TRUTH • EXCELLENCE • SERVICE</Text>
        </View>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primaryDark },
  tint: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(4, 61, 38, 0.72)' },
  content: { flex: 1, justifyContent: 'space-between' },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 12 },
  uni: { color: GOLD, fontWeight: '800', letterSpacing: 3, fontSize: 13 },
  title: { color: colors.onPrimary, fontSize: 30, fontWeight: '800', textAlign: 'center', lineHeight: 36 },
  sheet: { paddingHorizontal: 20, gap: 12 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 18,
    backgroundColor: colors.card,
  },
  iconTile: { width: 50, height: 50, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  cardBody: { fontSize: 14, color: colors.textSoft },
  footer: { color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '700', letterSpacing: 2, textAlign: 'center', marginTop: 8 },
});
