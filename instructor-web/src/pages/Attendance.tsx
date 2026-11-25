import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Icon } from '../components/icons';
import { toast } from '../components/toast';
import { CardHead, Confirm, Empty, ErrorNote, Field, Loading, PageHeader, Tile } from '../components/ui';
import { useData } from '../hooks/useData';
import { deleteAttendanceSession, fetchClassAttendance, fmtSessionDate, saveAttendance, todayIso, type AttendanceStatus } from '../services/attendance';
import { downloadCsv, fmtNum } from '../services/format';
import { fetchMyClasses, fetchRoster } from '../services/teaching';

const rate = (present: number, total: number) => (total ? Math.round((present / total) * 100) : null);

/** Take attendance (Present / Absent) for one class and date, and review the class's attendance history. */
export default function Attendance() {
  const classes = useData(fetchMyClasses);
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [del, setDel] = useState<{ id: string; date: string } | null>(null);

  useEffect(() => {
    if (classes.data?.length && !classId) setClassId(classes.data[0].id);
  }, [classes.data, classId]);

  const roster = useData(() => (classId ? fetchRoster(classId) : Promise.resolve([])), [classId]);
  const history = useData(() => (classId ? fetchClassAttendance(classId) : Promise.resolve({ sessions: [], records: [] })), [classId]);

  // Load what was already saved for this date (or start with everyone present).
  const session = history.data?.sessions.find((s) => s.session_date === date);
  useEffect(() => {
    if (!roster.data || !history.data) return;
    const saved = session ? history.data.records.filter((r) => r.session_id === session.id) : [];
    const next: Record<string, AttendanceStatus> = {};
    for (const s of roster.data) next[s.email.toLowerCase()] = saved.find((r) => r.student_email === s.email.toLowerCase())?.status ?? 'present';
    setMarks(next);
    setErr(null);
  }, [roster.data, history.data, session]);

  const present = Object.values(marks).filter((m) => m === 'present').length;
  const total = Object.keys(marks).length;
  const cls = classes.data?.find((c) => c.id === classId);
  const label = cls ? `${cls.code} · ${cls.title} (${cls.section})` : '';

  const perStudent = useMemo(() => {
    const recs = history.data?.records ?? [];
    return (roster.data ?? []).map((s) => {
      const mine = recs.filter((r) => r.student_email === s.email.toLowerCase());
      const p = mine.filter((r) => r.status === 'present').length;
      return { name: s.full_name || s.email, email: s.email, present: p, absent: mine.length - p, total: mine.length };
    });
  }, [roster.data, history.data]);
  const allRecs = history.data?.records ?? [];
  const overall = rate(allRecs.filter((r) => r.status === 'present').length, allRecs.length);

  const save = async () => {
    if (!classId) return setErr('Choose a class.');
    if (!total) return setErr('This class has no students yet.');
    if (date > todayIso()) return setErr('Choose today or an earlier date.');
    setBusy(true);
    setErr(null);
    try {
      await saveAttendance(classId, date, Object.entries(marks).map(([email, status]) => ({ email, status })));
      toast.success(session ? 'Attendance updated' : 'Attendance saved', `${label} · ${fmtSessionDate(date)} · ${present}/${total} present`);
      await history.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    const sessions = [...(history.data?.sessions ?? [])].sort((a, b) => a.session_date.localeCompare(b.session_date));
    downloadCsv(`attendance-${cls?.code ?? 'class'}-${cls?.section ?? ''}.csv`.replace(/\s+/g, '-'), [
      ['Student', 'Email', ...sessions.map((s) => s.session_date), 'Present', 'Absent', 'Rate'],
      ...perStudent.map((p) => [
        p.name,
        p.email,
        ...sessions.map((s) => allRecs.find((r) => r.session_id === s.id && r.student_email === p.email.toLowerCase())?.status ?? ''),
        p.present,
        p.absent,
        rate(p.present, p.total) == null ? '' : `${rate(p.present, p.total)}%`,
      ]),
    ]);
  };

  if (classes.error) return <ErrorNote message={classes.error} />;
  if (!classes.data) return <Loading />;
  if (!classes.data.length)
    return (
      <>
        <PageHeader title="Attendance" subtitle="Mark each student Present or Absent for a class meeting." />
        <div className="card">
          <Empty icon="users" title="No classes yet" body="Create a class and add your students first.">
            <Link to="/classes" className="btn btn-primary">Go to My Classes &amp; Students</Link>
          </Empty>
        </div>
      </>
    );

  return (
    <>
      <PageHeader
        title="Attendance"
        subtitle="Mark each student Present or Absent. Students see their own attendance in the mobile app."
        actions={
          <button className="btn btn-secondary" onClick={exportCsv} disabled={!history.data?.sessions.length}>
            <Icon name="download" size={16} /> Export CSV
          </button>
        }
      />

      <div className="card card-pad">
        <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
          <Field label="Class" required>
            <select className="select" value={classId} onChange={(e) => setClassId(e.target.value)}>
              {classes.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.title} ({c.section})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date" required>
            <input className="input" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="grid grid-4">
        <Tile icon="calendar" label="Meetings recorded" value={fmtNum(history.data?.sessions.length ?? 0)} sub="For this class" />
        <Tile icon="checkCircle" tone="ok" label="Attendance rate" value={overall == null ? '—' : `${overall}%`} sub="All meetings" />
        <Tile icon="users" tone="neutral" label="Students" value={fmtNum(roster.data?.length ?? 0)} sub="Enrolled" />
        <Tile icon="check" tone="warn" label="Present on this date" value={total ? `${present}/${total}` : '—'} sub={session ? 'Saved — you can still edit' : 'Not saved yet'} />
      </div>

      <div className="card">
        <CardHead
          title={`${fmtSessionDate(date)}`}
          sub={session ? 'Attendance already saved for this date. Changes update it.' : 'New attendance. Everyone starts as Present.'}
          right={
            total ? (
              <div className="row">
                <button className="btn btn-ghost btn-sm" onClick={() => setMarks(Object.fromEntries(Object.keys(marks).map((k) => [k, 'present'])))}>
                  All present
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setMarks(Object.fromEntries(Object.keys(marks).map((k) => [k, 'absent'])))}>
                  All absent
                </button>
              </div>
            ) : null
          }
        />
        {!roster.data || !history.data ? (
          <div className="card-pad">
            <Loading />
          </div>
        ) : roster.data.length ? (
          <>
            <div className="list">
              {roster.data.map((s) => {
                const key = s.email.toLowerCase();
                const m = marks[key] ?? 'present';
                return (
                  <div key={s.id} className="list-item">
                    <span className={`ic${m === 'absent' ? ' red' : ''}`}>
                      <Icon name={m === 'present' ? 'check' : 'x'} size={16} />
                    </span>
                    <div className="grow">
                      <b>{s.full_name || s.email}</b>
                      <small>{s.email}</small>
                    </div>
                    <div className="attend-toggle" role="radiogroup" aria-label={`Attendance for ${s.full_name || s.email}`}>
                      {(['present', 'absent'] as const).map((st) => (
                        <button key={st} role="radio" aria-checked={m === st} className={m === st ? `on ${st}` : ''} onClick={() => setMarks({ ...marks, [key]: st })}>
                          {st === 'present' ? 'Present' : 'Absent'}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="table-foot">
              <span>
                <b style={{ color: 'var(--text)' }}>{present}</b> present · <b style={{ color: 'var(--text)' }}>{total - present}</b> absent
              </span>
              <div className="row">
                {err ? <span className="error">{err}</span> : null}
                <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
                  {busy ? 'Saving…' : session ? 'Update attendance' : 'Save attendance'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <Empty icon="users" title="No students enrolled" body="Add students to this class first.">
            <Link to={`/classes?class=${classId}`} className="btn btn-primary">Add students</Link>
          </Empty>
        )}
      </div>

      <div className="grid grid-2-even">
        <div className="card">
          <CardHead title="Meetings" sub="Click a date to open it" />
          {history.data?.sessions.length ? (
            <div className="list">
              {history.data.sessions.map((s) => {
                const recs = history.data!.records.filter((r) => r.session_id === s.id);
                const p = recs.filter((r) => r.status === 'present').length;
                return (
                  <div key={s.id} className="list-item" style={{ cursor: 'pointer', background: s.session_date === date ? 'var(--primary-tint)' : undefined }} onClick={() => setDate(s.session_date)}>
                    <span className="ic">
                      <Icon name="calendar" size={16} />
                    </span>
                    <div className="grow">
                      <b>{fmtSessionDate(s.session_date)}</b>
                      <small>
                        {p}/{recs.length} present · {rate(p, recs.length)}%
                      </small>
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDel({ id: s.id, date: s.session_date });
                      }}
                      aria-label={`Delete attendance for ${s.session_date}`}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty icon="calendar" title="No attendance yet" body="Saved meetings appear here." />
          )}
        </div>
        <div className="card">
          <CardHead title="By student" sub="All meetings of this class" />
          {perStudent.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th className="num">Present</th>
                    <th className="num">Absent</th>
                    <th className="num">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {perStudent.map((p) => {
                    const r = rate(p.present, p.total);
                    return (
                      <tr key={p.email}>
                        <td>
                          <b>{p.name}</b>
                        </td>
                        <td className="num">{p.present}</td>
                        <td className="num">{p.absent}</td>
                        <td className="num">{r == null ? '—' : <span className={`badge ${r >= 80 ? 'green' : r >= 60 ? 'gold' : 'red'}`}>{r}%</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="users" title="No students" />
          )}
        </div>
      </div>

      {del ? (
        <Confirm
          title={`Delete attendance for ${fmtSessionDate(del.date)}?`}
          body="The marks for this meeting will be removed. Students will no longer see it."
          confirmLabel="Delete"
          danger
          onClose={() => setDel(null)}
          onConfirm={async () => {
            await deleteAttendanceSession(del.id);
            setDel(null);
            toast.success('Attendance deleted', fmtSessionDate(del.date));
            await history.refresh();
          }}
        />
      ) : null}
    </>
  );
}
