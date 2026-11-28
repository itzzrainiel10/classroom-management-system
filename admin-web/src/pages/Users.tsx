import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { Icon } from '../components/icons';
import { Pager, usePaged } from '../components/pager';
import { useWorkspace } from '../layouts/AdminLayout';
import { Confirm, Empty, Field, Modal, PageHeader, Person, RoleChip, StatusBadge, Success } from '../components/ui';
import { cancelInvitation, classLabel, deleteUser, inviteUser, userRows, type UserRow } from '../services/data';
import { fmtNum } from '../services/format';
import EditUser from './EditUser';

type Tab = 'all' | 'instructor' | 'student';

/** All users, or (Student Management) only one role when `only` is set. */
export default function Users({ only }: { only?: 'student' | 'instructor' } = {}) {
  const { w, refresh } = useWorkspace();
  const { id: editId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>(only ?? 'all');
  useEffect(() => setTab(only ?? 'all'), [only]);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [inviting, setInviting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<(UserRow & { id: string; currentClasses: number }) | null>(null);
  const [deleted, setDeleted] = useState<string | null>(null);

  useEffect(() => setQ(params.get('q') ?? ''), [params]);

  const all = useMemo(() => userRows(w), [w]);
  const counts = { all: all.length, instructor: all.filter((u) => u.role === 'instructor').length, student: all.filter((u) => u.role === 'student').length };
  const needle = q.trim().toLowerCase();
  const rows = all
    .filter((u) => tab === 'all' || u.role === tab)
    .filter((u) => !needle || u.name.toLowerCase().includes(needle) || u.email.includes(needle) || u.student_number.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));
  const { shown, paging } = usePaged(rows, `${tab}|${q}`);

  return (
    <>
      <PageHeader
        title={only === 'student' ? 'Students' : 'Users'}
        subtitle={only === 'student' ? 'Every student account, their section and status. Click a student to edit.' : 'Everyone with an account. Click a person to edit their details.'}
        actions={
          <button className="btn btn-primary" onClick={() => setInviting(true)}>
            <Icon name="plus" size={16} /> Add user
          </button>
        }
      />

      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <div className="tabs" role="tablist">
            {(only ? [only] : (['all', 'instructor', 'student'] as Tab[])).map((t) => (
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
                  <tr
                    key={u.email}
                    className={u.id ? 'clickable' : undefined}
                    onClick={(e) => {
                      // whole row opens the user; buttons/links inside keep their own action
                      if (u.id && !(e.target as HTMLElement).closest('a, button')) navigate(`/admin/users/${u.id}`);
                    }}>
                    <td>
                      <Person name={u.name} sub={u.email} />
                    </td>
                    <td>
                      {u.application ? (
                        <span className={`badge ${u.application === 'pending' ? 'gold' : 'red'}`} style={{ marginRight: 6 }}>
                          Instructor {u.application === 'pending' ? 'applicant' : u.application}
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
                        <div className="row" style={{ justifyContent: 'flex-end', gap: 6, flexWrap: 'nowrap' }}>
                          <Link
                            to={`/admin/users/${u.id}`}
                            className="btn btn-secondary btn-sm"
                            aria-label={`Edit ${u.name}`}
                            title={`Edit ${u.name}`}>
                            <Icon name="edit" size={14} />
                          </Link>
                          {!u.isAdmin ? (
                            <button
                              className="btn btn-danger btn-sm"
                              aria-label={`Delete ${u.name}`}
                              title={`Delete ${u.name}`}
                              onClick={() =>
                                setDeleting({
                                  ...u,
                                  id: u.id!,
                                  currentClasses: w.classes.filter((c) => c.instructor_id === u.id).length,
                                })
                              }>
                              <Icon name="trash" size={14} />
                            </button>
                          ) : null}
                        </div>
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
        <Pager paging={paging} noun="users" />
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
      {deleting ? (
        <Confirm
          title={`Delete ${deleting.name}?`}
          body={`This permanently removes their account and login. ${
            deleting.role === 'instructor'
              ? `Their ${deleting.currentClasses} current class(es) and everything in them will also be removed; archived semesters keep their records.`
              : 'Existing class and assessment records may remain in reports.'
          } This cannot be undone.`}
          confirmLabel="Delete user"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const result = await deleteUser(deleting.id);
            setDeleting(null);
            await refresh();
            setDeleted(result.name);
          }}
        />
      ) : null}
      {deleted ? <Success title="User deleted" body={`${deleted}’s account has been removed.`} onDone={() => setDeleted(null)} /> : null}
      {editId ? <EditUser key={editId} id={editId} onClose={() => navigate('/admin/users')} /> : null}
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
