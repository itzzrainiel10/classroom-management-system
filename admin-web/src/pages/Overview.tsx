import { Link } from 'react-router-dom';

import { ColumnChart } from '../components/charts';
import { Icon, type IconName } from '../components/icons';
import { CardHead, Empty, Loading, PageHeader, Tile } from '../components/ui';
import { useWorkspace } from '../layouts/AdminLayout';
import { fetchActivity, nameOf, useData, userRows, type Activity } from '../services/data';
import { fmtClock, fmtNum, fmtTime, fmtToday, semesterRange, startOfDay } from '../services/format';

export const activityIcon = (a: Pick<Activity, 'category'>): IconName =>
  (({ assessment: 'clipboard', enrollment: 'users', class: 'book', assignment: 'edit', announcement: 'megaphone', schedule: 'calendar', user: 'user', sign_in: 'login', verification: 'shield', attendance: 'checkCircle' }) as Record<string, IconName>)[a.category] ?? 'activity';

const LEARNING = new Set(['assessment', 'assignment', 'announcement', 'schedule', 'enrollment', 'class']);

const QUICK: { to: string; label: string; icon: IconName }[] = [
  { to: '/admin/instructor-verification', label: 'Review applications', icon: 'shield' },
  { to: '/admin/schedules', label: 'Add a schedule', icon: 'calendar' },
  { to: '/admin/subjects', label: 'Manage subjects', icon: 'book' },
  { to: '/admin/sections', label: 'Manage sections', icon: 'users' },
  { to: '/admin/users', label: 'Invite a user', icon: 'user' },
  { to: '/admin/reports', label: 'Download reports', icon: 'download' },
];

