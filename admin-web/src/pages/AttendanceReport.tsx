import { PercentBars } from '../components/charts';
import { Icon } from '../components/icons';
import { toast } from '../components/toast';
import { CardHead, Empty, Loading, Tile } from '../components/ui';
import { useWorkspace } from '../layouts/AdminLayout';
import { classLabel, nameOf, useData, type ClassRow } from '../services/data';
import { downloadCsv, fmtNum } from '../services/format';
import { supabase } from '../services/supabase';

type Session = { id: string; class_id: string; session_date: string };
type Rec = { session_id: string; class_id: string; student_email: string; student_name: string; status: 'present' | 'absent' };

/** All attendance (administrators can read every class; instructors only take it). */
async function fetchAttendance() {
  const [s, r] = await Promise.all([
    supabase.from('attendance_sessions').select('id, class_id, session_date'),
    supabase.from('attendance_records').select('session_id, class_id, student_email, student_name, status'),
  ]);
  if (s.error) throw new Error(s.error.message);
  if (r.error) throw new Error(r.error.message);
  return { sessions: s.data as Session[], records: r.data as Rec[] };
}

const rate = (p: number, t: number) => (t ? Math.round((p / t) * 1000) / 10 : null);
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Attendance section of the Reports page, filtered by the page's class and date range. */
export function AttendanceReport({ classes, since }: { classes: ClassRow[]; since: Date }) {
  const { w } = useWorkspace();
  const { data, error } = useData(fetchAttendance);
  const from = isoDay(since);
  const ids = new Set(classes.map((c) => c.id));
  const sessions = (data?.sessions ?? []).filter((s) => ids.has(s.class_id) && s.session_date >= from);
  const sessionIds = new Set(sessions.map((s) => s.id));
  const recs = (data?.records ?? []).filter((r) => sessionIds.has(r.session_id));
  const present = recs.filter((r) => r.status === 'present').length;

  const perClass = classes
    .map((c) => {
      const cr = recs.filter((r) => r.class_id === c.id);
      const p = cr.filter((r) => r.status === 'present').length;
      return { c, meetings: sessions.filter((s) => s.class_id === c.id).length, present: p, absent: cr.length - p, rate: rate(p, cr.length) };
    })
    .filter((x) => x.meetings)
    .sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101));

  // Students under 80% in at least one class.
  const byStudentClass = new Map<string, { name: string; email: string; c: ClassRow; p: number; t: number }>();
  for (const r of recs) {
    const key = `${r.student_email}|${r.class_id}`;
    const c = classes.find((x) => x.id === r.class_id)!;
    const cur = byStudentClass.get(key) ?? { name: r.student_name || r.student_email, email: r.student_email, c, p: 0, t: 0 };
    cur.t++;
    if (r.status === 'present') cur.p++;
    byStudentClass.set(key, cur);
  }
  const atRisk = [...byStudentClass.values()].filter((x) => x.t >= 2 && x.p / x.t < 0.8).sort((a, b) => a.p / a.t - b.p / b.t);

  const sections = [...new Set(perClass.map((x) => x.c.section))].sort();
  const sectionRows = sections.map((sec) => {
    const rows = perClass.filter((x) => x.c.section === sec);
    const p = rows.reduce((n, x) => n + x.present, 0);
    const t = rows.reduce((n, x) => n + x.present + x.absent, 0);
    return { label: sec || '—', value: rate(p, t), title: `${p} of ${t} present` };
  });

  const exportCsv = () => {
    downloadCsv(`attendance-report-${from}.csv`, [
      ['Class', 'Title', 'Section', 'Instructor', 'Student', 'Email', 'Present', 'Absent', 'Rate'],
      ...[...byStudentClass.values()]
        .sort((a, b) => classLabel(a.c).localeCompare(classLabel(b.c)) || a.name.localeCompare(b.name))
        .map((x) => [classLabel(x.c), x.c.title, x.c.section, nameOf(w, x.c.instructor_id), x.name, x.email, x.p, x.t - x.p, `${rate(x.p, x.t)}%`]),
    ]);
    toast.success('Attendance report downloaded', 'Open the CSV file in Excel or Google Sheets.');
  };

  return (
    <>
      <div className="page-head" style={{ marginTop: 8 }}>
        <div>
          <h1 style={{ fontSize: 19 }}>Attendance</h1>
          <p>Taken by instructors on the website or in the mobile app (Present / Absent).</p>
        </div>
        <div className="head-actions">
          <button className="btn btn-secondary" onClick={exportCsv} disabled={!recs.length}>
            <Icon name="download" size={16} /> Export attendance
          </button>
        </div>
      </div>
      {error ? <div className="note red">{error}</div> : null}
      {!data ? (
        <Loading rows={2} />
      ) : (
        <>
          <div className="grid grid-4">
            <Tile icon="checkCircle" tone="ok" label="Attendance rate" value={rate(present, recs.length) == null ? '—' : `${rate(present, recs.length)}%`} sub={`${fmtNum(present)} of ${fmtNum(recs.length)} marks present`} />
            <Tile icon="calendar" label="Meetings recorded" value={fmtNum(sessions.length)} sub="In this period" />
            <Tile icon="book" tone="neutral" label="Classes taking attendance" value={fmtNum(perClass.length)} sub={`of ${fmtNum(classes.length)} classes`} />
            <Tile icon="alert" tone="warn" label="Students below 80%" value={fmtNum(atRisk.length)} sub="At least 2 meetings" />
          </div>
          <div className="grid grid-2">
            <div className="card">
              <CardHead title="Attendance by class" sub="Lowest rate first" />
              {perClass.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Class / section</th>
                        <th>Instructor</th>
                        <th className="num">Meetings</th>
                        <th className="num">Present</th>
                        <th className="num">Absent</th>
                        <th className="num">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perClass.map((x) => (
                        <tr key={x.c.id}>
                          <td>
                            <b>{classLabel(x.c)}</b>
                            <div style={{ color: 'var(--text-soft)', fontSize: 12.5 }}>{x.c.title}</div>
                          </td>
                          <td>{nameOf(w, x.c.instructor_id)}</td>
                          <td className="num">{x.meetings}</td>
                          <td className="num">{x.present}</td>
                          <td className="num">{x.absent}</td>
                          <td className="num">
                            <span className={`badge ${(x.rate ?? 0) >= 90 ? 'green' : (x.rate ?? 0) >= 80 ? 'gold' : 'red'}`}>{x.rate}%</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty icon="calendar" title="No attendance in this period" body="Instructors take attendance on the Instructor website or in the mobile app." />
              )}
            </div>
            <div className="card">
              <CardHead title="Attendance by section" sub="% of marks that are Present" />
              {sectionRows.length ? <PercentBars rows={sectionRows} /> : <Empty icon="chart" title="No attendance yet" />}
              {atRisk.length ? (
                <>
                  <div className="list-group">
                    Students below 80% <span>({atRisk.length})</span>
                  </div>
                  <div className="list">
                    {atRisk.slice(0, 6).map((x) => (
                      <div key={`${x.email}|${x.c.id}`} className="list-item">
                        <span className="ic red">
                          <Icon name="alert" size={16} />
                        </span>
                        <div className="grow">
                          <b>{x.name}</b>
                          <small>
                            {classLabel(x.c)} · {x.p}/{x.t} present
                          </small>
                        </div>
                        <span className="badge red">{rate(x.p, x.t)}%</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </>
      )}
    </>
  );
}
