import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { Icon } from '../components/icons';
import { Pager, usePaged } from '../components/pager';
import { useWorkspace } from '../layouts/AdminLayout';
import { Empty, Field, Modal, PageHeader, Person, Success, Tile } from '../components/ui';
import { classStats, enrollStudent, nameOf, removeEnrollment, rolesOf, setClassRoom, studentScore, updateClass } from '../services/data';
import { fmtNum, fmtPct } from '../services/format';
import { supabase } from '../services/supabase';

type Dialog = 'enroll' | 'section' | null;

export default function Classes({ embedded = false }: { embedded?: boolean } = {}) {
  const { w, refresh } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [done, setDone] = useState<{ title: string; body: string } | null>(null);
  const selectedId = params.get('class') ?? w.classes[0]?.id ?? '';
  const cls = w.classes.find((c) => c.id === selectedId);

  useEffect(() => {
    if (!params.get('class') && w.classes[0]) setParams({ class: w.classes[0].id }, { replace: true });
  }, [params, setParams, w.classes]);

  const sections = new Set(w.classes.map((c) => c.section).filter(Boolean)).size;
  const enrolledStudents = new Set(w.enrollments.map((e) => e.email)).size;
  const stats = cls ? classStats(w, cls.id) : null;
  const { shown: pageStudents, paging } = usePaged(stats?.students ?? [], cls?.id);

  return (
    <>
      {embedded ? (
        <div className="tab-toolbar">
          <span>One class per subject. Classes come from Schedules automatically.</span>
          <Link className="btn btn-primary" to="/admin/schedules">
              <Icon name="plus" size={16} /> Add schedule
            </Link>
        </div>
      ) : (
        <PageHeader
          title="Classes"
          subtitle="One class per subject. A class is created automatically when you schedule a subject for a section and instructor, with the section’s students enrolled."
          actions={
            <Link className="btn btn-primary" to="/admin/schedules">
              <Icon name="plus" size={16} /> Add schedule
            </Link>
          }
        />
      )}

      <div className="grid grid-3">
        <Tile hero icon="book" label="Active classes" value={fmtNum(w.classes.length)} />
        <Tile icon="school" label="Sections" value={fmtNum(sections)} />
        <Tile icon="users" label="Enrolled students" value={fmtNum(enrolledStudents)} sub="Unique students across all classes" />
      </div>

      {cls && stats ? (
        <div className="card">
          <div className="card-head" style={{ flexWrap: 'wrap' }}>
            <div className="row row-wrap" style={{ gap: 14 }}>
              <select className="select" style={{ width: 'auto', minWidth: 260, fontWeight: 700 }} value={cls.id} onChange={(e) => setParams({ class: e.target.value })} aria-label="Class">
                {w.classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.title}
                    {c.section ? ` — ${c.section}` : ''}
                  </option>
                ))}
              </select>
              <div style={{ color: 'var(--text-soft)', fontSize: 'calc(13px * var(--text-scale))' }}>
                Instructor: <b style={{ color: 'var(--text)' }}>{nameOf(w, cls.instructor_id)}</b>
              </div>
            </div>
            <div className="row">
              <button className="btn btn-secondary btn-sm" onClick={() => setDialog('section')}>
                <Icon name="edit" size={14} /> Manage section
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => setDialog('enroll')}>
                <Icon name="plus" size={14} /> Enroll student
              </button>
            </div>
          </div>
          <div className="kv" style={{ padding: '16px 20px 0' }}>
            <div>
              <small>Published quizzes / exams</small>
              <b>{stats.quizzes.length}</b>
            </div>
            <div>
              <small>Average score</small>
              <b>{fmtPct(stats.avgScore)}</b>
            </div>
            <div>
              <small>Quiz completion</small>
              <b>{fmtPct(stats.completion)}</b>
            </div>
          </div>
          {stats.students.length ? (
            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Student number</th>
                    <th>Enrollment</th>
                    <th className="num">Avg. score</th>
                    <th className="num" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {pageStudents.map((s) => {
                    const p = w.profiles.find((x) => x.email === s.email);
                    return (
                      <tr key={s.id}>
                        <td>
                          <Person name={p?.full_name || s.full_name || s.email} sub={s.email} />
                        </td>
                        <td>{p?.student_number || '—'}</td>
                        <td>{p ? <span className="badge green">Enrolled</span> : <span className="badge gold">Waiting for sign-up</span>}</td>
                        <td className="num">{fmtPct(studentScore(w, cls.id, s.email))}</td>
                        <td className="num">
                          <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                            {p ? (
                              <Link className="btn btn-secondary btn-sm" to={`/admin/users/${p.id}`}>
                                View
                              </Link>
                            ) : null}
                            <button
                              className="btn btn-ghost btn-sm"
                              aria-label={`Remove ${s.email}`}
                              onClick={async () => {
                                if (!confirm(`Remove ${p?.full_name || s.email} from ${cls.code}?`)) return;
                                await removeEnrollment(s.id);
                                await refresh();
                              }}>
                              <Icon name="trash" size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="users" title="No students yet" body="Enroll students by university email or student number.">
              <button className="btn btn-primary btn-sm" onClick={() => setDialog('enroll')}>
                <Icon name="plus" size={14} /> Enroll student
              </button>
            </Empty>
          )}
          {stats.students.length ? <Pager paging={paging} noun={`students · ${cls.code}${cls.section ? `, ${cls.section}` : ''}`} /> : null}
        </div>
      ) : (
        <div className="card">
          <Empty icon="book" title="No classes yet" body="Add a subject, then schedule it for a section and instructor. Its class appears here automatically.">
            <Link className="btn btn-primary" to="/admin/schedules">
              <Icon name="plus" size={16} /> Add schedule
            </Link>
          </Empty>
        </div>
      )}

      {dialog === 'enroll' && cls ? (
        <EnrollStudent
          classId={cls.id}
          label={`${cls.code}${cls.section ? `, ${cls.section}` : ''}`}
          onClose={() => setDialog(null)}
          onSaved={async (who) => {
            setDialog(null);
            await refresh();
            setDone({ title: 'Enrollment complete', body: `${who} has been enrolled in ${cls.code}${cls.section ? `, ${cls.section}` : ''}.` });
          }}
        />
      ) : null}
      {dialog === 'section' && cls ? (
        <ManageSection
          classId={cls.id}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await refresh();
            setDone({ title: 'Section updated', body: 'Your changes have been saved to the workspace.' });
          }}
        />
      ) : null}
      {done ? <Success title={done.title} body={done.body} onDone={() => setDone(null)} /> : null}
    </>
  );
}

