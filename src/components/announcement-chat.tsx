import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Caption } from '@/components/ui';
import { colors, themed } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import {
  fetchAnnouncementMentionOptions,
  fetchAnnouncementMessages,
  sendAnnouncementMessage,
  toggleAnnouncementMessageHeart,
  type AnnouncementMentionOption,
  type AnnouncementMessage,
} from '@/lib/data';
import { fmtDateTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';

const hasMentionToken = (message: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)@${escaped}(?=$|\\s|[,.;!?])`, 'i').test(message);
};

export function AnnouncementChat({ announcementId }: { announcementId: string }) {
  const { userId } = useAuth();
  const [messages, setMessages] = useState<AnnouncementMessage[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastTap = useRef<{ messageId: string; at: number } | null>(null);
  const [mentionOptions, setMentionOptions] = useState<AnnouncementMentionOption[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [selectedMentions, setSelectedMentions] = useState<AnnouncementMentionOption[]>([]);

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const rows = await fetchAnnouncementMessages(announcementId);
      setMessages(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load messages.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [announcementId]);

  useEffect(() => {
    void load(true);
    void fetchAnnouncementMentionOptions(announcementId).then(setMentionOptions).catch((e) => {
      setError(e instanceof Error ? e.message : 'Could not load class members.');
    });
    const client = supabase;
    if (!client) return;

    const channel = client
      .channel(`announcement-chat-${announcementId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'announcement_messages',
        filter: `announcement_id=eq.${announcementId}`,
      }, () => void load())
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'announcement_message_reactions',
        filter: `announcement_id=eq.${announcementId}`,
      }, () => void load())
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setError('Live updates are unavailable; messages will retry shortly.');
        }
      });
    const refresh = setInterval(() => void load(), 15_000);

    return () => {
      clearInterval(refresh);
      void client.removeChannel(channel);
    };
  }, [announcementId, load]);

  const send = async () => {
    const message = text.trim();
    if (!message || sending || !supabase) return;
    const mentionedUserIds = selectedMentions
      .filter((mention) => hasMentionToken(message, mention.full_name))
      .map((mention) => mention.user_id);
    setSending(true);
    setError(null);
    try {
      const sent = await sendAnnouncementMessage(announcementId, message, mentionedUserIds);
      setMessages((current) => current.some((item) => item.id === sent.id) ? current : [...current, sent]);
      setText('');
      setSelectedMentions([]);
      setMentionQuery(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send your message.');
    } finally {
      setSending(false);
    }
  };

  const tapMessage = (item: AnnouncementMessage) => {
    const now = Date.now();
    const previous = lastTap.current;
    if (previous?.messageId === item.id && now - previous.at <= 350) {
      lastTap.current = null;
      void toggleAnnouncementMessageHeart(announcementId, item.id, item.hearted_by_me ?? false)
        .then(() => load())
        .catch((e) => setError(e instanceof Error ? e.message : 'Could not react to the message.'));
    } else {
      lastTap.current = { messageId: item.id, at: now };
    }
  };

  const updateText = (value: string) => {
    setText(value);
    setSelectedMentions((current) => current.filter((mention) => hasMentionToken(value, mention.full_name)));
    const match = value.match(/(^|\s)@([^\s@]*)$/);
    setMentionQuery(match ? match[2] : null);
  };

  const selectMention = (mention: AnnouncementMentionOption) => {
    const match = text.match(/(^|\s)@([^\s@]*)$/);
    if (!match) return;
    const tokenStart = text.length - match[0].length + match[1].length;
    const name = mention.full_name.trim().replace(/\s+/g, ' ');
    setText(`${text.slice(0, tokenStart)}@${name} `);
    setMentionQuery(null);
    setSelectedMentions((current) => current.some((item) => item.user_id === mention.user_id) ? current : [...current, mention]);
  };

  const matchingMentions = mentionQuery === null
    ? []
    : mentionOptions.filter((item) => item.full_name.toLowerCase().replace(/\s+/g, ' ').includes(mentionQuery.toLowerCase().replace(/\s+/g, ' ')));
  const filteredMentions = mentionQuery === null
    ? []
    : (matchingMentions.length ? matchingMentions : mentionOptions).slice(0, 6);

  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        <Ionicons name="chatbubbles-outline" size={17} color={colors.primary} />
        <Text style={styles.headingText}>Messages</Text>
        <Text style={styles.count}>{messages.length}</Text>
      </View>
      <Caption>Double-tap a message to react with a heart.</Caption>

      {loading && !messages.length ? <ActivityIndicator color={colors.primary} /> : null}
      {!loading && !messages.length && !error ? <Caption>No messages yet.</Caption> : null}
      {messages.map((item) => {
        const own = item.author_id === userId;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`Message from ${own ? 'you' : item.author_name}. Double-tap to react with a heart.`}
            onPress={() => tapMessage(item)}
            style={[styles.message, own && styles.ownMessage]}>
            <View style={styles.messageMeta}>
              <Text style={[styles.author, own && styles.ownText]}>{own ? 'You' : item.author_name}</Text>
              <Text style={[styles.time, own && styles.ownTime]}>{fmtDateTime(item.created_at)}</Text>
            </View>
            <Text style={[styles.messageText, own && styles.ownText]}>{item.message}</Text>
            {(item.heart_count ?? 0) > 0 || item.hearted_by_me ? (
              <View style={styles.reaction}>
                <Ionicons name={item.hearted_by_me ? 'heart' : 'heart-outline'} size={14} color={colors.danger} />
                <Text style={styles.reactionCount}>{item.heart_count ?? 0}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}

      {error ? <Caption style={{ color: colors.danger }}>{error}</Caption> : null}
      {mentionQuery !== null ? (
        <View style={styles.mentionSuggestions}>
          {!mentionOptions.length ? <Caption>No active members are linked to this class.</Caption> : null}
          {mentionOptions.length && !matchingMentions.length && mentionQuery ? <Caption>No exact match. Choose a class member:</Caption> : null}
          {filteredMentions.map((mention) => (
            <Pressable key={mention.user_id} onPress={() => selectMention(mention)} style={styles.mentionOption}>
              <Text style={styles.mentionOptionText}>{mention.full_name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.composer}>
        <TextInput
          accessibilityLabel="Write a message"
          value={text}
          onChangeText={updateText}
          placeholder="Write a message…"
          placeholderTextColor={colors.muted}
          multiline
          maxLength={2000}
          editable={!sending && !!supabase}
          style={styles.input}
        />
        <Pressable
          accessibilityLabel="Send message"
          accessibilityRole="button"
          disabled={!text.trim() || sending || !supabase}
          onPress={() => void send()}
          style={({ pressed }) => [styles.sendButton, (!text.trim() || sending || !supabase) && styles.sendDisabled, pressed && styles.sendPressed]}>
          {sending ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Ionicons name="send" size={18} color={colors.onPrimary} />}
        </Pressable>
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  container: { gap: 9, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  headingText: { color: colors.primary, fontSize: 13, fontWeight: '800', flex: 1 },
  count: { color: colors.textSoft, fontSize: 12, fontWeight: '700' },
  message: { alignSelf: 'flex-start', maxWidth: '92%', gap: 3, padding: 9, backgroundColor: colors.primarySoft, borderRadius: 8 },
  ownMessage: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  messageMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  author: { color: colors.primary, fontSize: 11, fontWeight: '800', flexShrink: 1 },
  ownText: { color: colors.onPrimary },
  time: { color: colors.muted, fontSize: 10 },
  ownTime: { color: colors.onPrimarySoft },
  messageText: { color: colors.text, fontSize: 13, lineHeight: 18 },
  reaction: { alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.card },
  reactionCount: { color: colors.danger, fontSize: 11, fontWeight: '800' },
  mentionSuggestions: { gap: 2, padding: 6, borderWidth: 1, borderColor: colors.line, borderRadius: 8, backgroundColor: colors.card },
  mentionOption: { paddingHorizontal: 8, paddingVertical: 7, borderRadius: 6 },
  mentionOptionText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, minHeight: 40, maxHeight: 110, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: colors.line, borderRadius: 8, color: colors.text, fontSize: 14, textAlignVertical: 'top' },
  sendButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderRadius: 8 },
  sendDisabled: { opacity: 0.45 },
  sendPressed: { opacity: 0.8 },
}));
