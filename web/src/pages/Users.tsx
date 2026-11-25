import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { Icon } from '../components/icons';
import { useWorkspace } from '../components/Shell';
import { Empty, Field, Modal, PageHeader, Person, RoleChip, StatusBadge, Success } from '../components/ui';
import { cancelInvitation, classLabel, inviteUser, userRows } from '../lib/data';
import { fmtNum } from '../lib/format';

const PAGE = 10;
type Tab = 'all' | 'instructor' | 'student';

export default function Users() {
  const { w, refresh } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [page, setPage] = useState(0);
  const [inviting, setInviting] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => setQ(params.get('q') ?? ''), [params]);
  useEffect(() => setPage(0), [tab, q]);

  const all = useMemo(() => userRows(w), [w]);
  const counts = { all: all.length, instructor: all.filter((u) => u.role === 'instructor').length, student: all.filter((u) => u.role === 'student').length };
  const needle = q.trim().toLowerCase();
  const rows = all
    .filter((u) => tab === 'all' || u.role === tab)
    .filter((u) => !needle || u.name.toLowerCase().includes(needle) || u.email.includes(needle) || u.student_number.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);

  return (
    <>
      <PageHeader
        title="Users & roles"
        subtitle="Control access for instructors and students."
        actions={
          <button className="btn btn-primary" onClick={() => setInviting(true)}>
            <Icon name="plus" size={16} /> Add user
          </button>
        }
      />

      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <div className="tabs" role="tablist">
            {(['all', 'instructor', 'student'] as Tab[]).map((t) => (
              <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} role="tab" aria-selected={tab === t}>
                {t === 'all' ? 'All users' : t === 'instructor' ? 'Instructors' : 'Students'}
                <span className="n">{fmtNum(counts[t])}</span>
              </button>
            ))}
          </div>
          <div className="search" style={{ margin: 0, maxWidth: 360 }}>
            <Icon name="search" size={16} />
            <input
              placeholder="Search by name, university email or student number"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                if (params.get('q')) setParams({}, { replace: true });
              }}
              aria-label="Search directory"
            />
          </div>
        </div>
        {shown.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name / university email</th>
                  <th>Role</th>
                  <th>Section</th>
                  <th>Status</th>
                  <th className="num" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => (
                  <tr key={u.email}>
                    <td>
                      <Person name={u.name} sub={u.email} />
                    </td>
                    <td>
                      {u.application ? (
                        <span className={`badge ${u.application === 'pending' ? 'gold' : 'red'}`} style={{ marginRight: 6 }}>
                          Instructor {u.application === 'pending' ? 'applicant' : 'rejected'}
                        </span>
                      ) : null}
                      {u.application && u.role === 'none' ? null : <RoleChip role={u.role} isAdmin={u.isAdmin} />}
                      {u.isAdmin && u.role !== 'none' && u.role !== 'admin' ? (
                        <>
                          {' '}
                          <RoleChip role="admin" />
                        </>
                      ) : null}
                    </td>
                    <td>{u.section}</td>
                    <td>
                      <StatusBadge status={u.status} />
                    </td>
                    <td className="num">
                      {u.id ? (
                        <Link to={`/users/${u.id}`} className="btn btn-secondary btn-sm">
                          Edit
                        </Link>
                      ) : (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={async () => {
                            if (!confirm(`Cancel the invitation for ${u.email}?`)) return;
                            await cancelInvitation(u.email);
                            await refresh();
                          }}>
                          Cancel invite
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="users" title={needle ? 'No matching users' : 'No users yet'} body={needle ? 'Try a different name, email or student number.' : 'Accounts appear here when people sign up in the mobile app.'} />
        )}
        <div className="table-foot">
          <span>
            Showing {rows.length ? page * PAGE + 1 : 0}–{Math.min(rows.length, page * PAGE + PAGE)} of {fmtNum(rows.length)} users
          </span>
          <div className="row">
            <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <button className="btn btn-secondary btn-sm" disabled={(page + 1) * PAGE >= rows.length} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </div>
      </div>

      {inviting ? (
        <InviteModal
          onClose={() => setInviting(false)}
          onSaved={async (email) => {
            setInviting(false);
            await refresh();
            setDone(email);
          }}
        />
      ) : null}
      {done ? (
        <Success title="Invitation saved" body={`${done} gets this role (and class) as soon as they sign up in the CvSU CMS app with this email.`} onDone={() => setDone(null)} />
      ) : null}
    </>
  );
}

function InviteModal({ onClose, onSaved }: { onClose: () => void; onSaved: (email: string) => void }) {
  const { w } = useWorkspace();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'student' | 'instructor'>('student');
  const [classId, setClassId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) return setErr('Enter the full name.');
    if (!email.includes('@')) return setErr('Enter a university email.');
    setBusy(true);
    setErr(null);
    try {
      await inviteUser({ email, full_name: name, role, class_id: role === 'student' && classId ? classId : null });
      onSaved(email.trim().toLowerCase());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Invite a new user"
      sub="Review the details before saving."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Send invitation'}
          </button>
        </>
      }>
      <Field label="Full name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ethan Garcia" autoFocus />
      </Field>
      <Field label="University email">
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@cvsu.edu.ph" />
      </Field>
      <div className="form-grid">
        <Field label="Role">
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as 'student' | 'instructor')}>
            <option value="student">Student</option>
            <option value="instructor">Instructor</option>
          </select>
        </Field>
        <Field label="Class / section">
          <select className="select" value={classId} onChange={(e) => setClassId(e.target.value)} disabled={role === 'instructor'}>
            <option value="">{role === 'instructor' ? 'Assign later' : 'None yet'}</option>
            {w.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {classLabel(c)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="note gold">
        <Icon name="info" />
        <div>The role applies when this person signs up in the app with this email (email or Google). Students are added to the class right away.</div>
      </div>
      {err ? <div className="error">{err}</div> : null}
    </Modal>
  );
}
