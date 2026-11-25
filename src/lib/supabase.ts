import 'expo-sqlite/localStorage/install';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** Null when no Supabase keys are set: the app then runs offline-only. */
export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: {
          storage: localStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
          // Google sign-in returns a one-time code to the app, exchanged in lib/auth.tsx.
          flowType: 'pkce',
        },
      })
    : null;

export const cloudEnabled = supabase !== null;
