import { useMemo, useState } from 'react';

import { Icon } from '../components/icons';
import { Empty, ErrorNote, Loading, PageHeader } from '../components/ui';
import { fetchActivity, useData } from '../lib/data';
import { downloadCsv, fmtDateTime, startOfDay } from '../lib/format';
import { activityIcon, cap } from './Overview';

export const RANGES = {
  today: { label: 'Today', days: 0 },
  week: { label: 'Last 7 days', days: 6 },
  month: { label: 'Last 30 days', days: 29 },
  term: { label: 'Last 120 days', days: 119 },
} as const;
export type RangeKey = keyof typeof RANGES;
export const sinceOf = (r: RangeKey) => startOfDay(new Date(Date.now() - RANGES[r].days * 86400000));

const CATEGORIES: Record<string, string> = {
  assessment: 'Assessments',
  enrollment: 'Enrollment',
  class: 'Classes',
  assignment: 'Assignments',
  announcement: 'Announcements',
  schedule: 'Schedules',
  user: 'Users',
  sign_in: 'Sign-ins',
};

export default function ActivityLog() {
  const [range, setRange] = useState<RangeKey>('week');
  const [category, setCategory] = useState('all');
  const [role, setRole] = useState('all');
  const since = useMemo(() => sinceOf(range).toISOString(), [range]);
  const { data, error, loading } = useData(() => fetchActivity(since), [since]);

  const rows = (data ?? []).filter((a) => (category === 'all' || a.category === category) && (role === 'all' || a.actor_role === role));

  const exportCsv = () =>
    downloadCsv(`activity-log-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Date & time (PHT)', 'Activity', 'Details', 'Performed by', 'Role', 'Result'],
      ...rows.map((a) => [fmtDateTime(a.created_at), a.action, a.target, a.actor_name, cap(a.actor_role), a.result]),
    ]);

  return (
    <>
      <PageHeader
        title="Activity log"
        subtitle="A clear record of access, changes and publishing across the system."
        actions={
          <button className="btn btn-secondary" onClick={exportCsv} disabled={!rows.length}>
            <Icon name="download" size={16} /> Export log
          </button>
        }
      />
      <div className="filters">
        <select className="select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Activity type">
          <option value="all">All activity</option>
          {Object.entries(CATEGORIES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select className="select" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          <option value="all">All roles</option>
          <option value="admin">Admin</option>
          <option value="instructor">Instructor</option>
          <option value="student">Student</option>
        </select>
        <select className="select" value={range} onChange={(e) => setRange(e.target.value as RangeKey)} aria-label="Date range">
          {Object.entries(RANGES).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </div>

      {error ? <ErrorNote message={error} /> : null}
      <div className="card">
        {loading && !data ? (
          <Loading />
        ) : rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Activity</th>
                  <th>Performed by</th>
                  <th>Role</th>
                  <th>Date & time</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 300).map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div className="person">
                        <span className="avatar" style={{ borderRadius: 10 }}>
                          <Icon name={activityIcon(a)} size={16} />
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <b>{a.action}</b>
                          <small>{a.target || '—'}</small>
                        </div>
                      </div>
                    </td>
                    <td>{a.actor_name}</td>
                    <td>{cap(a.actor_role)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(a.created_at)}</td>
                    <td>
                      <span className={`badge ${/pending|invited|returned/i.test(a.result) ? 'gold' : 'green'}`}>{a.result}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="activity" title="No activity in this range" body="Try a longer date range or a different filter." />
        )}
        <div className="table-foot">
          <span>
            Showing {Math.min(rows.length, 300)} of {rows.length} events · All times in Philippine Standard Time (UTC+8)
          </span>
        </div>
      </div>

      <div className="note">
        <Icon name="shield" />
        <div>
          <b>Role-based access, by design.</b> Instructors manage assigned classes. Students see only their enrolled classes and own records. Admin actions are recorded here.
        </div>
      </div>
    </>
  );
}