function useInstructors() {
  const { w } = useWorkspace();
  return w.profiles.filter((p) => rolesOf(w, p.id).includes('instructor'));
}


function EnrollStudent({ classId, label, onClose, onSaved }: { classId: string; label: string; onClose: () => void; onSaved: (who: string) => void }) {
  const { w } = useWorkspace();
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!who.trim()) return setErr('Enter a university email or student number.');
    setBusy(true);
    setErr(null);
    try {
      onSaved(await enrollStudent(w, classId, who));
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(m.includes('duplicate') ? 'This student is already enrolled in this class.' : m);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Enroll a student in ${label}`}
      sub="Students see the class in the mobile app as soon as they sign in with this email."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Enrolling…' : 'Enroll student'}
          </button>
        </>
      }>
      <Field label="University email or student number">
        <input className="input" value={who} onChange={(e) => setWho(e.target.value)} placeholder="ethan.garcia@cvsu.edu.ph or 2026-01428" autoFocus onKeyDown={(e) => e.key === 'Enter' && void save()} />
      </Field>
      {err ? <div className="error">{err}</div> : null}
    </Modal>
  );
}

function ManageSection({ classId, onClose, onSaved }: { classId: string; onClose: () => void; onSaved: () => void }) {
  const { w } = useWorkspace();
  const instructors = useInstructors();
  const cls = w.classes.find((c) => c.id === classId)!;
  const [section, setSection] = useState(cls.section);
  const [instructor, setInstructor] = useState(cls.instructor_id);
  const [room, setRoom] = useState('');
  const [hasSchedule, setHasSchedule] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void supabase
      .from('class_schedules')
      .select('room')
      .eq('class_id', classId)
      .limit(1)
      .then(({ data }) => {
        setHasSchedule(!!data?.length);
        setRoom(data?.[0]?.room ?? '');
      });
  }, [classId]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await updateClass(classId, { section: section.trim(), instructor_id: instructor });
      if (hasSchedule) await setClassRoom(classId, room);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Manage section"
      sub={`${cls.code} · ${cls.title}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save section'}
          </button>
        </>
      }>
      <Field label="Section name">
        <input className="input" value={section} onChange={(e) => setSection(e.target.value)} placeholder="BSIT 2A" />
      </Field>
      <Field label="Room" hint={hasSchedule ? 'Applies to every meeting in this class’s schedule.' : 'Add a schedule in the mobile app first to set a room.'}>
        <input className="input" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Computer Laboratory 03" disabled={!hasSchedule} />
      </Field>
      <Field label="Instructor">
        <select className="select" value={instructor} onChange={(e) => setInstructor(e.target.value)}>
          {instructors.some((p) => p.id === cls.instructor_id) ? null : <option value={cls.instructor_id}>{nameOf(w, cls.instructor_id)}</option>}
          {instructors.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name || p.email}
            </option>
          ))}
        </select>
      </Field>
      {err ? <div className="error">{err}</div> : null}
    </Modal>
  );
}
