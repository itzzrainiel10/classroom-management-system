import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Icon } from '../components/icons';
import { toast } from '../components/toast';
import { CardHead, Confirm, Empty, ErrorNote, Field, Loading, Modal, PageHeader, Person } from '../components/ui';
import { useData } from '../hooks/useData';
import { addStudents, fetchMyClassesWithCounts, fetchRoster, isEmail, removeStudent, renameStudent, type Student } from '../services/teaching';
import { NewClassModal } from './Teaching';

/** My Classes: the instructor's classes and their students (add one, add many, rename, remove). */
export default function MyClasses() {
  const classes = useData(fetchMyClassesWithCounts);
  const [params, setParams] = useSearchParams();
  const classId = params.get('class') ?? '';
  const setClassId = (id: string) => setParams({ class: id }, { replace: true });
  const roster = useData(() => (classId ? fetchRoster(classId) : Promise.resolve([] as Student[])), [classId]);
  const [q, setQ] = useState('');
  const [modal, setModal] = useState<'one' | 'many' | 'class' | null>(null);
  const [rename, setRename] = useState<Student | null>(null);
  const [del, setDel] = useState<Student | null>(null);

  useEffect(() => {
    if (classes.data?.length && !classes.data.some((c) => c.id === classId)) setClassId(classes.data[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classes.data, classId]);

  const cls = classes.data?.find((c) => c.id === classId);
  const needle = q.trim().toLowerCase();
  const rows = (roster.data ?? []).filter((s) => !needle || s.full_name.toLowerCase().includes(needle) || s.email.includes(needle));
  const refreshAll = async () => {
    await Promise.all([roster.refresh(), classes.refresh()]);
  };

  if (classes.error) return <ErrorNote message={classes.error} />;
  if (!classes.data) return <Loading />;

  return (
    <>
      <PageHeader
        title="My Classes"
        subtitle="Your classes and the students in them. Students you add see the class, quizzes, assignments and attendance in the mobile app."
        actions={
          <button className="btn btn-secondary" onClick={() => setModal('class')}>
            <Icon name="plus" size={16} /> New class
          </button>
        }
      />

      {!classes.data.length ? (
        <div className="card">
          <Empty icon="book" title="No classes yet" body="Create a class, then add your students by their email.">
            <button className="btn btn-primary" onClick={() => setModal('class')}>
              <Icon name="plus" size={16} /> New class
            </button>
          </Empty>
        </div>
      ) : (
        <div className="grid classes-layout">
          <div className="card">
            <CardHead title="Classes" sub={`${classes.data.length} total`} />
            <div className="list">
              {classes.data.map((c) => (
                <button key={c.id} className={`list-item class-pick${c.id === classId ? ' on' : ''}`} onClick={() => setClassId(c.id)}>
                  <span className="ic">
                    <Icon name="book" size={16} />
                  </span>
                  <span className="grow" style={{ textAlign: 'left' }}>
                    <b>
                      {c.code} · {c.section}
                    </b>
                    <small>{c.title}</small>
                  </span>
                  <span className="badge gray plain">{c.students}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <CardHead
              title={cls ? `${cls.code} · ${cls.title}` : 'Students'}
              sub={cls ? `Section ${cls.section} · ${roster.data?.length ?? 0} student${roster.data?.length === 1 ? '' : 's'}` : undefined}
              right={
                <div className="row row-wrap">
                  <button className="btn btn-secondary btn-sm" onClick={() => setModal('many')} disabled={!cls}>
                    <Icon name="users" size={14} /> Add many
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={() => setModal('one')} disabled={!cls}>
                    <Icon name="plus" size={14} /> Add student
                  </button>
                </div>
              }
            />
            {roster.data && roster.data.length > 5 ? (
              <div style={{ padding: '12px 20px 0' }}>
                <div className="search" style={{ margin: 0, maxWidth: 'none' }}>
                  <Icon name="search" size={16} />
                  <input placeholder="Search students by name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search students" />
                </div>
              </div>
            ) : null}
            {roster.error ? <ErrorNote message={roster.error} /> : null}
            {!roster.data ? (
              <div className="card-pad">
                <Loading />
              </div>
            ) : rows.length ? (
              <div className="table-wrap" style={{ marginTop: roster.data.length > 5 ? 12 : 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th className="num" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <Person name={s.full_name || s.email} sub={s.email} />
                        </td>
                        <td className="num" style={{ whiteSpace: 'nowrap' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => setRename(s)}>
                            <Icon name="edit" size={14} /> Rename
                          </button>
                          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setDel(s)} aria-label={`Remove ${s.full_name || s.email}`}>
                            <Icon name="trash" size={14} /> Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty icon="users" title={needle ? 'No matching students' : 'No students yet'} body={needle ? 'Try another name or email.' : 'Add students by their CvSU email. They see this class when they sign in to the mobile app with that email.'}>
                {!needle && cls ? (
                  <button className="btn btn-primary" onClick={() => setModal('one')}>
                    <Icon name="plus" size={16} /> Add student
                  </button>
                ) : null}
              </Empty>
            )}
          </div>
        </div>
      )}

      {modal === 'class' ? (
        <NewClassModal
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await classes.refresh();
            toast.success('Class created', 'Now add your students.');
          }}
        />
      ) : null}
      {modal === 'one' && cls ? <AddOne classId={cls.id} label={`${cls.code} · ${cls.section}`} onClose={() => setModal(null)} onSaved={refreshAll} /> : null}
      {modal === 'many' && cls ? <AddMany classId={cls.id} label={`${cls.code} · ${cls.section}`} onClose={() => setModal(null)} onSaved={refreshAll} /> : null}
      {rename ? <RenameStudent student={rename} onClose={() => setRename(null)} onSaved={refreshAll} /> : null}
      {del ? (
        <Confirm
          title={`Remove ${del.full_name || del.email}?`}
          body="They will no longer see this class, its quizzes, assignments or attendance. Their past quiz scores stay in your results."
          confirmLabel="Remove student"
          danger
          onClose={() => setDel(null)}
          onConfirm={async () => {
            await removeStudent(del.id);
            toast.success('Student removed', del.email);
            setDel(null);
            await refreshAll();
          }}
        />
      ) : null}
    </>
  );
}

function AddOne({ classId, label, onClose, onSaved }: { classId: string; label: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async (again: boolean) => {
    if (!isEmail(email)) return setErr('Enter a valid email address.');
    if (!name.trim()) return setErr('Enter the student’s name.');
    setBusy(true);
    setErr(null);
    try {
      const r = await addStudents(classId, [{ email, full_name: name }]);
      if (!r.added) {
        setErr('This email is already in the class.');
        setBusy(false);
        return;
      }
      toast.success('Student added', `${name.trim()} · ${label}`);
      await onSaved();
      if (again) {
        setEmail('');
        setName('');
        setBusy(false);
      } else onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Add a student"
      sub={label}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-secondary" onClick={() => void save(true)} disabled={busy}>
            Add & next
          </button>
          <button className="btn btn-primary" onClick={() => void save(false)} disabled={busy}>
            {busy ? 'Adding…' : 'Add student'}
          </button>
        </>
      }>
      <Field label="Student email" required hint="Use the email the student signs in with in the mobile app.">
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@cvsu.edu.ph" autoFocus />
      </Field>
      <Field label="Full name" required>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ella Garcia" onKeyDown={(e) => e.key === 'Enter' && void save(true)} />
      </Field>
      {err ? <ErrorNote message={err} /> : null}
    </Modal>
  );
}

/** One student per line: "email, Full Name" (or "Full Name, email", or tab-separated from Excel). */
function parseList(text: string) {
  const ok: { email: string; full_name: string }[] = [];
  const bad: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/[,\t;]/).map((p) => p.trim()).filter(Boolean);
    const email = parts.find((p) => isEmail(p));
    const name = parts.filter((p) => p !== email).join(' ');
    if (email) ok.push({ email, full_name: name });
    else bad.push(line);
  }
  return { ok, bad };
}

function AddMany({ classId, label, onClose, onSaved }: { classId: string; label: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { ok, bad } = parseList(text);
  const save = async () => {
    if (!ok.length) return setErr('Paste at least one line with an email address.');
    setBusy(true);
    setErr(null);
    try {
      const r = await addStudents(classId, ok);
      toast.success(`${r.added} student${r.added === 1 ? '' : 's'} added`, r.skipped ? `${r.skipped} skipped (already in the class or listed twice).` : label);
      await onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Add many students"
      sub={`${label} · paste one student per line`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy || !ok.length}>
            {busy ? 'Adding…' : `Add ${ok.length || ''} student${ok.length === 1 ? '' : 's'}`}
          </button>
        </>
      }>
      <Field label="Students" hint="Format: email, Full Name — one per line. You can paste two columns straight from Excel or Google Sheets.">
        <textarea
          className="textarea"
          style={{ minHeight: 180, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 13 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'ella.garcia@cvsu.edu.ph, Ella Garcia\npaolo.ramos@cvsu.edu.ph, Paolo Ramos'}
          autoFocus
        />
      </Field>
      {text.trim() ? (
        <div className={`note${bad.length ? ' gold' : ''}`}>
          <Icon name={bad.length ? 'alert' : 'check'} />
          <div>
            <b>{ok.length}</b> ready to add{ok.some((s) => !s.full_name) ? ' (some without a name — you can rename them later)' : ''}.
            {bad.length ? (
              <>
                {' '}
                <b>{bad.length}</b> line{bad.length === 1 ? '' : 's'} without an email will be skipped: <i>{bad.slice(0, 3).join(' · ')}</i>
                {bad.length > 3 ? '…' : ''}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      {err ? <ErrorNote message={err} /> : null}
    </Modal>
  );
}

function RenameStudent({ student, onClose, onSaved }: { student: Student; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(student.full_name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!name.trim()) return setErr('Enter a name.');
    setBusy(true);
    try {
      await renameStudent(student.id, name);
      toast.success('Name updated', name.trim());
      await onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Rename student"
      sub={student.email}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            Save
          </button>
        </>
      }>
      <Field label="Full name" required>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && void save()} />
      </Field>
      {err ? <ErrorNote message={err} /> : null}
    </Modal>
  );
}
