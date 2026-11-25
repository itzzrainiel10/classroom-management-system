import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { Icon } from '../components/icons';
import { useWorkspace } from '../components/Shell';
import { Avatar, CardHead, Empty, Field, PageHeader, RoleChip, StatusBadge, Success } from '../components/ui';
import { classLabel, rolesOf, setStudentSection, updateUser, userRows } from '../lib/data';
import { fmtDate, splitName } from '../lib/format';

export default function EditUser() {
  const { id } = useParams();
  const { w, refresh } = useWorkspace();
  const navigate = useNavigate();
  const profile = w.profiles.find((p) => p.id === id);
  const row = userRows(w).find((u) => u.id === id);
  const roles = id ? rolesOf(w, id) : [];
  const currentRole: 'student' | 'instructor' = roles.includes('instructor') ? 'instructor' : 'student';

  const initial = splitName(profile?.full_name ?? '');
  const [first, setFirst] = useState(initial.first);
  const [last, setLast] = useState(initial.last);
  const [studentNo, setStudentNo] = useState(profile?.student_number ?? '');
  const [status, setStatus] = useState<'active' | 'suspended'>(profile?.status ?? 'active');
  const role = currentRole;
  const [sectionId, setSectionId] = useState(profile?.section_id ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!profile || !row) {
    return <Empty icon="user" title="User not found" body="This account may have been removed."><Link className="btn btn-secondary" to="/users">Back to users</Link></Empty>;
  }

  const enrolled = w.enrollments.filter((e) => e.email === profile.email).map((e) => w.classes.find((c) => c.id === e.class_id)).filter(Boolean);
  const teaching = w.classes.filter((c) => c.instructor_id === profile.id);
  const classes = role === 'instructor' ? teaching : enrolled;

  const save = async () => {
    const full = `${first.trim()} ${last.trim()}`.trim();
    if (!full) return setErr('Enter a name.');
    setBusy(true);
    setErr(null);
    try {
      await updateUser(profile.id, { full_name: full, student_number: studentNo.trim(), status });
      if (role === 'student' && (sectionId || null) !== (profile.section_id ?? null)) await setStudentSection(profile.id, sectionId || null);
      await refresh();
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Edit user"
        subtitle="Update profile information."
        actions={
          <>
            <Link to="/users" className="btn btn-secondary">
              Cancel
            </Link>
            <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </>
        }
      />
      {err ? <div className="note red"><Icon name="alert" /><div>{err}</div></div> : null}

      <div className="card card-pad row row-wrap" style={{ gap: 16 }}>
        <Avatar name={row.name} lg />
        <div style={{ flex: 1, minWidth: 200 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800 }}>{row.name}</h2>
          <div style={{ color: 'var(--text-soft)' }}>{profile.email}</div>
        </div>
        <div className="row">
          <RoleChip role={row.role} isAdmin={row.isAdmin} />
          {row.isAdmin && row.role !== 'none' ? <RoleChip role="admin" /> : null}
          <StatusBadge status={row.status} />
        </div>
        <small style={{ color: 'var(--muted)', width: '100%' }}>Member since {fmtDate(profile.created_at)}</small>
      </div>

      <div className="card">
          <CardHead title="Profile details" />
          <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-grid">
              <Field label="First name">
                <input className="input" value={first} onChange={(e) => setFirst(e.target.value)} />
              </Field>
              <Field label="Last name">
                <input className="input" value={last} onChange={(e) => setLast(e.target.value)} />
              </Field>
            </div>
            <Field label="University email" hint="Used to sign in and to match class rosters. It can’t be changed here.">
              <input className="input" value={profile.email} disabled />
            </Field>
            <div className="form-grid">
              <Field label="Student number">
                <input className="input" value={studentNo} onChange={(e) => setStudentNo(e.target.value)} placeholder="e.g. 2026-01428" />
              </Field>
              <Field label="Account status">
                <select className="select" value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'suspended')}>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </select>
              </Field>
            </div>
            {role === 'student' ? (
              <Field label="Section" hint="The student sees this section’s official schedule in the mobile app.">
                <select className="select" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                  <option value="">No section</option>
                  {w.sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · Year {s.year_level}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {status === 'suspended' ? (
              <div className="note red">
                <Icon name="alert" />
                <div>Suspended accounts are signed out of the mobile app and lose access to class data.</div>
              </div>
            ) : null}
          </div>
      </div>

      <div className="card">
        <CardHead title={role === 'instructor' ? 'Classes taught' : 'Enrolled classes'} sub={`${classes.length} class${classes.length === 1 ? '' : 'es'}`} />
        {classes.length ? (
          <div className="list">
            {classes.map((c) =>
              c ? (
                <button key={c.id} className="list-item" style={{ border: 0, background: 'none', textAlign: 'left', cursor: 'pointer', width: '100%' }} onClick={() => navigate(`/classes?class=${c.id}`)}>
                  <span className="ic">
                    <Icon name="book" size={16} />
                  </span>
                  <div className="grow">
                    <b>
                      {c.code} · {c.title}
                    </b>
                    <small>{classLabel(c)}</small>
                  </div>
                  <Icon name="arrowRight" size={16} />
                </button>
              ) : null,
            )}
          </div>
        ) : (
          <Empty icon="book" title="No classes yet" body={role === 'instructor' ? 'Assign this instructor to a class on the Classes page.' : 'Enroll this student from the Classes page.'} />
        )}
      </div>

      {done ? <Success title="User updated" body={`${first} ${last}’s profile has been saved.`} onDone={() => navigate('/users')} /> : null}
    </>
  );
}
