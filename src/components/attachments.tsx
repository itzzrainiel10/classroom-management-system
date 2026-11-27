import Ionicons from '@expo/vector-icons/Ionicons';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, themed } from '@/constants/theme';
import { attachmentUrl, fmtSize, type Attachment } from '@/lib/data';

const iconFor = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'webp', 'heic', 'gif'].includes(ext)) return 'image-outline' as const;
  if (ext === 'pdf') return 'document-text-outline' as const;
  if (ext === 'zip') return 'archive-outline' as const;
  return 'document-attach-outline' as const;
};

/** Tappable list of an assignment's files; opens each one in the in-app browser. */
export function AttachmentList({ items }: { items: Attachment[] }) {
  const [opening, setOpening] = useState<string | null>(null);
  if (!items.length) return null;
  const open = async (a: Attachment) => {
    setOpening(a.path);
    try {
      await WebBrowser.openBrowserAsync(await attachmentUrl(a));
    } catch (e) {
      Alert.alert('Could not open the file', e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(null);
    }
  };
  return (
    <View style={styles.list}>
      {items.map((a) => (
        <Pressable key={a.path} onPress={() => open(a)} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={`Open ${a.name}`}>
          <Ionicons name={iconFor(a.name)} size={16} color={colors.primary} />
          <Text style={styles.name} numberOfLines={1}>
            {a.name}
          </Text>
          <Text style={styles.size}>{fmtSize(a.size)}</Text>
          {opening === a.path ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="download-outline" size={15} color={colors.textSoft} />}
        </Pressable>
      ))}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  list: { gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.background },
  name: { flex: 1, fontSize: 13.5, fontWeight: '600', color: colors.text },
  size: { fontSize: 12, color: colors.muted },
}));
