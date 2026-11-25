import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { Icon } from '../components/icons';
import { useInstructor } from '../layouts/InstructorLayout';
import { Avatar, CardHead, Empty, ErrorNote, Field, PageHeader, Tile } from '../components/ui';
import { useAuth } from '../services/auth';
import { DAYS } from '../services/common';
import { fmtClock, fmtDate, fmtDateTime, fmtNum, fmtToday, greeting, minutesOf, semesterRange } from '../services/format';
import { changeMyPassword, hours, markNotificationsRead, updateMyName, type MyClass } from '../services/instructor';

/** Same subject → same calm colour (week-slot c0–c5) in every timetable. */
const tint = (code: string) => `c${[...code].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 6}`;


const termLine = (t: { current_semester: string; current_academic_year: string; semester_start: string | null; semester_end: string | null } | null) =>
  t ? `${t.current_semester}, AY ${t.current_academic_year} · ${semesterRange(t.semester_start, t.semester_end)}` : '';
const isoDay = (d = new Date()) => (d.getDay() === 0 ? 7 : d.getDay());
const sortClasses = (l: MyClass[]) => [...l].sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time));
const timeRange = (c: MyClass) => `${fmtClock(c.start_time)}–${fmtClock(c.end_time)}`;

function ScheduleTable({ rows, showDay = true }: { rows: MyClass[]; showDay?: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {showDay ? <th>Day</th> : null}
            <th>Time</th>
            <th>Subject</th>
            <th>Section</th>
            <th>Room</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => (
            <tr key={c.id}>
              {showDay ? <td style={{ fontWeight: 600 }}>{i === 0 || rows[i - 1].day_of_week !== c.day_of_week ? DAYS[c.day_of_week - 1] : ''}</td> : null}
              <td style={{ whiteSpace: 'nowrap' }}>{timeRange(c)}</td>
              <td>
                <b>{c.subject_code}</b> · {c.subject_name}
              </td>
              <td>{c.section_name}</td>
              <td>{c.room}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Teaching schedule grouped by section first: Section · Day · Time · Subject · Room. */
function SectionScheduleTable({ rows }: { rows: MyClass[] }) {
  const sorted = [...rows].sort(
    (a, b) => a.section_name.localeCompare(b.section_name) || a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time),
  );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Section</th>
            <th>Day</th>
            <th>Time</th>
            <th>Subject</th>
            <th>Room</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c, i) => {
            const newSection = i === 0 || sorted[i - 1].section_name !== c.section_name;
            const newDay = newSection || sorted[i - 1].day_of_week !== c.day_of_week;
            return (
              <tr key={c.id} style={newSection && i > 0 ? { borderTop: '2px solid #d5ddd7' } : undefined}>
                <td style={{ fontWeight: 600 }}>
                  {newSection ? (
                    <>
                      {c.section_name}
                      <small style={{ display: 'block', color: 'var(--text-soft)', fontWeight: 400 }}>Year {c.year_level}</small>
                    </>
                  ) : null}
                </td>
                <td>{newDay ? DAYS[c.day_of_week - 1] : ''}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{timeRange(c)}</td>
                <td>
                  <b>{c.subject_code}</b> · {c.subject_name}
                </td>
                <td>{c.room}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- 1. Dashboard ---------- */
/** The next classes after right now, across the coming 7 days (the weekly timetable repeats). */
function upcoming(list: MyClass[], count: number) {
  const now = new Date();
  const today = isoDay(now);
  const nowTime = now.toTimeString().slice(0, 8);
  const out: { c: MyClass; inDays: number }[] = [];
  for (let k = 0; k < 7 && out.length < count; k++) {
    const day = ((today - 1 + k) % 7) + 1;
    for (const c of sortClasses(list.filter((x) => x.day_of_week === day))) {
      if (k === 0 && c.start_time <= nowTime) continue; // already started today
      out.push({ c, inDays: k });
      if (out.length >= count) break;
    }
  }
  return out;
}
const whenLabel = (inDays: number, dow: number) => (inDays === 0 ? 'Today' : inDays === 1 ? 'Tomorrow' : DAYS[dow - 1]);

export function InstructorDashboard() {
  const { d } = useInstructor();
  const { name } = useAuth();
  const first = (name || d.profile.full_name || 'Instructor').split(' ')[0];
  const today = sortClasses(d.schedule.filter((c) => c.day_of_week === isoDay()));
  const next = upcoming(d.schedule, 5);
  const subjects = new Set(d.schedule.map((c) => c.subject_code)).size;
  const sections = new Set(d.schedule.map((c) => c.section_name)).size;
  const nowTime = new Date().toTimeString().slice(0, 8);
  const days = d.schedule.some((c) => c.day_of_week === 6) ? 6 : 5;
  return (
    <>
      <div className="card welcome">
        <Avatar name={d.profile.full_name || first} lg />
        <div>
          <h2>
            {greeting()}, {first}!
          </h2>
          <p>{[d.application?.employee_id, d.application?.department].filter(Boolean).join(' · ') || d.profile.email}</p>
          <p>{[fmtToday(), termLine(d.term)].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="facts">
          <div>
            <b>{today.length}</b>
            <small>Classes today</small>
          </div>
          <div>
            <b>{hours(d.schedule)}</b>
            <small>Hours / week</small>
          </div>
        </div>
      </div>

      <div className="grid grid-4">
        <Tile icon="book" label="Assigned subjects" value={fmtNum(subjects)} sub="This term" to="/subjects" />
        <Tile icon="users" label="Assigned sections" value={fmtNum(sections)} sub="This term" to="/sections" />
        <Tile icon="calendar" tone="neutral" label="Classes per week" value={fmtNum(d.schedule.length)} sub={`${hours(d.schedule)} teaching hours`} to="/schedule" />
        <Tile icon="clock" tone="ok" label="Classes today" value={fmtNum(today.length)} sub={today.length ? `First at ${fmtClock(today[0].start_time)}` : 'Free day'} to="/weekly-schedule" />
      </div>

      <div className="grid grid-2-even">
        <div className="card">
          <CardHead
            title="Today’s classes"
            sub={fmtToday()}
            right={
              <Link to="/weekly-schedule" className="btn btn-ghost btn-sm">
                Weekly view
              </Link>
            }
          />
          {today.length ? (
            <div className="list">
              {today.map((c) => {
                const live = c.start_time <= nowTime && nowTime < c.end_time;
                const done = c.end_time <= nowTime;
                return (
                  <div key={c.id} className="list-item" style={done ? { opacity: 0.75 } : undefined}>
                    <span className={`ic${live ? '' : ' gold'}`}>
                      <Icon name="clock" size={16} />
                    </span>
                    <div className="grow">
                      <b>
                        {c.subject_code} · {c.subject_name}
                      </b>
                      <small>
                        {c.section_name} · {c.room}
                      </small>
                    </div>
                    <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {live ? <span className="badge green">In session</span> : done ? <span className="badge gray">Done</span> : null}
                      <small style={{ display: 'block', color: 'var(--text-soft)' }}>{timeRange(c)}</small>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty icon="calendar" title="No classes today" body={d.schedule.length ? 'Enjoy the free day.' : 'Your administrator hasn’t assigned you any classes yet.'} />
          )}
        </div>
        <div className="card">
          <CardHead
            title="Upcoming classes"
            sub="Your next 5 classes"
            right={
              <Link to="/schedule" className="btn btn-ghost btn-sm">
                Full schedule
              </Link>
            }
          />
          {next.length ? (
            <div className="list">
              {next.map(({ c, inDays }) => (
                <div key={`${c.id}-${inDays}`} className="list-item">
                  <span className="ic">
                    <Icon name="calendar" size={16} />
                  </span>
                  <div className="grow">
                    <b>
                      {c.subject_code} · {c.subject_name}
                    </b>
                    <small>
                      {c.section_name} · {c.room}
                    </small>
                  </div>
                  <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <b style={{ fontSize: 12.5 }}>{whenLabel(inDays, c.day_of_week)}</b>
                    <small style={{ display: 'block', color: 'var(--text-soft)' }}>{fmtClock(c.start_time)}</small>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <Empty icon="clock" title="Nothing coming up" body="Classes assigned by your administrator appear here." />
          )}
        </div>
      </div>

      <div className="card">
        <CardHead
          title="This week at a glance"
          sub={termLine(d.term)}
          right={
            <Link to="/weekly-schedule" className="btn btn-ghost btn-sm">
              Open timetable
            </Link>
          }
        />
        <div className="week-glance" style={{ ['--days' as string]: days }}>
          {DAYS.slice(0, days).map((day, i) => {
            const rows = sortClasses(d.schedule.filter((c) => c.day_of_week === i + 1));
            return (
              <div key={day} className={`glance-day${i + 1 === isoDay() ? ' today' : ''}`}>
                <div className="glance-head">
                  <b>{day.slice(0, 3)}</b>
                  <small>{rows.length ? `${rows.length} class${rows.length === 1 ? '' : 'es'}` : 'Free'}</small>
                </div>
                {rows.map((c) => (
                  <div key={c.id} className={`week-slot glance-slot ${tint(c.subject_code)}`} title={`${c.subject_code} ${c.subject_name}\n${c.section_name} · ${timeRange(c)}\n${c.room}`}>
                    <b>{c.subject_code}</b>
                    <small>{fmtClock(c.start_time)}</small>
                    <small>{c.section_name}</small>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/* ---------- 2. My Profile ---------- */
export function InstructorProfile() {
  const { d } = useInstructor();
  const a = d.application;
  const badge = a?.status === 'approved' ? 'green' : a?.status === 'pending' ? 'gold' : 'red';
  return (
    <>
      <PageHeader title="My Profile" subtitle="Your instructor record. Only an administrator can change your verification status." />
      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="detail-grid">
          <div>
            <small>Full name</small>
            <b>{d.profile.full_name || '—'}</b>
          </div>
          <div>
            <small>Email</small>
            <b>{d.profile.email}</b>
          </div>
          <div>
            <small>Employee / faculty ID</small>
            <b>{a?.employee_id || '—'}</b>
          </div>
          <div>
            <small>Department</small>
            <b>{a?.department || '—'}</b>
          </div>
          <div>
            <small>Contact number</small>
            <b>{a?.contact_number || '—'}</b>
          </div>
          <div>
            <small>Verification status</small>
            <b>
              <span className={`badge ${badge}`}>{a ? a.status[0].toUpperCase() + a.status.slice(1) : 'No application'}</span>
            </b>
          </div>
          <div>
            <small>Approved on</small>
            <b>{a?.reviewed_at ? fmtDate(a.reviewed_at) : '—'}</b>
          </div>
          <div>
            <small>Member since</small>
            <b>{fmtDate(d.profile.created_at)}</b>
          </div>
        </div>
        <div className="note">
          <Icon name="info" />
          <div>
            To correct your employee ID, department or contact number, ask your administrator. Your name and password can be changed in{' '}
            <Link className="link" to="/settings">
              Account Settings
            </Link>
            .
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------- 3. My Subjects ---------- */
export function InstructorSubjects() {
  const { d } = useInstructor();
  const codes = [...new Set(d.schedule.map((c) => c.subject_code))].sort();
  return (
    <>
      <PageHeader title="My Subjects" subtitle={`Subjects assigned to you · ${termLine(d.term)}`} />
      <div className="card">
        {codes.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Subject</th>
                  <th className="num">Units</th>
                  <th>Sections</th>
                  <th className="num">Hours / week</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((code) => {
                  const rows = d.schedule.filter((c) => c.subject_code === code);
                  const sub = d.subjects.find((s) => s.code.toLowerCase() === code.toLowerCase());
                  return (
                    <tr key={code}>
                      <td>
                        <b>{code}</b>
                      </td>
                      <td>
                        {rows[0].subject_name}
                        {sub?.department ? <small style={{ display: 'block', color: 'var(--text-soft)' }}>{sub.department}</small> : null}
                      </td>
                      <td className="num">{sub?.units ?? '—'}</td>
                      <td>{[...new Set(rows.map((r) => r.section_name))].join(', ')}</td>
                      <td className="num">{hours(rows)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="book" title="No subjects assigned yet" body="Your administrator assigns subjects through the official schedule." />
        )}
      </div>
    </>
  );
}

/* ---------- 4. My Sections ---------- */
export function InstructorSections() {
  const { d } = useInstructor();
  const names = [...new Set(d.schedule.map((c) => c.section_name))].sort();
  return (
    <>
      <PageHeader title="My Sections" subtitle={`Sections you teach · ${termLine(d.term)}`} />
      {names.length ? (
        <div className="grid grid-2-even">
          {names.map((name) => {
            const rows = sortClasses(d.schedule.filter((c) => c.section_name === name));
            const sec = d.sections.find((s) => s.name.toLowerCase() === name.toLowerCase());
            return (
              <div key={name} className="card">
                <CardHead title={name} sub={[`Year ${rows[0].year_level}`, sec?.program, sec?.department].filter(Boolean).join(' · ')} />
                <ScheduleTable rows={rows} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <Empty icon="users" title="No sections assigned yet" body="Your administrator assigns sections through the official schedule." />
        </div>
      )}
    </>
  );
}

/* ---------- 5. My Teaching Schedule (table) ---------- */
export function InstructorSchedule() {
  const { d } = useInstructor();
  const rows = sortClasses(d.schedule);
  return (
    <>
      <PageHeader title="My Teaching Schedule" subtitle={`${termLine(d.term)} · ${rows.length} classes · ${hours(rows)} hours per week`} />
      <div className="note">
        <Icon name="shield" />
        <div>The official schedule is set by your administrator. You’re notified here and in the mobile app whenever it changes.</div>
      </div>
      <div className="card">{rows.length ? <SectionScheduleTable rows={rows} /> : <Empty icon="calendar" title="No classes yet" body="When an administrator assigns you to a subject and section, it appears here." />}</div>
    </>
  );
}

/* ---------- 6. Weekly Schedule (weekly grid with rooms) ---------- */
export function InstructorClassSchedule() {
  const { d } = useInstructor();
  const rows = d.schedule;
  const HOUR_PX = 52;
  const days = rows.some((c) => c.day_of_week === 7) ? 7 : rows.some((c) => c.day_of_week === 6) ? 6 : 5;
  const start = Math.min(7 * 60, ...rows.map((c) => Math.floor(minutesOf(c.start_time) / 60) * 60));
  const end = Math.max(18 * 60, ...rows.map((c) => Math.ceil(minutesOf(c.end_time) / 60) * 60));
  const hrs = Array.from({ length: (end - start) / 60 }, (_, i) => start / 60 + i);
  return (
    <>
      <PageHeader title="Weekly Schedule" subtitle={`Your week at a glance with classrooms · ${termLine(d.term)}`} />
      <div className="card">
        {rows.length ? (
          <div className="table-wrap">
            <div className="week-grid" style={{ ['--days' as string]: days }}>
              <div className="week-head" />
              {DAYS.slice(0, days).map((day) => (
                <div key={day} className="week-head">
                  {day.slice(0, 3).toUpperCase()}
                </div>
              ))}
              <div>
                {hrs.map((h) => (
                  <div key={h} className="week-hour">
                    {fmtClock(`${h}:00`).replace(':00', '')}
                  </div>
                ))}
              </div>
              {DAYS.slice(0, days).map((day, i) => (
                <div key={day} className="week-col" style={{ height: hrs.length * HOUR_PX }}>
                  {hrs.map((h) => (
                    <div key={h} style={{ height: HOUR_PX, borderBottom: '1px solid var(--grid)' }} />
                  ))}
                  {rows
                    .filter((c) => c.day_of_week === i + 1)
                    .map((c) => (
                      <div
                        key={c.id}
                        className={`week-slot ${tint(c.subject_code)}`}
                        style={{ top: ((minutesOf(c.start_time) - start) / 60) * HOUR_PX, height: ((minutesOf(c.end_time) - minutesOf(c.start_time)) / 60) * HOUR_PX - 2, cursor: 'default' }}
                        title={`${c.subject_code} ${c.subject_name}\n${c.section_name} · ${timeRange(c)}\n${c.room}`}>
                        <b>{c.subject_code}</b>
                        <small>{c.section_name}</small>
                        <small>{timeRange(c)}</small>
                        <small>{c.room}</small>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Empty icon="calendar" title="No classes yet" body="When an administrator assigns you to a subject and section, it appears here." />
        )}
      </div>
    </>
  );
}

/* ---------- 7. Notifications ---------- */
export function InstructorNotifications() {
  const { d, refresh } = useInstructor();
  const unread = d.notifications.some((n) => !n.read_at);
  useEffect(() => {
    if (!unread) return;
    const t = setTimeout(() => void markNotificationsRead().then(refresh).catch(() => {}), 1500);
    return () => clearTimeout(t);
  }, [unread, refresh]);
  return (
    <>
      <PageHeader title="Notifications" subtitle="Schedule updates and messages from your administrator." />
      <div className="card">
        {d.notifications.length ? (
          <div className="list">
            {d.notifications.map((n) => (
              <div key={n.id} className="list-item" style={n.read_at ? undefined : { background: 'var(--gold-soft)' }}>
                <span className={`ic${n.read_at ? '' : ' gold'}`}>
                  <Icon name={n.kind === 'application' ? 'shield' : 'calendar'} size={16} />
                </span>
                <div className="grow">
                  <b>{n.title}</b>
                  <small style={{ whiteSpace: 'normal' }}>{n.body}</small>
                </div>
                <time>{fmtDateTime(n.created_at)}</time>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="megaphone" title="No notifications" body="Approvals and schedule changes from administrators appear here." />
        )}
      </div>
    </>
  );
}

/* ---------- 8. Account Settings ---------- */
export function InstructorSettings() {
  const { d, refresh } = useInstructor();
  const { reload } = useAuth();
  const [name, setName] = useState(d.profile.full_name);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok: boolean; which: 'name' | 'pw' } | null>(null);
  const [busy, setBusy] = useState<'name' | 'pw' | null>(null);

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setMsg({ text: 'Enter your name.', ok: false, which: 'name' });
    setBusy('name');
    try {
      await updateMyName(name);
      await Promise.all([refresh(), reload()]);
      setMsg({ text: 'Name saved. It shows the same in the mobile app.', ok: true, which: 'name' });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : String(err), ok: false, which: 'name' });
    } finally {
      setBusy(null);
    }
  };

  const savePw = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return setMsg({ text: 'Use at least 8 characters.', ok: false, which: 'pw' });
    if (pw !== pw2) return setMsg({ text: 'The two passwords do not match.', ok: false, which: 'pw' });
    setBusy('pw');
    try {
      await changeMyPassword(pw);
      setPw('');
      setPw2('');
      setMsg({ text: 'Password changed. Use it on the website and in the mobile app.', ok: true, which: 'pw' });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : String(err), ok: false, which: 'pw' });
    } finally {
      setBusy(null);
    }
  };

  const note = (which: 'name' | 'pw') =>
    msg?.which === which ? msg.ok ? <div className="note"><Icon name="check" /><div>{msg.text}</div></div> : <ErrorNote message={msg.text} /> : null;

  return (
    <>
      <PageHeader title="Account Settings" subtitle="Changes apply to both the Instructor Portal and the mobile app." />
      <div className="grid grid-2-even">
        <form className="card" onSubmit={saveName}>
          <CardHead title="Display name" />
          <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Full name">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </Field>
            <Field label="Email" hint="Your sign-in email can’t be changed here.">
              <input className="input" value={d.profile.email} disabled />
            </Field>
            {note('name')}
            <button className="btn btn-primary" disabled={busy === 'name'} style={{ alignSelf: 'flex-start' }}>
              {busy === 'name' ? 'Saving…' : 'Save name'}
            </button>
          </div>
        </form>
        <form className="card" onSubmit={savePw}>
          <CardHead title="Change password" />
          <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="New password" hint="At least 8 characters.">
              <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Confirm new password">
              <input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
            </Field>
            {note('pw')}
            <button className="btn btn-primary" disabled={busy === 'pw'} style={{ alignSelf: 'flex-start' }}>
              {busy === 'pw' ? 'Saving…' : 'Change password'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
