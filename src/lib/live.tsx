// Live updates: while signed in, the app listens to Supabase Realtime. When something the person may
// see changes (a class, grade, attendance, announcement, renewal, semester, notification…), every open
// screen quietly re-checks the server. Row-level security still decides which changes arrive.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect } from 'react';

import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const TABLES = [
  'semesters', 'renewals', 'sections', 'classes', 'class_students', 'class_schedules', 'instructor_schedules',
  'quizzes', 'quiz_attempts', 'assignments', 'announcements', 'attendance_sessions', 'attendance_records',
  'notifications', 'profiles', 'instructor_profiles',
];

const listeners = new Set<() => void>();

/** Run `cb` whenever live data changed. Returns the unsubscribe function. */
export function onLiveChange(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** Several rows often change together (e.g. ending a semester): refresh once, shortly after. */
function changed() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    listeners.forEach((l) => l());
  }, 700);
}

/** Mount once inside the auth provider. */
export function LiveUpdates() {
  const { status, userId, refreshAccount } = useAuth();

  useEffect(() => {
    const client = supabase;
    if (!client || status !== 'signed-in' || !userId) return;
    let channel: RealtimeChannel = client.channel(`cms-live-${userId}`);
    for (const table of TABLES) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        // My own account changed (e.g. suspended, role, name): re-check it right away.
        const row = (payload.new ?? payload.old) as { id?: string; user_id?: string } | null;
        if ((table === 'profiles' && row?.id === userId) || (table === 'instructor_profiles' && row?.user_id === userId)) void refreshAccount();
        changed();
      });
    }
    channel.subscribe();
    return () => {
      void client.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, userId]);

  return null;
}
