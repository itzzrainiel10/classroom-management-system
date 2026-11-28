import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Caption, Card, Empty, H2, Loading, OfflineNote, Row, Screen } from '@/components/ui';
import { colors, themed } from '@/constants/theme';
import { useRemote } from '@/hooks/use-remote';
import { fetchNotifications, markAllRead, type Notice } from '@/lib/data';
import { fmtDateTime } from '@/lib/format';

export function useNotifications() {
  return useRemote('notifications', fetchNotifications);
}

const iconFor = (n: Notice) => (n.kind === 'application' ? (n.title.includes('not') ? 'close-circle' : 'shield-checkmark') : n.kind === 'announcement_message' || n.kind === 'announcement_mention' ? 'chatbubbles-outline' : 'calendar');

export function NoticeCard({ n }: { n: Notice }) {
  const unread = !n.read_at;
  return (
    <Card style={[{ paddingVertical: 12 }, unread && { borderColor: colors.gold, backgroundColor: colors.unread }]}>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={[styles.icon, n.title.includes('not approved') && { backgroundColor: colors.dangerSoft }]}>
          <Ionicons name={iconFor(n)} size={18} color={n.title.includes('not approved') ? colors.danger : colors.primary} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <H2>{n.title}</H2>
          {n.body ? <Caption style={{ color: colors.text }}>{n.body}</Caption> : null}
          <Caption>{fmtDateTime(n.created_at)}</Caption>
        </View>
        {unread ? (
          <View style={styles.newTag} accessibilityLabel="Unread">
            <Ionicons name="ellipse" size={8} color={colors.goldInk} />
            <Text style={styles.newText}>New</Text>
          </View>
        ) : null}
      </Row>
    </Card>
  );
}

/** Full notifications screen; opening it marks everything as read. */
export function NotificationsScreen() {
  const { data, loading, offline, savedAt, refresh } = useNotifications();
  const hasUnread = !!data?.some((n) => !n.read_at);
  useFocusEffect(
    useCallback(() => {
      return () => {
        // leaving the screen: everything shown counts as read
        markAllRead().catch(() => {});
      };
    }, []),
  );
  useEffect(() => {
    if (hasUnread) {
      const t = setTimeout(() => markAllRead().catch(() => {}), 1500);
      return () => clearTimeout(t);
    }
  }, [hasUnread]);
  return (
    <Screen onRefresh={refresh}>
      <OfflineNote show={offline} savedAt={savedAt} />
      {loading && !data ? <Loading /> : null}
      {data && data.length === 0 ? <Empty icon="notifications-outline" title="No notifications" body="Class messages, approvals and schedule changes appear here." /> : null}
      {data?.map((n) => <NoticeCard key={n.id} n={n} />)}
    </Screen>
  );
}

/** Bell for green headers, with the unread count. */
export function Bell({ onPress }: { onPress: () => void }) {
  const { data } = useNotifications();
  const unread = data?.filter((n) => !n.read_at).length ?? 0;
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityLabel={`Notifications${unread ? `, ${unread} unread` : ''}`} style={({ pressed }) => [styles.bell, pressed && { opacity: 0.7 }]}>
      <Ionicons name="notifications-outline" size={20} color={colors.onPrimary} />
      {unread ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.gold, marginTop: 4 },
    newTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.goldSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    newText: { color: colors.goldInk, fontSize: 11.5, fontWeight: '800' },
  bell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: { position: 'absolute', top: -3, right: -3, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { fontSize: 10, fontWeight: '800', color: colors.text },
}));
