import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Bell } from '@/components/notifications';
import { colors, themed } from '@/constants/theme';

const SEAL = require('../../assets/images/splash-icon.png');

/** Decorative layer for green headers: a faint university seal. Place first inside the green container. */
export function HeroBackdrop({ sealSize = 220 }: { sealSize?: number }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {sealSize > 0 ? <Image source={SEAL} style={[styles.watermark, { width: sealSize, height: sealSize, right: -sealSize * -0., top: -18 }]} resizeMode="contain" /> : null}
    </View>
  );
}

export function HeroLogoWatermark({ size = 180 }: { size?: number }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Image source={SEAL} style={{ position: 'absolute', width: size, height: size, right: -size * 0.0, top: -size * 0.1, opacity: 0.08 }} resizeMode="contain" />
    </View>
  );
}

/** Top row of a dashboard header: small seal + "CvSU · ROLE" on the left, notifications and Settings on the right. */
export function HeroTopBar({ role, onSettings, onSignOut, onBell, showLogo = true }: { role: string; onSettings?: () => void; onSignOut?: () => void; onBell?: () => void; showLogo?: boolean }) {
  return (
    <View style={styles.top}>
      <View style={styles.brand}>
        {showLogo ? <Image source={SEAL} style={styles.brandSeal} resizeMode="contain" /> : null}
        <View>
          <Text style={styles.brandName}>CvSU CMS</Text>
          <Text style={styles.brandRole}>{role.toUpperCase()}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {onBell ? <Bell onPress={onBell} /> : null}
        <Pressable onPress={onSettings ?? onSignOut} hitSlop={8} accessibilityLabel={onSettings ? 'Settings' : 'Log out'} style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}>
          <Ionicons name={onSettings ? 'settings-outline' : 'log-out-outline'} size={20} color={colors.onPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  watermark: { position: 'absolute', opacity: 0.07 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandSeal: { width: 34, height: 34 },
  brandName: { color: colors.onPrimary, fontWeight: '800', fontSize: 14, letterSpacing: 0.2 },
  brandRole: { color: colors.gold, fontWeight: '800', fontSize: 10, letterSpacing: 1.4 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
