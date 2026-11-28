import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Icon } from '../components/icons';
import { toast } from '../components/toast';
import { useWorkspace } from '../layouts/AdminLayout';
import { Avatar, CardHead, Empty, ErrorNote, Field, Modal, RoleChip, StatusBadge } from '../components/ui';
import { classLabel, rolesOf, setStudentSection, updateUser, userRows } from '../services/data';
import { fmtDate, splitName } from '../services/format';

export default function EditUser({ id, onClose }: { id: string; onClose: () => void }) {
  const { w, refresh } = useWorkspace();
  const profile = w.profiles.find((p) => p.id === id);
  const row = userRows(w).find((u) => u.id === id);
  const roles = rolesOf(w, id);
  const role: 'student' | 'instructor' = roles.includes('instructor') ? 'instructor' : 'student';

  const initial = splitName(profile?.full_name ?? '');
  const [first, setFirst] = useState(initial.first);
  const [last, setLast] = useState(initial.last);
  const [studentNo, setStudentNo] = useState(profile?.student_number ?? '');
  const [status, setStatus] = useState<'active' | 'inactive' | 'suspended'>(profile?.status === 'suspended' ? 'suspended' : profile?.is_inactive ? 'inactive' : 'active');
  const [reason, setReason] = useState(profile?.suspension_reason ?? '');
  const [sectionId, setSectionId] = useState(profile?.section_id ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!profile || !row) {
    return (
      <Modal title="User not found" sub="This account may have been removed." onClose={onClose} footer={<button className="btn btn-secondary" onClick={onClose}>Close</button>}>
        <Empty icon="user" title="User not found" body="Return to the users list and refresh the page." />
      </Modal>
    );
  }

  const enrolled = w.enrollments.filter((e) => e.email === profile.email).map((e) => w.classes.find((c) => c.id === e.class_id)).filter(Boolean);
  const teaching = w.classes.filter((c) => c.instructor_id === profile.id);
  const classes = role === 'instructor' ? teaching : enrolled;

  const save = async () => {
    const full = `${first.trim()} ${last.trim()}`.trim();
    if (!full) return setErr('Enter a name.');
    if (status === 'suspended' && !reason.trim()) return setErr('Give a reason for the suspension. The person will see it.');
    setBusy(true);
    setErr(null);
    try {
      await updateUser(profile.id, { full_name: full, student_number: studentNo.trim(), status, suspension_reason: status === 'suspended' ? reason.trim() : '' });
      if (role === 'student' && (sectionId || null) !== (profile.section_id ?? null)) await setStudentSection(profile.id, sectionId || null);
      await refresh();
      toast.success('User updated', `${full}’s profile has been saved.`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Edit user"
      sub={`${row.name} · ${profile.email}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }>
      <div className="row row-wrap" style={{ gap: 12 }}>
        <Avatar name={row.name} lg />
        <div className="grow">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <RoleChip role={row.role} isAdmin={row.isAdmin} />
            {row.isAdmin && row.role !== 'none' ? <RoleChip role="admin" /> : null}
            <StatusBadge status={row.status} />
          </div>
          <small style={{ color: 'var(--muted)' }}>Member since {fmtDate(profile.created_at)}</small>
        </div>
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
            <Field label="Account status" hint="Inactive is a directory label only and does not block sign-in.">
              <select className="select" value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'inactive' | 'suspended')}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
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
            <>
              <Field label="Reason for suspension" required hint="Shown to the person in the app and on the website, and sent to them as a notification.">
                <textarea className="textarea" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Unpaid fees — please visit the Registrar" />
              </Field>
              <div className="note red">
                <Icon name="alert" />
                <div>Suspended accounts are signed out of the app and website and lose access to class data. They see this reason when they try to sign in.</div>
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="card">
        <CardHead title={role === 'instructor' ? 'Classes taught' : 'Enrolled classes'} sub={`${classes.length} class${classes.length === 1 ? '' : 'es'}`} />
        {classes.length ? (
          <div className="list">
            {classes.map((c) =>
              c ? (
                <Link key={c.id} to={`/admin/classes?class=${c.id}`} className="list-item" style={{ textDecoration: 'none' }}>
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
                </Link>
              ) : null,
            )}
          </div>
        ) : (
          <Empty icon="book" title="No classes yet" body={role === 'instructor' ? 'Assign this instructor to a class on the Classes page.' : 'Enroll this student from the Classes page.'} />
        )}
      </div>
      {err ? <ErrorNote message={err} /> : null}
    </Modal>
  );
}
