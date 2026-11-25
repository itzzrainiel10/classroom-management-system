import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { supabase } from './supabase';

/** Address of the separate Instructor website (shown to instructors who try to sign in here). */
export const INSTRUCTOR_SITE = (import.meta.env.VITE_INSTRUCTOR_SITE_URL as string | undefined) ?? 'http://localhost:5174';

type AuthValue = {
  status: 'loading' | 'signed-out' | 'signed-in';
  session: Session | null;
  /** Read from the database (is_admin()), never from the browser. */
  isAdmin: boolean;
  name: string;
  email: string;
  /** Returns an error message, or null when signed in as an administrator. */
  signIn: (email: string, password: string) => Promise<string | null>;
  signInWithGoogle: () => Promise<string | null>;
  sendReset: (email: string) => Promise<string | null>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);
export const NOT_ADMIN = `This account is not an administrator. Instructors use the Instructor website (${INSTRUCTOR_SITE}); students use the mobile app.`;

type Account = { isAdmin: boolean; name: string };
const NONE: Account = { isAdmin: false, name: '' };

async function loadAccount(s: Session): Promise<Account> {
  const [admin, profile] = await Promise.all([supabase.rpc('is_admin'), supabase.from('profiles').select('full_name').eq('id', s.user.id).maybeSingle()]);
  return { isAdmin: admin.data === true, name: profile.data?.full_name || String(s.user.user_metadata?.full_name ?? '') || s.user.email || '' };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [account, setAccount] = useState<Account>(NONE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    // Session and role are published together, so no page sees "signed in" without knowing the role.
    const apply = async (s: Session | null) => {
      const a = s ? await loadAccount(s) : NONE;
      if (!alive) return;
      setSession(s);
      setAccount(a);
      setReady(true);
    };
    supabase.auth.getSession().then(({ data }) => {
      void apply(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'TOKEN_REFRESHED') return setSession(s);
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') setTimeout(() => void apply(s), 0);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value: AuthValue = {
    status: !ready ? 'loading' : session ? 'signed-in' : 'signed-out',
    session,
    ...account,
    email: session?.user.email ?? '',
    async signIn(email, password) {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) return error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message;
      if (!(await loadAccount(data.session)).isAdmin) {
        await supabase.auth.signOut({ scope: 'local' });
        return NOT_ADMIN;
      }
      return null;
    },
    async signInWithGoogle() {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        // /overview is on the auth redirect allow-list and forwards to /admin/dashboard.
        options: { redirectTo: `${window.location.origin}/overview`, queryParams: { prompt: 'select_account' } },
      });
      return error?.message ?? null;
    },
    async sendReset(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${window.location.origin}/reset-password` });
      return error?.message ?? null;
    },
    async signOut() {
      // 'local' ends only this browser's admin session (not the same user's sessions elsewhere).
      await supabase.auth.signOut({ scope: 'local' });
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
