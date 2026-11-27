import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';

import { colors, themed } from '@/constants/theme';

const SEAL = require('../../assets/images/splash-icon.png');
const MIN_MS = 1600;

/**
 * Branded splash: starts exactly like the native splash (green + CvSU seal), then animates
 * the title in and fades away once the app is ready.
 */
export function AnimatedSplash({ ready }: { ready: boolean }) {
  const [gone, setGone] = useState(false);
  const [minDone, setMinDone] = useState(false);
  const seal = useRef(new Animated.Value(0)).current;
  const title = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;

  const start = () => {
    SplashScreen.hideAsync();
    Animated.sequence([
      Animated.spring(seal, { toValue: 1, friction: 6, tension: 60, useNativeDriver: true }),
      Animated.timing(title, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
    Animated.loop(Animated.timing(bar, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true })).start();
    setTimeout(() => setMinDone(true), MIN_MS);
  };

  useEffect(() => {
    if (!ready || !minDone) return;
    Animated.timing(fade, { toValue: 0, duration: 380, useNativeDriver: true }).start(() => setGone(true));
  }, [ready, minDone, fade]);

  if (gone) return null;

  const sealScale = seal.interpolate({ inputRange: [0, 1], outputRange: [1, 0.82] });
  const sealY = seal.interpolate({ inputRange: [0, 1], outputRange: [0, -40] });
  const titleY = title.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });
  const barX = bar.interpolate({ inputRange: [0, 1], outputRange: [-60, 120] });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, { opacity: fade }]} pointerEvents={ready && minDone ? 'none' : 'auto'}>
      <Animated.View style={{ transform: [{ translateY: sealY }, { scale: sealScale }] }}>
        <Image source={SEAL} style={styles.seal} onLoadEnd={start} resizeMode="contain" />
      </Animated.View>
      <Animated.View style={[styles.textBlock, { opacity: title, transform: [{ translateY: titleY }] }]}>
        <Text style={styles.uni}>CAVITE STATE UNIVERSITY</Text>
        <Text style={styles.title}>Classroom Management{'\n'}System</Text>
        <View style={styles.track}>
          <Animated.View style={[styles.bar, { transform: [{ translateX: barX }] }]} />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  seal: { width: 180, height: 180 },
  textBlock: { position: 'absolute', top: '58%', alignItems: 'center', gap: 8 },
  uni: { color: colors.gold, fontWeight: '800', letterSpacing: 2, fontSize: 12 },
  title: { color: colors.onPrimary, fontSize: 24, fontWeight: '800', textAlign: 'center', lineHeight: 30 },
  track: { width: 120, height: 4, borderRadius: 2, backgroundColor: colors.onPrimarySoft, overflow: 'hidden', marginTop: 12, opacity: 0.6 },
  bar: { width: 60, height: 4, borderRadius: 2, backgroundColor: colors.gold },
}));
