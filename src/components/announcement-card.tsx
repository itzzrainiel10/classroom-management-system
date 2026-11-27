import { StyleSheet, Text, View } from 'react-native';

import { Body, Card, H2 } from '@/components/ui';
import { colors, radius, themed } from '@/constants/theme';
import type { Announcement } from '@/lib/data';
import { fmtDate } from '@/lib/format';

/** One announcement: who posted it (instructor name), when, which class, then the message. */
export function AnnouncementCard({ a, classLabel, fallbackName = 'Your instructor' }: { a: Announcement; classLabel?: string; fallbackName?: string }) {
  const name = a.author_name?.trim() || fallbackName;
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || 'I';
  return (
    <Card style={{ gap: 10 }}>
      <View style={styles.head}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            Instructor · {a._pending ? 'Sending…' : fmtDate(a.created_at)}
          </Text>
        </View>
        {classLabel ? (
          <View style={styles.classPill}>
            <Text style={styles.classText} numberOfLines={1}>
              {classLabel}
            </Text>
          </View>
        ) : null}
      </View>
      <H2>{a.title}</H2>
      {a.message ? <Body>{a.message}</Body> : null}
    </Card>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: colors.onPrimary, fontSize: 13, fontWeight: '800' },
    name: { color: colors.text, fontSize: 14.5, fontWeight: '800' },
    meta: { color: colors.textSoft, fontSize: 12 },
    classPill: { maxWidth: 120, backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
    classText: { color: colors.primary, fontSize: 11.5, fontWeight: '800' },
  }),
);
