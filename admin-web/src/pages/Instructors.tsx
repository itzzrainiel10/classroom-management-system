import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Icon } from '../components/icons';
import { useWorkspace } from '../components/Shell';
import { Empty, PageHeader, Person, Tile } from '../components/ui';
import { rolesOf } from '../lib/data';
import { fmtNum, minutesOf } from '../lib/format';

export default function Instructors() {
  const { w } = useWorkspace();
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

  return (
    <>
      <PageHeader title="Instructors" subtitle={`Approved instructors and their teaching load · ${w.settings.current_semester}, AY ${w.settings.current_academic_year}`} />
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
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Instructor</th>
                  <th>Employee ID · Department</th>
                  <th>Contact</th>
                  <th className="num">Subjects</th>
                  <th>Sections</th>
                  <th className="num">Hours / week</th>
                  <th className="num" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.p.id}>
                    <td>
                      <Link to={`/users/${r.p.id}`} title="Open profile">
                        <Person name={r.p.full_name || r.p.email} sub={r.p.email} />
                      </Link>
                    </td>
                    <td>
                      <b style={{ whiteSpace: 'nowrap' }}>{r.ip?.employee_id || '—'}</b>
                      <div style={{ color: 'var(--text-soft)', fontSize: 12.5 }}>{r.ip?.department || '—'}</div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.ip?.contact_number || '—'}</td>
                    <td className="num">{r.subjects}</td>
                    <td style={{ maxWidth: 180 }}>{r.sections.join(', ') || '—'}</td>
                    <td className="num">{r.hours}</td>
                    <td className="num">
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 6, flexWrap: 'nowrap' }}>
                        <Link className="btn btn-primary btn-sm" to={`/schedules?instructor=${r.p.id}`}>
                          Schedule
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="school" title="No approved instructors" body="Approve applications on the Instructor applications page first." />
        )}
      </div>
    </>
  );
}
