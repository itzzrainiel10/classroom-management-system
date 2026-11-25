import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { colors } from '@/constants/theme';
import type { Role } from '@/lib/auth';

const SEAL = require('../../assets/images/splash-icon.png');
const BG = require('../../assets/images/cvsu.jpg');
const GOLD = '#ffea00';
const PAGE = '#ffffff'; // warm off-white the photo fades into

function RoleCard({ role, title, body, icon, delay }: { role: Role; title: string; body: string; icon: 'school-outline' | 'person-outline'; delay: number }) {
  return (
    <Animated.View entering={FadeInUp.delay(delay).duration(500)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={() => router.push({ pathname: '/sign-in', params: { role } })}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
        <View style={styles.iconRing}>
          <Ionicons name={icon} size={22} color={colors.primary} />
        </View>
        <View style={{ flex: 1, gap: 2, alignItems: 'center' }}>
          <Text style={styles.cardTitle}>{title}</Text>
          {body ? <Text style={styles.cardBody}>{body}</Text> : null}
        </View>
        {/* same width as the icon so the name sits exactly in the middle */}
        <View style={{ width: 46, alignItems: 'flex-end' }}>
          <View style={styles.arrow}>
            <Ionicons name="arrow-forward" size={16} color={colors.onPrimary} />
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export default function Welcome() {
  const { width: w, height: h } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = h < 720;
  const heroH = Math.round(h * (compact ? 0.53 : 0.58));
  const seal = compact ? 100 : 130;

  return (
    <View style={styles.root}>
      {/* Campus photo that fades into the page */}
      <View style={{ height: heroH, overflow: 'hidden' }}>
        <Image source={BG} style={{ position: 'absolute', top: 0, left: 0, width: w, height: heroH }} resizeMode="cover" accessibilityIgnoresInvertColors />
        <Svg width={w} height={heroH} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#0B2E1F" stopOpacity="0.78" />
              <Stop offset="0.55" stopColor="#0E3A28" stopOpacity="0.62" />
              <Stop offset="0.86" stopColor="#164B35" stopOpacity="0.55" />
              <Stop offset="1" stopColor={PAGE} stopOpacity="1" />
            </LinearGradient>
          </Defs>
          <Rect width={w} height={heroH} fill="url(#fade)" />
        </Svg>

        <View style={[styles.hero, { paddingTop: insets.top + 100, paddingBottom: compact ? 36 : 52 }]}>
          <Animated.View entering={FadeIn.duration(700)} style={{ marginBottom: 6 }}>
            <Image source={SEAL} style={{ width: seal, height: seal }} resizeMode="contain" accessibilityLabel="Cavite State University seal" />
          </Animated.View>
          <Animated.Text entering={FadeInDown.delay(150).duration(600)} style={styles.uni}>
            CAVITE STATE UNIVERSITY
          </Animated.Text>
          <Animated.View entering={FadeIn.delay(300).duration(600)} style={styles.rule}>
            <View style={styles.ruleLine} />
            <View style={styles.ruleDot} />
            <View style={styles.ruleLine} />
          </Animated.View>
          <Animated.Text entering={FadeInDown.delay(350).duration(650)} style={[styles.title, compact && { fontSize: 26, lineHeight: 31 }]}>
            Classroom{'\n'}Management System
          </Animated.Text>
        </View>
      </View>

      {/* Choose how to continue */}
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 15 }]}>
        <Animated.View entering={FadeInUp.delay(350).duration(550)} style={{ gap: 3 }}>
          <Text style={styles.kicker}>WELCOME!</Text>
          <Text style={styles.heading}>Let's Get You Signed In!</Text>
        </Animated.View>
        <View style={{ gap: 15 }}>
          <RoleCard delay={550} role="student" icon="person-outline" title="Student" body="" />
          <RoleCard delay={650} role="instructor" icon="school-outline" title="Instructor" body="" />
        </View>
        <Animated.Text entering={FadeIn.delay(800).duration(600)} style={styles.footer}>
          Truth · Excellence · Service
        </Animated.Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: PAGE, overflow: 'hidden' },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 10 },

  
  uni: { color: GOLD, fontWeight: '700', letterSpacing: 3.2, fontSize: 12.5 },
  rule: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ruleLine: { width: 34, height: 1, backgroundColor: 'rgba(250, 189, 5, 0.7)' },
  ruleDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: GOLD },
  title: {
    color: '#ffffff',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.4,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  sheet: { flex: 1, justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 4 },
  kicker: { color: colors.primary, fontSize: 15, fontWeight: '800', letterSpacing: 2.2 },
  heading: { color: '#111713', fontSize: 21, fontWeight: '700', letterSpacing: -0.3 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 15,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5EBE6',
    boxShadow: '0px 1px 2px rgba(22,43,32,0.05), 0px 8px 22px rgba(22,43,32,0.07)',
  },
  cardPressed: { transform: [{ scale: 0.985 }], borderColor: colors.primary, backgroundColor: '#F3F8F4' },
  iconRing: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#DCE9DF', alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 19, fontWeight: '700', color: '#111713', letterSpacing: -0.2, textAlign: 'center' },
  cardBody: { fontSize: 13.5, color: '#48514C', lineHeight: 18, textAlign: 'center' },
  arrow: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  footer: { color: '#68716B', fontSize: 12, fontWeight: '600', letterSpacing: 1.2, textAlign: 'center', marginTop: 6 },
});
