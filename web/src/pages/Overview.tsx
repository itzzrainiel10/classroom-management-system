import { Link } from 'react-router-dom';

import { ColumnChart } from '../components/charts';
import { Icon, type IconName } from '../components/icons';
import { useWorkspace } from '../components/Shell';
import { CardHead, Empty, PageHeader, Tile } from '../components/ui';
import { useAuth } from '../lib/auth';
import { fetchActivity, useData, userRows, type Activity } from '../lib/data';
import { fmtNum, fmtTime, fmtToday, greeting, semesterRange, startOfDay } from '../lib/format';

export const activityIcon = (a: Pick<Activity, 'category'>): IconName =>
  (({ assessment: 'clipboard', enrollment: 'users', class: 'book', assignment: 'edit', announcement: 'megaphone', schedule: 'calendar', user: 'user', sign_in: 'login' }) as Record<string, IconName>)[a.category] ?? 'activity';

const LEARNING = new Set(['assessment', 'assignment', 'announcement', 'schedule', 'enrollment', 'class']);

export default function Overview() {
  const { w } = useWorkspace();
  const { name } = useAuth();
  const weekStart = startOfDay(new Date(Date.now() - 6 * 86400000));
  const { data: activity } = useData(() => fetchActivity(weekStart.toISOString()), []);

  const users = userRows(w).filter((u) => u.status !== 'Invited');
  const instructors = users.filter((u) => u.role === 'instructor').length;
  const students = users.filter((u) => u.role === 'student').length;
  const sections = new Set(w.classes.map((c) => c.section).filter(Boolean)).size;
  const today = startOfDay();
  const signedInToday = new Set((activity ?? []).filter((a) => a.category === 'sign_in' && new Date(a.created_at) >= today).map((a) => a.actor_id)).size;
  const applicants = w.instructorProfiles.filter((a) => a.status === 'pending').length;
  const pendingApps = w.instructorProfiles.filter((a) => a.status === 'pending');

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart.getTime() + i * 86400000);
    const next = new Date(d.getTime() + 86400000);
    const value = (activity ?? []).filter((a) => LEARNING.has(a.category) && new Date(a.created_at) >= d && new Date(a.created_at) < next).length;
    return { label: d.toLocaleDateString('en-US', { weekday: 'short' }), value, detail: d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) };
  });

  return (
    <>
      <PageHeader
        eyebrow="OVERVIEW"
        title={`${greeting()}, ${name ? name.split(' ')[0] : 'Admin'}!`}
        subtitle={`${fmtToday()} · ${w.settings.current_semester}, AY ${w.settings.current_academic_year} · ${semesterRange(w.settings.semester_start, w.settings.semester_end)}`}
        actions={
          <Link to="/reports" className="btn btn-secondary">
            View reports <Icon name="external" size={15} />
          </Link>
        }
      />

      <div className="grid grid-4">
        <Tile hero icon="users" label="Total users" value={fmtNum(users.length)} sub={`${fmtNum(instructors)} instructors · ${fmtNum(students)} students`} />
        <Tile icon="book" label="Active classes" value={fmtNum(w.classes.length)} sub={`Across ${sections} section${sections === 1 ? '' : 's'}`} />
        <Tile icon="shield" label="Instructor applications" value={fmtNum(applicants)} sub={applicants ? 'Waiting for verification' : 'Nothing waiting'} />
        <Tile icon="login" label="Signed in today" value={activity ? fmtNum(signedInToday) : '…'} sub="Unique accounts, mobile and web" />
      </div>

      <div className="grid grid-2">
        <div className="card">
          <CardHead title="Learning activity" sub="This week · quizzes, assignments, announcements, enrollment and schedules" />
          {activity ? <ColumnChart data={days} unit="events" /> : <div className="empty">Loading…</div>}
        </div>
        <div className="card">
          <CardHead
            title="Instructor applications"
            sub={`${pendingApps.length} waiting for verification`}
            right={
              <Link to="/verification" className="btn btn-ghost btn-sm">
                View all
              </Link>
            }
          />
          {pendingApps.length ? (
            <div className="list">
              {pendingApps.slice(0, 5).map((a) => {
                const p = w.profiles.find((x) => x.id === a.user_id);
                return (
                  <Link key={a.user_id} to="/verification" className="list-item">
                    <span className="ic gold">
                      <Icon name="shield" size={16} />
                    </span>
                    <div className="grow">
                      <b>{p?.full_name || p?.email || 'Applicant'}</b>
                      <small>
                        {a.employee_id || 'No employee ID yet'} · {a.department || 'No department yet'}
                      </small>
                    </div>
                    <Icon name="arrowRight" size={16} />
                  </Link>
                );
              })}
            </div>
          ) : (
            <Empty icon="checkCircle" title="All caught up" body="People who register as Instructor in the app appear here." />
          )}
        </div>
      </div>

      <div className="card">
        <CardHead
          title="Recent system activity"
          right={
            <Link to="/activity" className="btn btn-ghost btn-sm">
              Open activity log
            </Link>
          }
        />
        {activity && activity.length ? (
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
          <Empty icon="activity" title="No activity yet this week" body="Sign-ins, enrollments and published work will show up here." />
        )}
      </div>
    </>
  );
}

export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
