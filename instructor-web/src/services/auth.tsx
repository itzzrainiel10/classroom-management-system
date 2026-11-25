import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { supabase } from './supabase';

/** Address of the separate Admin website (shown to administrators who try to sign in here). */
export const ADMIN_SITE = (import.meta.env.VITE_ADMIN_SITE_URL as string | undefined) ?? 'http://localhost:5173';

/** Instructor application state, read from the database (never from the browser). */
export type InstructorStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

type Account = {
  isAdmin: boolean;
  /** True only for an active account with the instructor role and an approved application (is_approved_instructor). */
  isInstructor: boolean;
  instructorStatus: InstructorStatus | null;
  /** Rejection / suspension reason from the administrator. */
  instructorReason: string;
  accountSuspended: boolean;
  name: string;
};
const NONE: Account = { isAdmin: false, isInstructor: false, instructorStatus: null, instructorReason: '', accountSuspended: false, name: '' };

type AuthValue = Account & {
  status: 'loading' | 'signed-out' | 'signed-in';
  session: Session | null;
  email: string;
  /** Returns an error message, or null when signed in as an approved instructor. */
  signIn: (email: string, password: string) => Promise<string | null>;
  sendReset: (email: string) => Promise<string | null>;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

async function loadAccount(s: Session): Promise<Account> {
  const [admin, teaches, profile, application] = await Promise.all([
    supabase.rpc('is_admin'),
    supabase.rpc('is_approved_instructor', { _user_id: s.user.id }),
    supabase.from('profiles').select('full_name, status').eq('id', s.user.id).maybeSingle(),
    supabase.from('instructor_profiles').select('status, rejection_reason').eq('user_id', s.user.id).maybeSingle(),
  ]);
  const accountSuspended = profile.data?.status === 'suspended';
  return {
    isAdmin: admin.data === true,
    isInstructor: teaches.data === true && !accountSuspended,
    instructorStatus: (application.data?.status as InstructorStatus | undefined) ?? null,
    instructorReason: application.data?.rejection_reason ?? '',
    accountSuspended,
    name: profile.data?.full_name || String(s.user.user_metadata?.full_name ?? '') || s.user.email || '',
  };
}

/** Why an account can't use the Instructor website, or null if it can. */
export function instructorBlock(a: Pick<Account, 'isAdmin' | 'isInstructor' | 'instructorStatus' | 'instructorReason' | 'accountSuspended'>): string | null {
  if (a.accountSuspended) return 'This account has been suspended. Please contact your administrator.';
  if (a.isInstructor) return null;
  switch (a.instructorStatus) {
    case 'pending':
      return 'Your instructor application is awaiting administrator approval. You can sign in here once it is approved.';
    case 'rejected':
      return `Your instructor application was not approved.${a.instructorReason ? ` Reason: ${a.instructorReason}` : ''} You can update and resend it in the mobile app.`;
    case 'suspended':
      return `Your instructor access is suspended.${a.instructorReason ? ` Reason: ${a.instructorReason}` : ''} Please contact your administrator.`;
    default:
      return a.isAdmin
        ? `Administrator accounts use the Admin website (${ADMIN_SITE}).`
        : 'This account is not an instructor account. Register as an instructor first.';
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [account, setAccount] = useState<Account>(NONE);
  const [ready, setReady] = useState(false);

  // Session and role are published together, so no page sees "signed in" without knowing the role.
  const apply = async (s: Session | null) => {
    const a = s ? await loadAccount(s) : NONE;
    setSession(s);
    setAccount(a);
    setReady(true);
  };

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (alive) void apply(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'TOKEN_REFRESHED') return setSession(s);
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') setTimeout(() => alive && void apply(s), 0);
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
      const why = instructorBlock(await loadAccount(data.session));
      if (why) {
        await supabase.auth.signOut({ scope: 'local' });
        return why;
      }
      return null;
    },
    async sendReset(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${window.location.origin}/reset-password` });
      return error?.message ?? null;
    },
    async reload() {
      await apply(session);
    },
    async signOut() {
      // 'local' ends only this browser's instructor session.
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
