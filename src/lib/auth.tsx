import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { AppState, Platform } from 'react-native';

import { setCacheScope } from './offline';
import { supabase } from './supabase';

export type Role = 'instructor' | 'student';

type AuthValue = {
  status: 'loading' | 'signed-out' | 'signed-in';
  session: Session | null;
  userId: string | null;
  email: string | null;
  fullName: string;
  role: Role | null;
  /** Set while an instructor application waits for (or was refused) admin approval. */
  application: Application | null;
  /** Reloads role / application status from the server (e.g. after an admin approves). */
  refreshAccount: () => Promise<void>;
  /** Returns an error message, or null on success. */
  signIn: (email: string, password: string, expectedRole: Role) => Promise<string | null>;
  signUp: (email: string, password: string, fullName: string, role: Role, details?: InstructorDetails) => Promise<string | null>;
  /** Opens Google sign-in. A new Google account gets `role`. Returns an error message, or null on success/cancel. */
  signInWithGoogle: (role: Role) => Promise<string | null>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);
const roleKey = (uid: string) => `cms.role.${uid}`;
const nameKey = (uid: string) => `cms.name.${uid}`;

/** Role picked on the sign-in screen while a Google sign-in is in progress (new Google accounts have no role yet). */
let pendingGoogleRole: Role | null = null;

/**
 * Reads the values Supabase puts on the return link, e.g. `cvsucms://auth-callback/?code=…#sb=`.
 * Query and fragment are read separately so a trailing `#…` never ends up glued to the code.
 */
function readReturnParams(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const query = beforeHash.includes('?') ? beforeHash.slice(beforeHash.indexOf('?') + 1) : '';
  const fragment = hashAt >= 0 ? url.slice(hashAt + 1) : '';
  for (const part of [fragment, query]) {
    for (const pair of part.split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const key = decodeURIComponent(eq >= 0 ? pair.slice(0, eq) : pair);
      const value = eq >= 0 ? decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' ')) : '';
      if (value) out[key] = value; // query values win over fragment values
    }
  }
  return out;
}

/** Asks the auth server whether the Google provider is switched on (avoids opening a browser to an error page). */
async function googleEnabled(): Promise<boolean> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return false;
  try {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
    const body = await res.json();
    return body?.external?.google === true;
  } catch {
    return true; // can't tell (e.g. flaky network): let the browser try
  }
}

/** Why an account may not use the mobile app (signed out with this message). */
const BLOCKED = {
  suspended: 'This account has been suspended. Please contact your administrator.',
  admin: 'Administrator accounts use the web admin portal, not the mobile app.',
  norole: 'This account has no role yet. Please contact your administrator.',
} as const;

/** An instructor application an administrator hasn't approved (yet). */
export type Application = { status: 'pending' | 'rejected'; reason: string };
export type InstructorDetails = { employee_id: string; department: string; contact_number: string; section_id?: string | null };

type Account = { role: Role | null; name: string; application: Application | null; blocked?: keyof typeof BLOCKED };
const appKey = (uid: string) => `cms.application.${uid}`;

/**
 * Reads the role from the protected roles table (never from the app). Instructors exist only after an
 * administrator approves them; until then the account has an application instead of a role.
 * Offline, the last known values are used — the server still enforces every rule.
 */
