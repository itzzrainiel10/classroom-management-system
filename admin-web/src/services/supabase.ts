import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !key) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in admin-web/.env');
}

/**
 * Same Supabase project (database + auth) as the instructor website and the mobile app.
 * The admin session is stored under its own key; the instructor website runs on another port
 * (a separate browser origin) with its own key, so signing in on one never signs out the other.
 */
export const supabase = createClient(url, key, {
  auth: {
    storageKey: 'cvsu-cms-admin-session',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});
