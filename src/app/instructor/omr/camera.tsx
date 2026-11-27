import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import { colors, themed } from '@/constants/theme';
import { omrQueue, preparePhoto } from '@/lib/omr';

const TIPS = [
  'Place the answer sheet on a flat surface.',
  'Fit the whole sheet inside the frame — all 4 black squares visible.',
  'Hold the phone directly above the sheet.',
  'Avoid shadows and glare.',
  'Keep the camera steady while capturing.',
];

/** Camera for OMR: framing guide, flash, front/back, capture → preview → retake or add to the scan queue. */
export default function OmrCamera() {
  const { examId, title } = useLocalSearchParams<{ examId: string; title?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<'off' | 'on' | 'torch'>('off');
  const [busy, setBusy] = useState(false);
  const [shot, setShot] = useState<string | null>(null);
  const [tip, setTip] = useState(0);
  const [count, setCount] = useState(omrQueue.get().filter((q) => q.examId === examId).length);

  useEffect(() => {
    const t = setInterval(() => setTip((x) => (x + 1) % TIPS.length), 3500);
    return () => clearInterval(t);
  }, []);

  if (!permission) return <View style={styles.dark} />;
  if (!permission.granted) {
    return (
      <View style={[styles.dark, styles.center, { padding: 28, gap: 14 }]}>
        <Ionicons name="camera-outline" size={44} color="#fff" />
        <Text style={styles.permTitle}>Camera access needed</Text>
        <Text style={styles.permBody}>The OMR scanner uses the camera to photograph answer sheets. Photos are uploaded only to your class’s private storage.</Text>
        <Button title="Allow camera" icon="camera" onPress={requestPermission} />
        <Button title="Back" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  // A4 guide frame (portrait), as large as fits.
  const frameW = Math.min(W - 48, (H - 260) * (210 / 297));
  const frameH = frameW * (297 / 210);

  const capture = async () => {
    if (!cam.current || busy) return;
    setBusy(true);
    try {
      const pic = await cam.current.takePictureAsync({ quality: 0.9, skipProcessing: false });
      if (pic) setShot(await preparePhoto(pic.uri, pic.width, pic.height));
    } finally {
      setBusy(false);
    }
  };

  if (shot) {
    return (
      <View style={[styles.dark, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.previewTitle}>Check the photo</Text>
        <Text style={styles.previewSub}>All four black corner squares sharp and visible? Bubbles readable, no glare?</Text>
        <Image source={{ uri: shot }} style={{ flex: 1, margin: 16, borderRadius: 12 }} resizeMode="contain" />
        <View style={styles.previewRow}>
          <Button title="Retake" icon="refresh" variant="secondary" style={{ flex: 1 }} onPress={() => setShot(null)} />
          <Button
            title="Use photo"
            icon="checkmark"
            style={{ flex: 1 }}
            onPress={() => {
              omrQueue.add(shot, examId);
              setCount((n) => n + 1);
              setShot(null);
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.dark}>
      <CameraView ref={cam} style={StyleSheet.absoluteFill} facing={facing} flash={flash === 'on' ? 'on' : 'off'} enableTorch={flash === 'torch'} animateShutter />
      {/* Darkened surround + A4 frame with corner brackets */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
        <View style={{ width: frameW, height: frameH }}>
          {(['tl', 'tr', 'br', 'bl'] as const).map((c) => (
            <View key={c} style={[styles.bracket, styles[c]]} />
          ))}
        </View>
      </View>

      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.round} hitSlop={8} accessibilityLabel="Close camera">
          <Ionicons name="close" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.topTitle} numberOfLines={1}>
            {title ?? 'Scan answer sheets'}
          </Text>
          <Text style={styles.topSub}>{count ? `${count} in the scan queue` : 'Line the sheet up with the frame'}</Text>
        </View>
        <Pressable
          onPress={() => setFlash(flash === 'off' ? 'on' : flash === 'on' ? 'torch' : 'off')}
          style={styles.round}
          hitSlop={8}
          accessibilityLabel={`Flash: ${flash}`}>
          <Ionicons name={flash === 'off' ? 'flash-off' : flash === 'on' ? 'flash' : 'flashlight'} size={20} color="#fff" />
        </Pressable>
        <Pressable onPress={() => setFacing(facing === 'back' ? 'front' : 'back')} style={styles.round} hitSlop={8} accessibilityLabel="Switch camera">
          <Ionicons name="camera-reverse-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 18 }]}>
        <View style={styles.tip}>
          <Ionicons name="information-circle-outline" size={16} color="#fff" />
          <Text style={styles.tipText}>{TIPS[tip]}</Text>
        </View>
        <View style={styles.shutterRow}>
          <Pressable onPress={() => router.back()} style={styles.doneBtn} accessibilityLabel="Done">
            <Text style={styles.doneText}>{count ? 'Done' : 'Cancel'}</Text>
          </Pressable>
          <Pressable onPress={capture} style={({ pressed }) => [styles.shutter, pressed && { transform: [{ scale: 0.94 }] }]} accessibilityLabel="Capture" disabled={busy}>
            {busy ? <ActivityIndicator color={colors.primary} /> : <View style={styles.shutterInner} />}
          </Pressable>
          <View style={{ width: 72 }} />
        </View>
        <Text style={styles.flashHint}>Flash: {flash === 'off' ? 'off' : flash === 'on' ? 'on when capturing' : 'light always on'}</Text>
      </View>
    </View>
  );
}

const B = 34;
const styles = themed(() => StyleSheet.create({
  dark: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  permTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  permBody: { color: 'rgba(255,255,255,0.8)', textAlign: 'center', lineHeight: 20 },
  bracket: { position: 'absolute', width: B, height: B, borderColor: '#E9C24A' },
  tl: { left: 0, top: 0, borderLeftWidth: 4, borderTopWidth: 4, borderTopLeftRadius: 8 },
  tr: { right: 0, top: 0, borderRightWidth: 4, borderTopWidth: 4, borderTopRightRadius: 8 },
  br: { right: 0, bottom: 0, borderRightWidth: 4, borderBottomWidth: 4, borderBottomRightRadius: 8 },
  bl: { left: 0, bottom: 0, borderLeftWidth: 4, borderBottomWidth: 4, borderBottomLeftRadius: 8 },
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 10, backgroundColor: 'rgba(0,0,0,0.45)' },
  topTitle: { color: '#fff', fontWeight: '700', fontSize: 15 },
  topSub: { color: 'rgba(255,255,255,0.75)', fontSize: 12 },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 12, gap: 12, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  tip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)', marginHorizontal: 16 },
  tipText: { color: '#fff', fontSize: 12.5, fontWeight: '600' },
  shutterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingHorizontal: 28 },
  doneBtn: { width: 72, height: 40, alignItems: 'flex-start', justifyContent: 'center' },
  doneText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  shutter: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: 'rgba(255,255,255,0.5)' },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff', borderWidth: 2, borderColor: '#164B35' },
  flashHint: { color: 'rgba(255,255,255,0.6)', fontSize: 11.5 },
  previewTitle: { color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  previewSub: { color: 'rgba(255,255,255,0.75)', fontSize: 13, textAlign: 'center', marginTop: 4, paddingHorizontal: 20 },
  previewRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 16 },
}));
