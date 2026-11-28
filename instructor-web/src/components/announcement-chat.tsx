import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { fmtDateTime } from '../services/format';
import {
  fetchAnnouncementMentionOptions,
  fetchAnnouncementMessages,
  sendAnnouncementMessage,
  toggleAnnouncementMessageHeart,
  type AnnouncementMentionOption,
  type AnnouncementMessage,
} from '../services/teaching';
import { supabase } from '../services/supabase';

const hasMentionToken = (message: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)@${escaped}(?=$|\\s|[,.;!?])`, 'i').test(message);
};

export function AnnouncementChat({ announcementId }: { announcementId: string }) {
  const [messages, setMessages] = useState<AnnouncementMessage[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const lastTap = useRef<{ messageId: string; at: number } | null>(null);
  const [mentionOptions, setMentionOptions] = useState<AnnouncementMentionOption[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [selectedMentions, setSelectedMentions] = useState<AnnouncementMentionOption[]>([]);

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setError(error.message);
        return;
      }
      setCurrentUserId(data.user?.id ?? null);
    }).catch((e) => {
      if (active) setError(e instanceof Error ? e.message : 'Could not identify the signed-in user.');
    });
    return () => {
      active = false;
    };
  }, []);

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      setMessages(await fetchAnnouncementMessages(announcementId));
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
    const channel = supabase
      .channel(`instructor-announcement-chat-${announcementId}`)
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
      void supabase.removeChannel(channel);
    };
  }, [announcementId, load]);

  useEffect(() => {
    const element = thread.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = text.trim();
    if (!message || sending) return;
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

  const reactToMessage = async (item: AnnouncementMessage) => {
    try {
      await toggleAnnouncementMessageHeart(announcementId, item.id, item.hearted_by_me ?? false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not react to the message.');
    }
  };

  const tapMessage = (item: AnnouncementMessage) => {
    const now = Date.now();
    const previous = lastTap.current;
    if (previous?.messageId === item.id && now - previous.at <= 350) {
      lastTap.current = null;
      void reactToMessage(item);
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
    <section className="announcement-chat" aria-label="Messages">
      <header className="announcement-chat-head">
        <b>Messages</b>
        <small>{messages.length} messages</small>
      </header>
      <p className="announcement-chat-muted">Double-click or double-tap a message to react with a heart.</p>
      <div className="announcement-chat-thread" ref={thread} aria-live="polite">
        {loading && !messages.length ? <p className="announcement-chat-muted">Loading messages…</p> : null}
        {!loading && !messages.length && !error ? <p className="announcement-chat-muted">No messages yet.</p> : null}
        {messages.map((item) => {
          const mine = item.author_id === currentUserId;
          return (
            <article
              key={item.id}
              className={`announcement-chat-message${mine ? ' mine' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={`${mine ? 'Your message' : `Message from ${item.author_name}`}. Double-click to react with a heart.`}
              onClick={() => tapMessage(item)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  void reactToMessage(item);
                }
              }}>
              <header>
                <b>{mine ? 'You' : item.author_name}</b>
                <time>{fmtDateTime(item.created_at)}</time>
              </header>
              <p>{item.message}</p>
              {(item.heart_count ?? 0) > 0 || item.hearted_by_me ? (
                <span className={`announcement-chat-reaction${item.hearted_by_me ? ' reacted' : ''}`}>
                  <span aria-hidden="true">♥</span> {item.heart_count ?? 0}
                </span>
              ) : null}
            </article>
          );
        })}
      </div>
      {error ? <p className="announcement-chat-error" role="alert">{error}</p> : null}
      {mentionQuery !== null ? (
        <div className="announcement-chat-mention-suggestions" role="listbox" aria-label="Class members">
          {!mentionOptions.length ? <p className="announcement-chat-muted">No active members are linked to this class.</p> : null}
          {mentionOptions.length && !matchingMentions.length && mentionQuery ? <p className="announcement-chat-muted">No exact match. Choose a class member:</p> : null}
          {filteredMentions.map((mention) => (
            <button key={mention.user_id} className="announcement-chat-mention-option" type="button" onClick={() => selectMention(mention)}>
              {mention.full_name}
            </button>
          ))}
        </div>
      ) : null}
      <form className="announcement-chat-composer" onSubmit={(event) => void submit(event)}>
        <textarea
          className="textarea"
          value={text}
          onChange={(event) => updateText(event.target.value)}
          placeholder="Write a message…"
          maxLength={2000}
          rows={2}
          aria-label="Write a message"
        />
        <button className="btn btn-primary" type="submit" disabled={!text.trim() || sending}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </section>
  );
}