async function loadAccount(session: Session): Promise<Account> {
  const uid = session.user.id;
  const claimRole = pendingGoogleRole;
  const cachedRole = (localStorage.getItem(roleKey(uid)) as Role | null) ?? null;
  const cachedApp = localStorage.getItem(appKey(uid));
  let name = localStorage.getItem(nameKey(uid)) ?? String(session.user.user_metadata?.full_name ?? '');
  const offline: Account = { role: cachedRole, name, application: cachedApp ? (JSON.parse(cachedApp) as Application) : null };
  if (!supabase) return offline;
  try {
    const [roles, profile] = await Promise.all([
      supabase.from('user_roles').select('role').eq('user_id', uid),
      supabase.from('profiles').select('full_name, status').eq('id', uid).maybeSingle(),
    ]);
    if (roles.error || profile.error) throw new Error('offline');
    if (profile.data?.status === 'suspended') return { role: null, name, application: null, blocked: 'suspended' };
    if (profile.data?.full_name) {
      name = profile.data.full_name;
      localStorage.setItem(nameKey(uid), name);
    }
    const all = (roles.data ?? []).map((r) => String(r.role));
    let list = all.filter((r): r is Role => r === 'instructor' || r === 'student');
    if (list.length === 0 && claimRole) {
      // First Google sign-in: student is granted at once; instructor only opens an application.
      const claimed = await supabase.rpc('claim_role', { _role: claimRole });
      if (!claimed.error && claimed.data) list = [claimed.data as Role];
    }
    const role: Role | null = list.includes('instructor') ? 'instructor' : list.includes('student') ? 'student' : null;
    let application: Application | null = null;
    if (role !== 'instructor') {
      const app = await supabase.from('instructor_profiles').select('status, rejection_reason').eq('user_id', uid).maybeSingle();
      if (app.data && app.data.status !== 'approved' && !(role === 'student' && app.data.status === 'rejected')) {
        application = { status: app.data.status as Application['status'], reason: app.data.rejection_reason ?? '' };
      }
    }
    if (role) localStorage.setItem(roleKey(uid), role);
    else localStorage.removeItem(roleKey(uid));
    if (application) localStorage.setItem(appKey(uid), JSON.stringify(application));
    else localStorage.removeItem(appKey(uid));

    if (!role && !application) return { role: null, name, application: null, blocked: all.includes('admin') ? 'admin' : 'norole' };
    // A student with a pending instructor application keeps using the student side until approved.
    return { role, name, application: role ? null : application };
  } catch {
    return offline;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [application, setApplication] = useState<Application | null>(null);
  const [fullName, setFullName] = useState('');
  const [ready, setReady] = useState(false);
  const sessionRef = useRef<Session | null>(null);

  const applyAccount = (a: Account) => {
    setRole(a.role);
    setApplication(a.application);
    setFullName(a.name);
  };

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setReady(true);
      return;
    }
    let alive = true;
    const apply = async (s: Session | null) => {
      setSession(s);
      sessionRef.current = s;
      setCacheScope(s?.user.id ?? null);
      if (s) {
        const a = await loadAccount(s);
        if (!alive) return;
        if (a.blocked) {
          await client.auth.signOut();
          return;
        }
        applyAccount(a);
      } else {
        applyAccount({ role: null, application: null, name: '' });
      }
      if (alive) setReady(true);
    };
    client.auth.getSession().then(({ data }) => apply(data.session));
    const { data } = client.auth.onAuthStateChange((event, s) => {
      if (event === 'TOKEN_REFRESHED') {
        setSession(s);
        sessionRef.current = s;
        return;
      }
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') apply(s);
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') client.auth.startAutoRefresh();
      else client.auth.stopAutoRefresh();
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
      appState.remove();
    };
  }, []);

  const status: AuthValue['status'] = !ready ? 'loading' : session && (role || application) ? 'signed-in' : session ? 'loading' : 'signed-out';

  /** Shared checks after any sign-in; returns an error message (and signs out) when the account can't continue here. */
  const afterSignIn = async (a: Account, expectedRole: Role, google: boolean) => {
    if (!supabase) return null;
    if (a.blocked) {
      await supabase.auth.signOut();
      return BLOCKED[a.blocked];
    }
    if (a.application && expectedRole === 'student') {
      await supabase.auth.signOut();
      return 'This account has an instructor application. Go back and choose “Log in as Instructor” to see its status.';
    }
    if (a.role && a.role !== expectedRole) {
      await supabase.auth.signOut();
      return `This ${google ? 'Google account' : 'account'} is a ${a.role} account. Go back and choose “Log in as ${a.role === 'instructor' ? 'Instructor' : 'Student'}”.`;
    }
    return null;
  };

  const value: AuthValue = {
    status,
    session,
    userId: session?.user.id ?? null,
    email: session?.user.email ?? null,
    fullName,
    role,
    application,
    async refreshAccount() {
      const s = sessionRef.current;
      if (!s || !supabase) return;
      const a = await loadAccount(s);
      if (a.blocked) {
        await supabase.auth.signOut();
        return;
      }
      applyAccount(a);
    },
    async signIn(email, password, expectedRole) {
      if (!supabase) return 'The app is not connected to the server.';
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) return error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message;
      return afterSignIn(await loadAccount(data.session), expectedRole, false);
    },
    async signUp(email, password, name, newRole, details) {
      if (!supabase) return 'The app is not connected to the server.';
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: {
            full_name: name.trim(),
            role: newRole,
            ...(newRole === 'instructor' && details
              ? { employee_id: details.employee_id.trim(), department: details.department.trim(), contact_number: details.contact_number.trim() }
              : {}),
            ...(newRole === 'student' && details?.section_id ? { section_id: details.section_id } : {}),
          },
        },
      });
      if (error) return error.message;
      // Email confirmation is off: sign-up returns a session and the user goes straight in.
      if (data.session) return null;
      return newRole === 'instructor'
        ? 'Application created! Confirm your email, then log in as Instructor to upload proof and follow its status. An administrator must approve it first.'
        : 'Account created! Check your email for the confirmation link, then log in.';
    },
    async signInWithGoogle(expectedRole) {
      if (!supabase) return 'The app is not connected to the server.';
      if (!(await googleEnabled())) {
        return 'Google sign-in is not turned on for this app yet. Use your email and password for now.';
      }
      // Phones always return through the app's own scheme: Supabase does not accept Expo Go's exp:// links,
      // and the sign-in browser catches cvsucms:// itself (also inside Expo Go on iPhone).
      const redirectTo = Platform.OS === 'web' ? Linking.createURL('auth-callback') : 'cvsucms://auth-callback';
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
      });
      if (error || !data.url) return error?.message ?? 'Could not start Google sign-in.';

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== 'success') return null; // closed by the user

      const params = readReturnParams(result.url);
      const errText = params.error_description || params.error;
      if (errText) return errText.replace(/\+/g, ' ');
      const code = params.code;
      if (!code) return 'Google sign-in did not finish. Please try again.';

      pendingGoogleRole = expectedRole;
      try {
        const exchanged = await supabase.auth.exchangeCodeForSession(code);
        if (exchanged.error) return exchanged.error.message;
        return afterSignIn(await loadAccount(exchanged.data.session), expectedRole, true);
      } finally {
        pendingGoogleRole = null;
      }
    },
    async signOut() {
      if (supabase) await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