export default function Overview() {
  const { w } = useWorkspace();
  const weekStart = startOfDay(new Date(Date.now() - 6 * 86400000));
  const { data: activity } = useData(() => fetchActivity(weekStart.toISOString()), []);

  const users = userRows(w).filter((u) => u.status !== 'Invited');
  const students = users.filter((u) => u.role === 'student').length;
  const instructorsTotal = w.instructorProfiles.length;
  const approved = w.instructorProfiles.filter((a) => a.status === 'approved').length;
  const pendingApps = w.instructorProfiles.filter((a) => a.status === 'pending').sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  const today = startOfDay();
  const signedInToday = new Set((activity ?? []).filter((a) => a.category === 'sign_in' && new Date(a.created_at) >= today).map((a) => a.actor_id)).size;

  // Today's official classes (current term).
  const dow = new Date().getDay() === 0 ? 7 : new Date().getDay();
  const todays = w.schedules
    .filter((s) => s.semester === w.settings.current_semester && s.academic_year === w.settings.current_academic_year && s.day_of_week === dow)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const nowTime = new Date().toTimeString().slice(0, 8);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart.getTime() + i * 86400000);
    const next = new Date(d.getTime() + 86400000);
    const value = (activity ?? []).filter((a) => LEARNING.has(a.category) && new Date(a.created_at) >= d && new Date(a.created_at) < next).length;
    return { label: d.toLocaleDateString('en-US', { weekday: 'short' }), value, detail: d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) };
  });

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`${fmtToday()} · ${w.settings.current_semester}, AY ${w.settings.current_academic_year} · ${semesterRange(w.settings.semester_start, w.settings.semester_end)}`}
        actions={
          <Link to="/admin/schedules" className="btn btn-primary">
            <Icon name="plus" size={16} /> Add schedule
          </Link>
        }
      />

      {pendingApps.length ? (
        <div className="note gold" style={{ alignItems: 'center' }}>
          <Icon name="shield" />
          <div style={{ flex: 1 }}>
            <b>
              {pendingApps.length} instructor application{pendingApps.length === 1 ? ' is' : 's are'} waiting for your review.
            </b>{' '}
            They can’t teach until you approve them.
          </div>
          <Link to="/admin/instructor-verification" className="btn btn-primary btn-sm">
            Review now
          </Link>
        </div>
      ) : null}

      <div className="grid grid-6">
        <Tile icon="user" label="Total students" value={fmtNum(students)} sub={`${fmtNum(signedInToday)} signed in today`} to="/admin/students" />
        <Tile icon="school" label="Total instructors" value={fmtNum(instructorsTotal)} sub="All applications" to="/admin/instructors" />
        <Tile icon="checkCircle" tone="ok" label="Approved instructors" value={fmtNum(approved)} sub="Can teach" to="/admin/instructors" />
        <Tile icon="shield" tone="warn" label="Pending applications" value={fmtNum(pendingApps.length)} sub={pendingApps.length ? 'Needs review' : 'All caught up'} to="/admin/instructor-verification" />
        <Tile icon="book" tone="neutral" label="Total subjects" value={fmtNum(w.subjects.length)} sub="In the catalog" to="/admin/subjects" />
        <Tile icon="users" tone="neutral" label="Total sections" value={fmtNum(w.sections.length)} sub="All year levels" to="/admin/sections" />
      </div>

      <div className="card">
        <CardHead title="Quick actions" />
        <div className="quick">
          {QUICK.map((q) => (
            <Link key={q.to + q.label} to={q.to}>
              <Icon name={q.icon} size={17} />
              {q.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <CardHead
            title="Today’s classes"
            sub={`${fmtToday()} · ${todays.length} scheduled`}
            right={
              <Link to="/admin/schedules" className="btn btn-ghost btn-sm">
                Open schedules
              </Link>
            }
          />
          {todays.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Subject</th>
                    <th>Section</th>
                    <th>Instructor</th>
                    <th>Room</th>
                  </tr>
                </thead>
                <tbody>
                  {todays.slice(0, 8).map((s) => {
                    const sub = w.subjects.find((x) => x.id === s.subject_id);
                    const sec = w.sections.find((x) => x.id === s.section_id);
                    const room = w.rooms.find((x) => x.id === s.room_id);
                    const live = s.start_time <= nowTime && nowTime < s.end_time;
                    return (
                      <tr key={s.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {fmtClock(s.start_time)}–{fmtClock(s.end_time)} {live ? <span className="badge green">Now</span> : null}
                        </td>
                        <td>
                          <b>{sub?.code ?? '—'}</b> {sub?.name}
                        </td>
                        <td>{sec?.name ?? '—'}</td>
                        <td>{nameOf(w, s.instructor_id)}</td>
                        <td>{room?.name ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="calendar" title="No classes today" body="Classes scheduled for today will appear here." />
          )}
        </div>

        <div className="card">
          <CardHead
            title="Pending approvals"
            sub={`${pendingApps.length} waiting`}
            right={
              <Link to="/admin/instructor-verification" className="btn btn-ghost btn-sm">
                View all
              </Link>
            }
          />
          {pendingApps.length ? (
            <div className="list">
              {pendingApps.slice(0, 5).map((a) => {
                const p = w.profiles.find((x) => x.id === a.user_id);
                return (
                  <Link key={a.user_id} to="/admin/instructor-verification" className="list-item">
                    <span className="ic gold">
                      <Icon name="shield" size={16} />
                    </span>
                    <div className="grow">
                      <b>{p?.full_name || p?.email || 'Applicant'}</b>
                      <small>
                        {a.employee_id || 'No employee ID yet'} · {a.department || 'No department yet'}
                      </small>
                    </div>
                    <span className="badge gold">Pending</span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <Empty icon="checkCircle" title="All caught up" body="New instructor registrations appear here." />
          )}
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <CardHead title="Learning activity" sub="Last 7 days · quizzes, assignments, announcements, enrollment and schedules" />
          {activity ? <ColumnChart data={days} unit="events" /> : <div className="card-pad"><Loading rows={2} /></div>}
        </div>
        <div className="card">
          <CardHead
            title="Recent activity"
            right={
              <Link to="/admin/activity" className="btn btn-ghost btn-sm">
                Activity log
              </Link>
            }
          />
          {!activity ? (
            <div className="card-pad">
              <Loading rows={3} />
            </div>
          ) : activity.length ? (
            <div className="list">
              {activity.slice(0, 6).map((a) => (
                <div key={a.id} className="list-item">
                  <span className="ic">
                    <Icon name={activityIcon(a)} size={16} />
                  </span>
                  <div className="grow">
                    <b>
                      {a.action}
                      {a.target ? ` · ${a.target}` : ''}
                    </b>
                    <small>
                      {a.actor_name} · {cap(a.actor_role)}
                    </small>
                  </div>
                  <time>{new Date(a.created_at) >= today ? fmtTime(a.created_at) : new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</time>
                </div>
              ))}
            </div>
          ) : (
            <Empty icon="activity" title="No activity this week" body="Sign-ins, enrollments and published work will show up here." />
          )}
        </div>
      </div>
    </>
  );
}

export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
