import { useState } from 'react';

import { Icon } from '../components/icons';
import { useWorkspace } from '../layouts/AdminLayout';
import { ActionIconButton, CardHead, Empty, ErrorNote, Field, Loading, Modal, PageHeader } from '../components/ui';
import { SEMESTERS, saveSettings, useData } from '../services/data';
import { fmtDateTime, fmtDay, fmtNum, semesterRange } from '../services/format';
import { endSemester, fetchSemesters, startSemester, type EndPreview, type Semester } from '../services/semesters';

const label = (s: Pick<Semester, 'semester' | 'academic_year'>) => `${s.semester}, AY ${s.academic_year}`;

/** First allowed day for the next/active semester: the day after the previous one ended (YYYY-MM-DD). */
function firstAllowedDay(list: Semester[]) {
  const ends = list
    .filter((s) => s.status === 'completed')
    .map((s) => [s.ends_on, s.ended_at ? new Date(s.ended_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) : null].filter(Boolean).sort()[0] as string | undefined)
    .filter((d): d is string => !!d)
    .sort();
  const last = ends[ends.length - 1];
  if (!last) return undefined;
  const d = new Date(`${last}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}


/** /admin/semesters — end the active semester (archive it), start the next one, see archive history. */
export default function Semesters() {
  const { refresh: refreshWorkspace } = useWorkspace();
  const { data, error, loading, refresh } = useData(fetchSemesters);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const reload = async () => {
    await Promise.all([refresh(), refreshWorkspace()]);
  };

  if (loading && !data) return <Loading />;
  const active = data?.semesters.find((s) => s.status === 'active') ?? null;
  const preview = data?.preview ?? null;
  const completed = (data?.semesters ?? []).filter((s) => s.status === 'completed');
  const archiveOf = (id: string) => data?.archives.find((a) => a.semester_id === id);
  const minStart = firstAllowedDay(data?.semesters ?? []);

  return (
    <>
      <PageHeader title="Semesters" subtitle="End the current semester to archive its records, then start the next one. Archived semesters stay readable for students and instructors." />
      {error ? <ErrorNote message={error} /> : null}
      {done ? (
        <div className="note">
          <Icon name="checkCircle" />
          <div>{done}</div>
        </div>
      ) : null}

      {active && preview ? (
        <div className="card">
          <CardHead
            title="Active semester"
            sub={`${label(active)} · ${semesterRange(active.starts_on, active.ends_on)}`}
            right={
              <div className="row">
                <span className="badge green">Active</span>
                <ActionIconButton action="edit" label="Edit active semester" onClick={() => setEditing(true)} />
              </div>
            }
          />
          <div className="sem-body">
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-danger-solid" onClick={() => setConfirming(true)}>
                <Icon name="clock" size={16} /> End {active.semester}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <StartSemester
          lastLabel={completed[0] ? label(completed[0]) : null}
          minStart={minStart}
          onStarted={async (name) => {
            await reload();
            setDone(`${name} is now the active semester. Add its schedules to create the new classes.`);
          }}
        />
      )}

      <div className="card">
        <CardHead title="Archive history" sub="Completed semesters and what was archived" />
        {completed.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Semester</th>
                  <th>Dates</th>
                  <th className="num">Classes</th>
                  <th className="num">Students</th>
                  <th>Ended</th>
                  <th>Ended by</th>
                </tr>
              </thead>
              <tbody>
                {completed.map((s) => {
                  const a = archiveOf(s.id)?.summary;
                  return (
                    <tr key={s.id}>
                      <td>
                        {label(s)} <span className="badge gray" style={{ marginLeft: 6 }}>Completed</span>
                      </td>
                      <td>{s.starts_on ? `${fmtDay(s.starts_on)} – ${fmtDay(s.ends_on)}` : '—'}</td>
                      <td className="num">{fmtNum(a?.archived_classes ?? a?.classes ?? 0)}</td>
                      <td className="num">{fmtNum(a?.students ?? 0)}</td>
                      <td>{fmtDateTime(s.ended_at)}</td>
                      <td>{s.ended_by_name || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="clock" title="No archived semesters yet" body="When you end a semester, it appears here with a summary of what was archived." />
        )}
      </div>

      {editing && active ? (
        <EditTerm
          semester={active}
          minStart={minStart}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await reload();
            setDone('Semester details updated.');
          }}
        />
      ) : null}

      {confirming && active && preview ? (
        <EndSemesterDialog
          semester={active}
          preview={preview}
          onClose={() => setConfirming(false)}
          onEnded={async (msg) => {
            setConfirming(false);
            await reload();
            setDone(msg);
          }}
        />
      ) : null}
    </>
  );
}

function EndSemesterDialog({ semester, preview, onClose, onEnded }: { semester: Semester; preview: EndPreview; onClose: () => void; onEnded: (msg: string) => Promise<void> }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = typed.trim().toUpperCase() === 'END';

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await endSemester(semester.id);
      await onEnded(`${label(semester)} has been ended. ${fmtNum(r.archived_classes)} classes and ${fmtNum(r.archived_student_records)} student records were archived.`);
    } catch (e) {
      setErr(`${e instanceof Error ? e.message : String(e)} The semester is still active.`);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`End ${label(semester)}?`}
      sub="Everything is archived in one step. If anything fails, nothing changes."
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-danger-solid" onClick={() => void run()} disabled={!ok || busy}>
            {busy ? 'Archiving…' : 'End semester'}
          </button>
        </>
      }>
      <ul className="sem-list">
        <li>
          <b>{fmtNum(preview.classes)}</b> classes, <b>{fmtNum(preview.students)}</b> students and <b>{fmtNum(preview.grades)}</b> grades will be archived.
        </li>
        <li>The semester changes from Active to Completed, and its classes become read-only.</li>
        <li>
          <b>Its schedules are removed</b>, and every student’s section is cleared. Students renew by choosing their section again for the next semester (they are notified).
        </li>
        <li>Subjects, sections, rooms and all accounts stay.</li>
        <li>Students and instructors keep their records under My Semesters / Previous Semesters.</li>
        <li>After this, start the next semester and add its schedules.</li>
      </ul>
      <Field label="Type END to confirm" required>
        <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="END" autoFocus />
      </Field>
      {err ? <ErrorNote message={err} /> : null}
    </Modal>
  );
}

function StartSemester({ lastLabel, minStart, onStarted }: { lastLabel: string | null; minStart?: string; onStarted: (name: string) => Promise<void> }) {
  const [semester, setSemester] = useState<string>(SEMESTERS[0]);
  const [year, setYear] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!/^\d{4}-\d{4}$/.test(year.trim())) return setErr('Academic year must look like 2026-2027.');
    if (!start || !end) return setErr('Set the first and last day of the semester.');
    if (end <= start) return setErr('The semester must end after it starts.');
    if (minStart && start < minStart) return setErr(`The semester must start on ${fmtDay(minStart)} or later (after the previous one ended).`);
    setBusy(true);
    setErr(null);
    try {
      await startSemester({ semester, academic_year: year.trim(), starts_on: start, ends_on: end });
      await onStarted(`${semester}, AY ${year.trim()}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <CardHead title="Start a new semester" sub={lastLabel ? `${lastLabel} has ended. No semester is active right now.` : 'No semester is active right now.'} />
      <div className="sem-body">
        <div className="form-grid">
          <Field label="Semester" required>
            <select className="select" value={semester} onChange={(e) => setSemester(e.target.value)}>
              {SEMESTERS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Academic year" required hint="For example 2026-2027">
            <input className="input" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2026-2027" />
          </Field>
          <Field label="First day" required hint={minStart ? `${fmtDay(minStart)} or later` : undefined}>
            <input className="input" type="date" value={start} min={minStart} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Last day" required>
            <input className="input" type="date" value={end} min={start || minStart} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <p className="sem-lead">The new semester starts empty. Old grades, attendance and submissions stay in the archive and are never copied over.</p>
        {err ? <ErrorNote message={err} /> : null}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            <Icon name="plus" size={16} /> {busy ? 'Starting…' : 'Start semester'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Fix the active semester's name or dates (what Settings used to do). */
function EditTerm({ semester, minStart, onClose, onSaved }: { semester: Semester; minStart?: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(semester.semester);
  const [year, setYear] = useState(semester.academic_year);
  const [start, setStart] = useState(semester.starts_on ?? '');
  const [end, setEnd] = useState(semester.ends_on ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!/^d{4}-d{4}$/.test(year.trim())) return setErr('Academic year must look like 2026-2027.');
    if (!start || !end) return setErr('Set the first and last day of the semester.');
    if (end <= start) return setErr('The semester must end after it starts.');
    setBusy(true);
    setErr(null);
    try {
      await saveSettings({ current_semester: name, current_academic_year: year.trim(), semester_start: start, semester_end: end });
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Edit active semester"
      sub="Schedules repeat every week between the first and last day."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }>
      <div className="form-grid">
        <Field label="Semester" required>
          <select className="select" value={name} onChange={(e) => setName(e.target.value)}>
            {SEMESTERS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <Field label="Academic year" required>
          <input className="input" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2026-2027" />
        </Field>
        <Field label="First day" required hint={minStart ? `${fmtDay(minStart)} or later` : undefined}>
          <input className="input" type="date" value={start} min={minStart} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Last day" required>
          <input className="input" type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      {err ? <ErrorNote message={err} /> : null}
    </Modal>
  );
}
