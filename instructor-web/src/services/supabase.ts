import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !key) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in instructor-web/.env');
}

/**
 * Same Supabase project (database + auth) as the admin website and the mobile app.
 * This website runs on its own port (a separate browser origin) and stores its session under its
 * own key, so an instructor signing in here never signs out an administrator on the admin website.
 */
export const supabase = createClient(url, key, {
  auth: {
    storageKey: 'cvsu-cms-instructor-session',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});
