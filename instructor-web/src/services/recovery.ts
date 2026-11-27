import { useEffect, useState } from 'react';

import { supabase } from './supabase';

export type RecoveryState = { phase: 'checking' } | { phase: 'ready' } | { phase: 'invalid'; reason: string };

const EXPIRED = 'This reset link is invalid or has expired. Go back to sign in and click “Forgot password?” again to get a new link.';

/**
 * Turns the link in the password-reset email into a session that may set a new password.
 *  - `?token_hash=…&type=recovery` (our email template): verified here, so it works in any browser
 *    and isn't used up by email scanners that open links before the person does.
 *  - `?code=…` (Supabase's default link): exchanged automatically by the client (same browser only).
 *  - `#error=…` / `?error=…`: the link was expired or already used.
 */
export function useRecoverySession(): RecoveryState {
  const [state, setState] = useState<RecoveryState>({ phase: 'checking' });

  useEffect(() => {
    let alive = true;
    const done = (s: RecoveryState) => alive && setState(s);
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const clean = () => window.history.replaceState(null, '', window.location.pathname);

    (async () => {
      const error = query.get('error_description') ?? hash.get('error_description');
      if (error) {
        clean();
        return done({ phase: 'invalid', reason: /expired|invalid/i.test(error) ? EXPIRED : `${error}. Request a new reset link.` });
      }
      const tokenHash = query.get('token_hash');
      if (tokenHash) {
        const { error: err } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
        clean();
        return done(err ? { phase: 'invalid', reason: EXPIRED } : { phase: 'ready' });
      }
      // getSession waits for the client to finish exchanging a ?code= link.
      const { data } = await supabase.auth.getSession();
      if (query.has('code')) clean();
      done(data.session ? { phase: 'ready' } : { phase: 'invalid', reason: EXPIRED });
    })();

    return () => {
      alive = false;
    };
  }, []);

  return state;
}

export const PASSWORD_RULE = 'Use at least 8 characters with letters and numbers.';
export const passwordOk = (pw: string) => pw.length >= 8 && /[a-z]/i.test(pw) && /[0-9]/.test(pw);
