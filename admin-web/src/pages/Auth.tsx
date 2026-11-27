import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { GoogleLogo, Icon } from '../components/icons';
import { A11yMenu } from '../components/a11y';
import { Field } from '../components/ui';
import { INSTRUCTOR_SITE, NOT_ADMIN, useAuth } from '../services/auth';
import { PASSWORD_RULE, passwordOk, useRecoverySession } from '../services/recovery';
import { supabase } from '../services/supabase';

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-a11y">
        <A11yMenu />
      </div>
      <header className="auth-top">
        <div className="auth-brand">
          <img src="/seal.png" alt="Cavite State University seal" />
          <b>Cavite State University</b>
          <small>Classroom Management System</small>
          <span className="auth-tag">Administrator</span>
        </div>
      </header>
      <section className="auth-panel">{children}</section>
      <footer className="auth-foot">Truth · Excellence · Service</footer>
    </div>
  );
}

function Notice({ msg }: { msg: { text: string; ok: boolean } | null }) {
  if (!msg) return null;
  return (
    <div className={`note ${msg.ok ? '' : 'red'}`}>
      <Icon name={msg.ok ? 'mail' : 'alert'} />
      <div>{msg.text}</div>
    </div>
  );
}

/** /admin/login — administrators only. */
export function SignIn() {
  const { status, isAdmin, signIn, signInWithGoogle, sendReset, signOut } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'pw' | 'google' | 'reset' | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [mode, setMode] = useState<'in' | 'code'>('in');

  useEffect(() => {
    // While entering the reset code the account is briefly signed in to save the new password.
    if (status !== 'signed-in' || mode === 'code') return;
    if (isAdmin) navigate('/admin/dashboard', { replace: true });
    else {
      // e.g. came back from Google with an account that isn't an administrator
      void signOut();
      setMsg({ text: NOT_ADMIN, ok: false });
    }
  }, [status, isAdmin, navigate, signOut, mode]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) return setMsg({ text: 'Enter your admin email.', ok: false });
    if (!password) return setMsg({ text: 'Enter your password.', ok: false });
    setBusy('pw');
    setMsg(null);
    const err = await signIn(email, password);
    setBusy(null);
    if (err) setMsg({ text: err, ok: false });
  };

  const reset = async () => {
    if (!email.includes('@')) return setMsg({ text: 'Type your email above first, then click “Forgot password?”.', ok: false });
    setBusy('reset');
    const err = await sendReset(email);
    setBusy(null);
    if (err) return setMsg({ text: err, ok: false });
    setMsg(null);
    setMode('code');
  };

  if (mode === 'code') {
    return (
      <AuthLayout>
        <ResetWithCode
          email={email}
          onResend={() => sendReset(email)}
          onCancel={() => setMode('in')}
          onDone={() => {
            setMsg({ text: 'Password updated. Signing you in…', ok: true });
            setMode('in');
          }}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form className="auth-card" onSubmit={submit}>
        <h2>Administrator sign in</h2>
        <p className="lead">
          For CvSU administrators only. Instructors use the{' '}
          <a className="link" href={INSTRUCTOR_SITE}>
            Instructor website
          </a>
          .
        </p>
        <Field label="Admin email" required>
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@cvsu.edu.ph" />
        </Field>
        <Field label="Password" required>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" />
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -6 }}>
          <button type="button" className="link" onClick={() => void reset()} disabled={busy === 'reset'}>
            Forgot password?
          </button>
        </div>
        <Notice msg={msg} />
        <button className="btn btn-primary btn-block" disabled={!!busy}>
          {busy === 'pw' ? 'Signing in…' : 'Sign in'}
        </button>
        <div className="or">OR</div>
        <button
          type="button"
          className="btn btn-secondary btn-block"
          disabled={!!busy}
          onClick={async () => {
            setBusy('google');
            const err = await signInWithGoogle();
            if (err) {
              setBusy(null);
              setMsg({ text: err, ok: false });
            }
          }}>
          <GoogleLogo /> Continue with Google
        </button>
      </form>
    </AuthLayout>
  );
}

