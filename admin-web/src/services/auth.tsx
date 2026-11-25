import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { supabase } from './supabase';

type AuthValue = {
  status: 'loading' | 'signed-out' | 'signed-in';
  session: Session | null;
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
export const NOT_ADMIN = 'This account is not an administrator. Instructors and students use the mobile app.';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [name, setName] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const apply = async (s: Session | null) => {
      setSession(s);
      if (!s) {
        setIsAdmin(false);
        setName('');
        setReady(true);
        return;
      }
      const [admin, profile] = await Promise.all([
        supabase.rpc('is_admin'),
        supabase.from('profiles').select('full_name').eq('id', s.user.id).maybeSingle(),
      ]);
      if (!alive) return;
      setIsAdmin(admin.data === true);
      setName(profile.data?.full_name || String(s.user.user_metadata?.full_name ?? '') || s.user.email || '');
      setReady(true);
    };
    supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'TOKEN_REFRESHED') return setSession(s);
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') setTimeout(() => apply(s), 0);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value: AuthValue = {
    status: !ready ? 'loading' : session ? 'signed-in' : 'signed-out',
    session,
    isAdmin,
    name,
    email: session?.user.email ?? '',
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) return error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message;
      const admin = await supabase.rpc('is_admin');
      if (admin.data !== true) {
        await supabase.auth.signOut();
        return NOT_ADMIN;
      }
      return null;
    },
    async signInWithGoogle() {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/overview`, queryParams: { prompt: 'select_account' } },
      });
      return error?.message ?? null;
    },
    async sendReset(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      return error?.message ?? null;
    },
    async signOut() {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
