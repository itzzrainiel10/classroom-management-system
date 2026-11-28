import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Icon } from '../components/icons';
import { Pager, usePaged } from '../components/pager';
import { useWorkspace } from '../layouts/AdminLayout';
import { ActionIconButton, Confirm, Empty, ErrorNote, Field, Modal, PageHeader, Person, Tile } from '../components/ui';
import { createInstructor, deleteInstructor, saveInstructor, tempPassword } from '../services/instructors';
import { phStored } from '../services/phone';
import { rolesOf, type InstructorProfile, type Profile } from '../services/data';
import { fmtNum, minutesOf } from '../services/format';

export default function Instructors() {
  const { w, refresh } = useWorkspace();
  const [form, setForm] = useState<{ p?: Profile; ip?: InstructorProfile } | null>(null);
  const [del, setDel] = useState<{ p: Profile; classes: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('all');
  const term = (s: { semester: string; academic_year: string }) => s.semester === w.settings.current_semester && s.academic_year === w.settings.current_academic_year;

  const rows = w.profiles
    .filter((p) => rolesOf(w, p.id).includes('instructor'))
    .map((p) => {
      const ip = w.instructorProfiles.find((x) => x.user_id === p.id);
      const mine = w.schedules.filter((s) => s.instructor_id === p.id && term(s));
      const hours = mine.reduce((n, s) => n + (minutesOf(s.end_time) - minutesOf(s.start_time)) / 60, 0);
      return {
        p,
        ip,
        subjects: new Set(mine.map((s) => s.subject_id)).size,
        sections: [...new Set(mine.map((s) => w.sections.find((x) => x.id === s.section_id)?.name).filter(Boolean))] as string[],
        hours: Math.round(hours * 10) / 10,
      };
    });
  const depts = [...new Set(rows.map((r) => r.ip?.department).filter(Boolean))] as string[];
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) => (dept === 'all' || r.ip?.department === dept) && (!needle || `${r.p.full_name} ${r.p.email} ${r.ip?.employee_id ?? ''}`.toLowerCase().includes(needle)),
  );
  const assigned = rows.filter((r) => r.subjects > 0).length;
  const { shown: pageRows, paging } = usePaged(shown, `${dept}|${q}`);

  return (
    <>
      <PageHeader
        title="Instructors"
        subtitle={`Approved instructors and their teaching load · ${w.settings.current_semester}, AY ${w.settings.current_academic_year}`}
        actions={
          <button className="btn btn-primary" onClick={() => setForm({})}>
            <Icon name="plus" size={16} /> Add instructor
          </button>
        }
      />
      {notice ? (
        <div className="note">
          <Icon name="checkCircle" />
          <div>{notice}</div>
        </div>
      ) : null}
      <div className="grid grid-3">
        <Tile hero icon="school" label="Approved instructors" value={fmtNum(rows.length)} />
        <Tile icon="calendar" label="With classes this term" value={fmtNum(assigned)} sub={`${rows.length - assigned} without a schedule yet`} />
        <Tile icon="clipboard" label="Waiting for verification" value={fmtNum(w.instructorProfiles.filter((a) => a.status === 'pending').length)} sub="See Instructor Verification" />
      </div>
      <div className="filters">
        <div className="search" style={{ margin: 0, flex: '1 1 240px', maxWidth: 320 }}>
          <Icon name="search" size={16} />
          <input placeholder="Search name, email or employee ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search instructors" />
        </div>
        <select className="select" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
          <option value="all">All departments</option>
          {depts.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </div>
      <div className="card">
        {shown.length ? (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Instructor</th>
                    <th>Employee ID · Department</th>
                    <th className="num">Subjects</th>
                    <th>Sections</th>
                    <th className="num">Hours / week</th>
                    <th className="num" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr key={r.p.id}>
                      <td>
                        <Link to={`/admin/users/${r.p.id}`} title="Open profile">
                          <Person name={r.p.full_name || r.p.email} sub={r.p.email} />
                        </Link>
                      </td>
                      <td>
                        <b style={{ whiteSpace: 'nowrap' }}>{r.ip?.employee_id || '—'}</b>
                        <div style={{ color: 'var(--text-soft)', fontSize: 'calc(12.5px * var(--text-scale))' }}>{r.ip?.department || '—'}</div>
                      </td>
                      <td className="num">{r.subjects}</td>
                      <td style={{ maxWidth: 180 }}>{r.sections.join(', ') || '—'}</td>
                      <td className="num">{r.hours}</td>
                      <td className="num">
                        <div className="row" style={{ justifyContent: 'flex-end', gap: 6, flexWrap: 'nowrap' }}>
                          <Link className="btn btn-primary btn-sm" to={`/admin/schedules?instructor=${r.p.id}`}>
                            Schedule
                          </Link>
                          <ActionIconButton action="edit" label={`Edit ${r.p.full_name || r.p.email}`} onClick={() => setForm({ p: r.p, ip: r.ip })} />
                          <ActionIconButton
                            action="delete"
                            label={`Delete ${r.p.full_name || r.p.email}`}
                            onClick={() => setDel({ p: r.p, classes: w.classes.filter((c) => c.instructor_id === r.p.id).length })}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager paging={paging} noun="instructors" />
          </>
        ) : (
          <Empty icon="school" title="No approved instructors" body="Add an instructor, or approve applications on the Instructor applications page." />
        )}
      </div>

      {form ? (
        <InstructorForm
          p={form.p}
          ip={form.ip}
          departments={depts}
          onClose={() => setForm(null)}
          onSaved={async (msg) => {
            setForm(null);
            await refresh();
            setNotice(msg);
          }}
        />
      ) : null}
      {del ? (
        <Confirm
          title={`Delete ${del.p.full_name || del.p.email}?`}
          body={`Their login is removed for good.${del.classes ? ` Their ${del.classes} current class(es) and everything in them are removed too.` : ''} Archived semesters keep their name and records.`}
          confirmLabel="Delete instructor"
          danger
          onClose={() => setDel(null)}
          onConfirm={async () => {
            const r = await deleteInstructor(del.p.id);
            setDel(null);
            await refresh();
            setNotice(`${r.name} was deleted.`);
          }}
        />
      ) : null}
    </>
  );
}