/** Opened from the reset email: set a new password. */
export function ResetPassword() {
  const navigate = useNavigate();
  const link = useRecoverySession();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!passwordOk(pw)) return setMsg({ text: PASSWORD_RULE, ok: false });
    if (pw !== pw2) return setMsg({ text: 'The two passwords don’t match.', ok: false });
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) {
      const text = /session/i.test(error.message)
        ? 'This reset link has expired. Go back to sign in and request a new one.'
        : /different from the old/i.test(error.message)
          ? 'Choose a password different from your old one.'
          : error.message;
      return setMsg({ text, ok: false });
    }
    setMsg({ text: 'Password updated. Taking you to the dashboard…', ok: true });
    setTimeout(() => navigate('/admin/dashboard', { replace: true }), 1200);
  };

  if (link.phase !== 'ready') {
    return (
      <AuthLayout>
        <div className="auth-card">
          <h2>{link.phase === 'checking' ? 'Checking your reset link…' : 'Reset link problem'}</h2>
          {link.phase === 'invalid' ? <Notice msg={{ text: link.reason, ok: false }} /> : <p className="lead">One moment.</p>}
          {link.phase === 'invalid' ? (
            <button type="button" className="btn btn-primary btn-block" onClick={() => navigate('/admin/login', { replace: true })}>
              Back to sign in
            </button>
          ) : null}
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form className="auth-card" onSubmit={submit}>
        <h2>Set a new password</h2>
        <p className="lead">Choose a new password for your administrator account. It also works in the mobile app.</p>
        <Field label="New password" required hint="At least 8 characters, with letters and numbers.">
          <input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Field label="Confirm new password" required>
          <input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </Field>
        <Notice msg={msg} />
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </AuthLayout>
  );
}

/**
 * Second step of "Forgot password?": type the 6-digit code from the email and choose a new password.
 * (The email also has a link; the code works even when the link can't be opened.)
 */
function ResetWithCode({ email, onCancel, onDone, onResend }: { email: string; onCancel: () => void; onDone: () => void; onResend: () => Promise<string | null> }) {
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>({ text: `We sent a 6-digit code to ${email}. Check your inbox (and Spam).`, ok: true });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const token = code.replace(/\s+/g, '');
    if (!/^\d{6,10}$/.test(token)) return setMsg({ text: 'Enter the 6-digit code from the email.', ok: false });
    if (!passwordOk(pw)) return setMsg({ text: PASSWORD_RULE, ok: false });
    if (pw !== pw2) return setMsg({ text: 'The two passwords don’t match.', ok: false });
    setBusy(true);
    setMsg(null);
    const verified = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: 'recovery' });
    if (verified.error) {
      setBusy(false);
      return setMsg({ text: /expired|invalid/i.test(verified.error.message) ? 'That code is wrong or has expired. Check the newest email, or tap “Send a new code”.' : verified.error.message, ok: false });
    }
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setMsg({ text: /different from the old/i.test(error.message) ? 'Choose a password different from your old one.' : error.message, ok: false });
    onDone();
  };

  return (
    <form className="auth-card" onSubmit={submit}>
      <button type="button" className="link" onClick={onCancel} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}>
        <Icon name="arrowLeft" size={16} /> Back to sign in
      </button>
      <h2>Reset your password</h2>
      <p className="lead">Enter the code from the email, then choose a new password.</p>
      <Field label="6-digit code" required>
        <input
          className="input"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={10}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, ''))}
          placeholder="123456"
          style={{ letterSpacing: '0.3em', fontWeight: 700, fontSize: 'calc(18px * var(--text-scale))' }}
          autoFocus
        />
      </Field>
      <Field label="New password" required hint="At least 8 characters, with letters and numbers.">
        <input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </Field>
      <Field label="Confirm new password" required>
        <input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
      </Field>
      <Notice msg={msg} />
      <button className="btn btn-primary btn-block" disabled={busy}>
        {busy ? 'Saving…' : 'Save new password'}
      </button>
      <p style={{ textAlign: 'center', color: 'var(--text-soft)' }}>
        No code?{' '}
        <button
          type="button"
          className="link"
          onClick={async () => {
            const err = await onResend();
            setMsg(err ? { text: err, ok: false } : { text: `A new code was sent to ${email}. Use the newest email.`, ok: true });
          }}>
          Send a new code
        </button>
      </p>
    </form>
  );
}
