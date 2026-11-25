import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { GoogleLogo, Icon } from '../components/icons';
import { Field } from '../components/ui';
import { NOT_ADMIN, useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <header className="auth-top">
        <img src="/seal.png" alt="Cavite State University seal" />
        <div>
          <b>Cavite State University</b>
          <small>Classroom Management System · Administrator</small>
        </div>
      </header>
      <section className="auth-panel">{children}</section>
      <footer className="auth-foot">Truth · Excellence · Service</footer>
    </div>
  );
}

/** Landing page: introduces the portal and leads to sign-in. */
export function Welcome() {
  const { status, isAdmin } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (status === 'signed-in' && isAdmin) navigate('/overview', { replace: true });
  }, [status, isAdmin, navigate]);
  return (
    <AuthLayout>
      <div className="auth-card">
        <h2>Admin portal</h2>
        <p className="lead">For administrators only. Instructors and students use the mobile app.</p>
        <Link className="btn btn-primary btn-block" to="/sign-in">
          Sign in
        </Link>
      </div>
    </AuthLayout>
  );
}

export function SignIn() {
  const { status, isAdmin, signIn, signInWithGoogle, sendReset, signOut } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'pw' | 'google' | 'reset' | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (status === 'signed-in' && isAdmin) navigate('/overview', { replace: true });
    // Came back from Google with an account that isn't an administrator.
    if (status === 'signed-in' && !isAdmin) {
      void signOut();
      setMsg({ text: NOT_ADMIN, ok: false });
    }
  }, [status, isAdmin, navigate, signOut]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) return setMsg({ text: 'Enter your university email.', ok: false });
    if (!password) return setMsg({ text: 'Enter your password.', ok: false });
    setBusy('pw');
    setMsg(null);
    const err = await signIn(email, password);
    setBusy(null);
    if (err) setMsg({ text: err, ok: false });
  };

  const reset = async () => {
    if (!email.includes('@')) return setMsg({ text: 'Type your university email above first, then click “Forgot password?”.', ok: false });
    setBusy('reset');
    const err = await sendReset(email);
    setBusy(null);
    setMsg(err ? { text: err, ok: false } : { text: 'Check your university email. Password reset instructions have been sent to your registered account.', ok: true });
  };

  return (
    <AuthLayout>
      <form className="auth-card" onSubmit={submit}>
        <Link to="/" className="link" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}>
          <Icon name="arrowLeft" size={16} /> Back
        </Link>
        <h2>Admin sign in</h2>
        <p className="lead">Use your CvSU administrator account.</p>
        <Field label="University email">
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@cvsu.edu.ph" />
        </Field>
        <Field label="Password">
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" />
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -6 }}>
          <button type="button" className="link" onClick={() => void reset()} disabled={busy === 'reset'}>
            Forgot password?
          </button>
        </div>
        {msg ? (
          <div className={`note ${msg.ok ? '' : 'red'}`}>
            <Icon name={msg.ok ? 'mail' : 'alert'} />
            <div>{msg.text}</div>
          </div>
        ) : null}
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
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return setMsg({ text: 'Use at least 8 characters.', ok: false });
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setMsg({ text: error.message, ok: false });
    setMsg({ text: 'Password updated. Taking you to your workspace…', ok: true });
    setTimeout(() => navigate('/overview'), 1200);
  };
  return (
    <AuthLayout>
      <form className="auth-card" onSubmit={submit}>
        <h2>Set a new password</h2>
        <p className="lead">Choose a new password for your administrator account.</p>
        <Field label="New password" hint="At least 8 characters.">
          <input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        {msg ? <div className={`note ${msg.ok ? '' : 'red'}`}>{msg.text}</div> : null}
        <button className="btn btn-primary btn-block" disabled={busy}>
          Save password
        </button>
      </form>
    </AuthLayout>
  );
}