/** Add (new login + approved instructor) or edit an instructor's details. */
function InstructorForm({
  p,
  ip,
  departments,
  onClose,
  onSaved,
}: {
  p?: Profile;
  ip?: InstructorProfile;
  departments: string[];
  onClose: () => void;
  onSaved: (msg: string) => Promise<void>;
}) {
  const adding = !p;
  const [v, setV] = useState({
    full_name: p?.full_name ?? '',
    email: p?.email ?? '',
    password: adding ? tempPassword() : '',
    employee_id: ip?.employee_id ?? '',
    department: ip?.department ?? '',
    contact_number: phStored(ip?.contact_number),
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof v, val: string) => setV({ ...v, [k]: val });

  const save = async () => {
    if (!v.full_name.trim()) return setErr('Enter the full name.');
    if (adding && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) return setErr('Enter a valid email address.');
    if (adding && (v.password.length < 8 || !/[a-z]/i.test(v.password) || !/[0-9]/.test(v.password)))
      return setErr('The password needs at least 8 characters with letters and numbers.');
    setBusy(true);
    setErr(null);
    try {
      const details = { full_name: v.full_name.trim(), employee_id: v.employee_id.trim(), department: v.department.trim(), contact_number: v.contact_number.trim() };
      if (adding) {
        const email = v.email.trim().toLowerCase();
        await createInstructor({ ...details, email, password: v.password });
        await onSaved(`${details.full_name} was added. They can sign in now with ${email} and the temporary password ${v.password}. Ask them to change it with “Forgot password?”.`);
      } else {
        await saveInstructor(p!.id, details);
        await onSaved(`Saved ${details.full_name}’s details.`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={adding ? 'Add instructor' : 'Edit instructor'}
      sub={adding ? 'Creates the login and approves it as an instructor right away.' : p?.email}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : adding ? 'Add instructor' : 'Save changes'}
          </button>
        </>
      }>
      <Field label="Full name" required>
        <input className="input" value={v.full_name} onChange={(e) => set('full_name', e.target.value)} autoFocus />
      </Field>
      {adding ? (
        <div className="form-grid">
          <Field label="Email" required>
            <input className="input" type="email" value={v.email} onChange={(e) => set('email', e.target.value)} placeholder="name@cvsu.edu.ph" />
          </Field>
          <Field label="Temporary password" required hint="Give this to the instructor">
            <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <input className="input" value={v.password} onChange={(e) => set('password', e.target.value)} />
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => set('password', tempPassword())} title="Make a new password">
                New
              </button>
            </div>
          </Field>
        </div>
      ) : null}
      <div className="form-grid">
        <Field label="Employee / faculty ID">
          <input className="input" value={v.employee_id} onChange={(e) => set('employee_id', e.target.value)} placeholder="CvSU-2019-0142" />
        </Field>
      </div>
      <Field label="Department">
        <input className="input" list="instructor-departments" value={v.department} onChange={(e) => set('department', e.target.value)} placeholder="Department of Information Technology" />
        <datalist id="instructor-departments">
          {departments.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
      </Field>
      {err ? <ErrorNote message={err} /> : null}
    </Modal>
  );
}
