import { useMemo, useState } from 'react';

import { PercentBars } from '../components/charts';
import { Icon } from '../components/icons';
import { useWorkspace } from '../components/Shell';
import { CardHead, Empty, PageHeader, Success, Tile } from '../components/ui';
import { classLabel, classStats, fetchActivity, nameOf, useData } from '../lib/data';
import { downloadCsv, fmtNum, fmtPct, pct, semesterLabel } from '../lib/format';
import { RANGES, sinceOf, type RangeKey } from './Activity';

export default function Reports() {
  const { w } = useWorkspace();
  const [range, setRange] = useState<RangeKey>('month');
  const [classId, setClassId] = useState('all');
  const [done, setDone] = useState(false);
  const since = useMemo(() => sinceOf(range), [range]);
  const { data: activity } = useData(() => fetchActivity(since.toISOString()), [since]);

  const classes = w.classes.filter((c) => classId === 'all' || c.id === classId);
  const ids = new Set(classes.map((c) => c.id));
  const quizIds = new Set(w.quizzes.filter((q) => ids.has(q.class_id) && q.status === 'published').map((q) => q.id));
  const attempts = w.attempts.filter((a) => quizIds.has(a.quiz_id) && new Date(a.submitted_at) >= since);
  const avgScore = attempts.length ? attempts.reduce((s, a) => s + pct(a.score, a.total), 0) / attempts.length : null;
  const perClass = classes.map((c) => ({ c, s: classStats(w, c.id) }));
  const expected = perClass.reduce((n, x) => n + x.s.students.length * x.s.quizzes.length, 0);
  const done_ = perClass.reduce((n, x) => n + x.s.attempts.length, 0);
  const completion = expected ? (done_ / expected) * 100 : null;
  const assignments = w.assignments.filter((a) => ids.has(a.class_id) && new Date(a.created_at) >= since).length;
  const activeStudents = new Set(
    (activity ?? []).filter((a) => a.actor_role === 'student' && (a.category === 'sign_in' || a.category === 'assessment')).map((a) => a.actor_id),
  ).size;

  const bySection = new Map<string, { sum: number; n: number }>();
  for (const { c, s } of perClass) {
    const key = c.section || c.code;
    const cur = bySection.get(key) ?? { sum: 0, n: 0 };
    for (const a of s.attempts) {
      cur.sum += pct(a.score, a.total);
      cur.n += 1;
    }
    bySection.set(key, cur);
  }
  const sectionRows = [...bySection.entries()]
    .map(([label, v]) => ({ label, value: v.n ? v.sum / v.n : null, title: `${v.n} quiz submission${v.n === 1 ? '' : 's'}` }))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));

  const generate = () => {
    downloadCsv(`class-report-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Report', `${semesterLabel()} · ${RANGES[range].label}`],
      [],
      ['Class / section', 'Title', 'Instructor', 'Students', 'Published quizzes / exams', 'Avg. score (%)', 'Completion (%)'],
      ...perClass.map(({ c, s }) => [
        classLabel(c),
        c.title,
        nameOf(w, c.instructor_id),
        s.students.length,
        s.quizzes.length,
        s.avgScore == null ? '' : Math.round(s.avgScore * 10) / 10,
        s.completion == null ? '' : Math.round(s.completion * 10) / 10,
      ]),
    ]);
    setDone(true);
  };

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Understand participation, performance and classroom activity."
        actions={
          <button className="btn btn-primary" onClick={generate} disabled={!perClass.length}>
            <Icon name="download" size={16} /> Generate report
          </button>
        }
      />
      <div className="filters">
        <select className="select" disabled aria-label="Term">
          <option>{semesterLabel()}</option>
        </select>
        <select className="select" value={classId} onChange={(e) => setClassId(e.target.value)} aria-label="Class">
          <option value="all">All classes</option>
          {w.classes.map((c) => (
            <option key={c.id} value={c.id}>
              {classLabel(c)}
            </option>
          ))}
        </select>
        <select className="select" value={range} onChange={(e) => setRange(e.target.value as RangeKey)} aria-label="Date range">
          {Object.entries(RANGES)
            .filter(([k]) => k !== 'today')
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
        </select>
      </div>

      <div className="grid grid-4">
        <Tile hero icon="chart" label="Average assessment score" value={fmtPct(avgScore)} sub={`${fmtNum(attempts.length)} quiz submissions`} />
        <Tile icon="checkCircle" label="Quiz completion" value={fmtPct(completion)} sub="Submitted ÷ (students × published quizzes)" />
        <Tile icon="edit" label="Assignments posted" value={fmtNum(assignments)} sub={RANGES[range].label} />
        <Tile icon="users" label="Active students" value={activity ? fmtNum(activeStudents) : '…'} sub="Signed in or answered a quiz" />
      </div>

      <div className="grid grid-2">
        <div className="card">
          <CardHead title="Class performance summary" sub="Published quizzes and exams" />
          {perClass.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Class / section</th>
                    <th>Instructor</th>
                    <th className="num">Students</th>
                    <th className="num">Avg. score</th>
                    <th className="num">Completion</th>
                  </tr>
                </thead>
                <tbody>
                  {perClass.map(({ c, s }) => (
                    <tr key={c.id}>
                      <td>
                        <b>{classLabel(c)}</b>
                        <div style={{ color: 'var(--text-soft)', fontSize: 12.5 }}>{c.title}</div>
                      </td>
                      <td>{nameOf(w, c.instructor_id)}</td>
                      <td className="num">{s.students.length}</td>
                      <td className="num">{fmtPct(s.avgScore)}</td>
                      <td className="num">{fmtPct(s.completion)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="book" title="No classes yet" />
          )}
        </div>
        <div className="card">
          <CardHead title="Average score by section" sub="% across all quiz submissions" />
          {sectionRows.length ? <PercentBars rows={sectionRows} /> : <Empty icon="chart" title="No scores yet" body="Scores appear once students answer approved quizzes." />}
        </div>
      </div>
      {done ? <Success title="Report prepared" body="Your class report has been downloaded as a CSV file you can open in Excel or Google Sheets." onDone={() => setDone(false)} /> : null}
    </>
  );
}
