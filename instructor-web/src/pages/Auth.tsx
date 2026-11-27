import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { GoogleLogo, Icon } from '../components/icons';
import { A11yMenu } from '../components/a11y';
import { Field } from '../components/ui';
import { PhoneInput } from '../components/phone';
import { phValid } from '../services/phone';
import { instructorBlock, useAuth } from '../services/auth';
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
          <span className="auth-tag">Instructor</span>
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

/** /login — approved instructors sign in; new instructors register (application starts as Pending). */
export function SignIn() {
  const auth = useAuth();
  const { status, isInstructor, signIn, signInWithGoogle, sendReset, signOut } = auth;
  const navigate = useNavigate();
  const [mode, setMode] = useState<'in' | 'register' | 'code'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'pw' | 'google' | 'reset' | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(() => {
    // Google sends people back here with ?error_description=… when sign-in was cancelled or failed.
    const q = new URLSearchParams(window.location.search + window.location.hash.replace(/^#/, '&'));
    const err = q.get('error_description');
    if (err) window.history.replaceState(null, '', window.location.pathname);
    return err ? { text: `Google sign-in didn’t finish: ${err}`, ok: false } : null;
  });

  useEffect(() => {
    // While registering, the new (pending) account is briefly signed in to upload its document.
    if (status !== 'signed-in' || mode === 'register' || mode === 'code') return;
    if (isInstructor) {
      navigate('/dashboard', { replace: true });
      return;
    }
    const why = instructorBlock(auth);
    void signOut();
    if (why) setMsg({ text: why, ok: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, mode, isInstructor]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) return setMsg({ text: 'Enter your registered email.', ok: false });
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

  if (mode === 'register') {
    return (
      <AuthLayout>
        <Register
          onDone={(text) => {
            setMode('in');
            setMsg({ text, ok: true });
          }}
          onCancel={() => setMode('in')}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form className="auth-card" onSubmit={submit}>
        <h2>Instructor sign in</h2>
        <p className="lead">Use the same account as the CvSU CMS mobile app.</p>
        <Field label="Registered email" required>
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
            setMsg(null);
            const err = await signInWithGoogle();
            if (err) {
              setBusy(null);
              setMsg({ text: err, ok: false });
            }
          }}>
          <GoogleLogo /> {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
        </button>
        <p style={{ textAlign: 'center', color: 'var(--text-soft)' }}>
          New instructor?{' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              setMsg(null);
              setMode('register');
            }}>
            Register here
          </button>
        </p>
      </form>
    </AuthLayout>
  );
}

/** Instructor registration: creates the account with a Pending application for an administrator to review. */
function Register({ onDone, onCancel }: { onDone: (msg: string) => void; onCancel: () => void }) {
  const [v, setV] = useState({ full_name: '', email: '', password: '', employee_id: '', department: '', contact_number: '' });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof v, val: string) => setV({ ...v, [k]: val });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!v.full_name.trim()) return setErr('Enter your full name.');
    if (!v.email.includes('@')) return setErr('Enter your email address.');
    if (v.password.length < 8 || !/[a-z]/i.test(v.password) || !/[0-9]/.test(v.password)) return setErr('Use at least 8 characters with letters and numbers.');
    if (!v.employee_id.trim()) return setErr('Enter your employee / faculty ID.');
    if (!v.department.trim()) return setErr('Enter your department.');
    if (!phValid(v.contact_number)) return setErr('Enter a Philippine mobile number: 10 digits after +63, starting with 9 (e.g. 917 123 4567).');
    if (file && file.size > 10 * 1024 * 1024) return setErr('The document must be 10 MB or smaller.');
    setBusy(true);
    setErr(null);
    try {
      // The role sent here only opens a Pending application; the database never grants instructor access from it.
      const { data, error } = await supabase.auth.signUp({
        email: v.email.trim().toLowerCase(),
        password: v.password,
        options: {
          data: {
            full_name: v.full_name.trim(),
            role: 'instructor',
            employee_id: v.employee_id.trim(),
            department: v.department.trim(),
            contact_number: v.contact_number.trim(),
          },
        },
      });
      if (error) throw new Error(error.message);
      if (data.session && data.user) {
        if (file) {
          const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-80) || 'proof';
          const path = `${data.user.id}/${Date.now()}-${safe}`;
          const up = await supabase.storage.from('instructor-proofs').upload(path, file, { contentType: file.type || 'application/octet-stream' });
          if (up.error) throw new Error(`Account created, but the document didn’t upload: ${up.error.message}. You can add it later in the mobile app.`);
          const sub = await supabase.rpc('submit_instructor_application', {
            _full_name: v.full_name.trim(),
            _employee_id: v.employee_id.trim(),
            _department: v.department.trim(),
            _contact_number: v.contact_number.trim(),
            _proof_path: path,
          });
          if (sub.error) throw new Error(sub.error.message);
        }
        await supabase.auth.signOut({ scope: 'local' });
        onDone('Application submitted! Its status is Pending. You can sign in here once an administrator approves it.');
      } else {
        onDone('Application created! Confirm your email first. Your application stays Pending until an administrator approves it.');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth-card" onSubmit={submit} style={{ maxWidth: 460 }}>
      <button type="button" className="link" onClick={onCancel} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}>
        <Icon name="arrowLeft" size={16} /> Back to sign in
      </button>
      <h2>Register as instructor</h2>
      <p className="lead">An administrator verifies every instructor before this website and the mobile app open.</p>
      <Field label="Full name" required>
        <input className="input" value={v.full_name} onChange={(e) => set('full_name', e.target.value)} autoComplete="name" />
      </Field>
      <div className="form-grid">
        <Field label="Email" required>
          <input className="input" type="email" value={v.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" />
        </Field>
        <Field label="Password" required hint="At least 8 characters">
          <input className="input" type="password" value={v.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
        </Field>
      </div>
      <div className="form-grid">
        <Field label="Employee / faculty ID" required>
          <input className="input" value={v.employee_id} onChange={(e) => set('employee_id', e.target.value)} placeholder="CvSU-2019-0142" />
        </Field>
        <Field label="Contact number" required>
          <PhoneInput value={v.contact_number} onChange={(t) => set('contact_number', t)} />
        </Field>
      </div>
      <Field label="Department" required>
        <input className="input" value={v.department} onChange={(e) => set('department', e.target.value)} placeholder="Department of Information Technology" />
      </Field>
      <Field label="Supporting document (optional)" hint="Faculty ID or appointment paper · PDF or image, up to 10 MB">
        <input className="input" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
      {err ? <Notice msg={{ text: err, ok: false }} /> : null}
      <button className="btn btn-primary btn-block" disabled={busy}>
        {busy ? 'Submitting…' : 'Submit application'}
      </button>
    </form>
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
    setMsg({ text: 'Password updated. Taking you to your dashboard…', ok: true });
    setTimeout(() => navigate('/dashboard', { replace: true }), 1200);
  };

  if (link.phase !== 'ready') {
    return (
      <AuthLayout>
        <div className="auth-card">
          <h2>{link.phase === 'checking' ? 'Checking your reset link…' : 'Reset link problem'}</h2>
          {link.phase === 'invalid' ? <Notice msg={{ text: link.reason, ok: false }} /> : <p className="lead">One moment.</p>}
          {link.phase === 'invalid' ? (
            <button type="button" className="btn btn-primary btn-block" onClick={() => navigate('/login', { replace: true })}>
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
        <p className="lead">Choose a new password. It works on this website and in the mobile app.</p>
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
