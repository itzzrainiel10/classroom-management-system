import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { Icon } from '../components/icons';
import { Pager, usePaged } from '../components/pager';
import { useWorkspace } from '../layouts/AdminLayout';
import { Confirm, Empty, ErrorNote, Field, Modal, PageHeader, Success } from '../components/ui';
import { DAYS, ROOM_TYPES, SEMESTERS, deleteSchedule, isApprovedInstructor, nameOf, saveSchedule, type OfficialSchedule, type ScheduleInput, type Workspace } from '../services/data';
import { downloadCsv, fmtClock, minutesOf, semesterRange } from '../services/format';

/** Same subject → same calm colour (week-slot c0–c5) in every timetable. */
const tint = (code: string) => `c${[...code].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 6}`;


const HOUR_PX = 52;

/** Everything needed to show one schedule row. */
function describe(w: Workspace, s: OfficialSchedule) {
  const subject = w.subjects.find((x) => x.id === s.subject_id);
  const section = w.sections.find((x) => x.id === s.section_id);
  const room = w.rooms.find((x) => x.id === s.room_id);
  const ip = w.instructorProfiles.find((x) => x.user_id === s.instructor_id);
  return {
    instructor: nameOf(w, s.instructor_id),
    employeeId: ip?.employee_id ?? '',
    department: ip?.department ?? '',
    subjectCode: subject?.code ?? '—',
    subjectName: subject?.name ?? '—',
    section: section?.name ?? '—',
    year: section?.year_level ?? 0,
    room: room ? `${room.name}${room.room_type === 'laboratory' ? ' (Lab)' : ''}` : '—',
    time: `${fmtClock(s.start_time)}–${fmtClock(s.end_time)}`,
  };
}

/** Same-term schedules that overlap `v` for the instructor, room or section (client-side preview; the database has the final say). */
export function conflictsOf(w: Workspace, v: ScheduleInput) {
  if (!v.start_time || !v.end_time || minutesOf(v.end_time) <= minutesOf(v.start_time)) return [];
  const a = minutesOf(v.start_time);
  const b = minutesOf(v.end_time);
  return w.schedules
    .filter((s) => s.id !== v.id && s.semester === v.semester && s.academic_year === v.academic_year && s.day_of_week === Number(v.day_of_week))
    .filter((s) => minutesOf(s.start_time) < b && a < minutesOf(s.end_time))
    .flatMap((s) => {
      const d = describe(w, s);
      const what = `${d.subjectCode} · ${d.section} · ${DAYS[s.day_of_week - 1]} ${d.time} · ${d.room}`;
      const out: string[] = [];
      if (s.instructor_id === v.instructor_id) out.push(`Instructor already teaches ${what}`);
      if (s.room_id === v.room_id) out.push(`Room already used by ${what}`);
      if (s.section_id === v.section_id) out.push(`Section already has ${what}`);
      return out;
    });
}

export default function Schedules() {
  const { w, refresh } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'calendar' | 'table' | 'section'>(() => (params.get('section') ? 'section' : 'calendar'));
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('all');
  const [year, setYear] = useState('all');
  const [subject, setSubject] = useState('all');
  const [day, setDay] = useState('all');
  const [term, setTerm] = useState(`${w.settings.current_semester}|${w.settings.current_academic_year}`);
  const [edit, setEdit] = useState<ScheduleInput | null>(null);
  const [del, setDel] = useState<OfficialSchedule | null>(null);
  const [done, setDone] = useState<{ title: string; body: string } | null>(null);
  const section = params.get('section') ?? 'all';
  const instructor = params.get('instructor') ?? 'all';
  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v === 'all') p.delete(k);
    else p.set(k, v);
    setParams(p, { replace: true });
  };

  const [semester, academicYear] = term.split('|');
  const terms = useMemo(() => {
    const set = new Set([`${w.settings.current_semester}|${w.settings.current_academic_year}`, ...w.schedules.map((s) => `${s.semester}|${s.academic_year}`)]);
    return [...set];
  }, [w]);
  const depts = [...new Set(w.instructorProfiles.map((p) => p.department).filter(Boolean))].sort();
  const needle = q.trim().toLowerCase();

  const rows = w.schedules
    .filter((s) => s.semester === semester && s.academic_year === academicYear)
    .map((s) => ({ s, d: describe(w, s) }))
    .filter(({ s, d }) =>
      (instructor === 'all' || s.instructor_id === instructor) &&
      (section === 'all' || s.section_id === section) &&
      (subject === 'all' || s.subject_id === subject) &&
      (day === 'all' || String(s.day_of_week) === day) &&
      (year === 'all' || String(d.year) === year) &&
      (dept === 'all' || d.department === dept) &&
      (!needle || `${d.instructor} ${d.employeeId}`.toLowerCase().includes(needle)),
    )
    .sort((a, b) => a.s.day_of_week - b.s.day_of_week || a.s.start_time.localeCompare(b.s.start_time));

  const approved = w.profiles.filter((p) => isApprovedInstructor(w, p.id));
  const { shown: pageRows, paging } = usePaged(rows, `${semester}|${academicYear}|${instructor}|${section}|${subject}|${day}|${year}|${dept}|${needle}`);
  const ready = approved.length && w.subjects.length && w.sections.length && w.rooms.length;
  const blank = (): ScheduleInput => ({
    instructor_id: instructor !== 'all' ? instructor : approved[0]?.id ?? '',
    subject_id: subject !== 'all' ? subject : w.subjects[0]?.id ?? '',
    section_id: section !== 'all' ? section : w.sections[0]?.id ?? '',
    room_id: w.rooms[0]?.id ?? '',
    day_of_week: day !== 'all' ? Number(day) : 1,
    start_time: '08:00',
    end_time: '10:00',
    semester,
    academic_year: academicYear,
  });

  const exportCsv = () =>
    downloadCsv(`schedule-${semester}-${academicYear}.csv`.replace(/\s+/g, '-'), [
      ['Instructor', 'Instructor ID', 'Department', 'Subject code', 'Subject name', 'Year level', 'Section', 'Day', 'Start', 'End', 'Room', 'Semester', 'Academic year'],
      ...rows.map(({ s, d }) => [d.instructor, d.employeeId, d.department, d.subjectCode, d.subjectName, d.year, d.section, DAYS[s.day_of_week - 1], fmtClock(s.start_time), fmtClock(s.end_time), d.room, s.semester, s.academic_year]),
    ]);

  return (
    <>
      <PageHeader
        title="Schedules"
        subtitle="Official class schedules per section. Instructors and students see these in the mobile app."
        actions={
          <>
            <button className="btn btn-secondary" onClick={exportCsv} disabled={!rows.length}>
              <Icon name="download" size={16} /> Export
            </button>
            <button className="btn btn-primary" onClick={() => setEdit(blank())} disabled={!ready}>
              <Icon name="plus" size={16} /> Add schedule
            </button>
          </>
        }
      />

      {!ready ? (
        <div className="note gold">
          <Icon name="info" />
          <div>
            Before scheduling you need at least one{' '}
            {!approved.length ? <Link className="link" to="/admin/instructor-verification">approved instructor</Link> : null}
            {!approved.length && (!w.subjects.length || !w.sections.length || !w.rooms.length) ? ', ' : ''}
            {!w.subjects.length ? <Link className="link" to="/admin/subjects">subject</Link> : null}
            {!w.subjects.length && (!w.sections.length || !w.rooms.length) ? ', ' : ''}
            {!w.sections.length ? <Link className="link" to="/admin/sections">section</Link> : null}
            {!w.sections.length && !w.rooms.length ? ' and ' : ''}
            {!w.rooms.length ? <Link className="link" to="/admin/rooms">room</Link> : null}.
          </div>
        </div>
      ) : null}

      <div className="filters">
        <div className="search" style={{ margin: 0, flex: '1 1 220px', maxWidth: 280 }}>
          <Icon name="search" size={16} />
          <input placeholder="Search instructor or ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search instructor" />
        </div>
        <select className="select" value={instructor} onChange={(e) => setParam('instructor', e.target.value)} aria-label="Instructor">
          <option value="all">All instructors</option>
          {approved.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name || p.email}
            </option>
          ))}
        </select>
        <select className="select" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
          <option value="all">All departments</option>
          {depts.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select className="select" value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year level">
          <option value="all">All year levels</option>
          {[...new Set(w.sections.map((s) => s.year_level))].sort().map((y) => (
            <option key={y} value={y}>
              Year {y}
            </option>
          ))}
        </select>
        <select className="select" value={section} onChange={(e) => setParam('section', e.target.value)} aria-label="Section">
          <option value="all">All sections</option>
          {w.sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select className="select" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject">
          <option value="all">All subjects</option>
          {w.subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} · {s.name}
            </option>
          ))}
        </select>
        <select className="select" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day">
          <option value="all">All days</option>
          {DAYS.map((d, i) => (
            <option key={d} value={i + 1}>
              {d}
            </option>
          ))}
        </select>
        <select className="select" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Term">
          {terms.map((t) => (
            <option key={t} value={t}>
              {t.replace('|', ' · AY ')}
            </option>
          ))}
        </select>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>
              {rows.length} class{rows.length === 1 ? '' : 'es'} · {semester} · AY {academicYear}
            </h2>
            <p>
              {semester === w.settings.current_semester && academicYear === w.settings.current_academic_year
                ? `Weekly classes · ${semesterRange(w.settings.semester_start, w.settings.semester_end)} · `
                : 'Weekly classes · '}
              Click a class to edit it.
            </p>
          </div>
          <div className="view-toggle" role="tablist">
            <button className={view === 'calendar' ? 'on' : ''} onClick={() => setView('calendar')}>
              <Icon name="calendar" size={15} /> Week
            </button>
            <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>
              <Icon name="menu" size={15} /> Table
            </button>
            <button className={view === 'section' ? 'on' : ''} onClick={() => setView('section')}>
              <Icon name="school" size={15} /> By section
            </button>
          </div>
        </div>
        {!rows.length ? (
          <Empty icon="calendar" title="No classes match" body="Change the filters, or add a schedule." />
        ) : view === 'calendar' ? (
          <WeekCalendar w={w} items={rows.map((r) => r.s)} onOpen={(s) => setEdit({ ...s })} />
        ) : view === 'section' ? (
          <BySection w={w} rows={rows} onOpen={(s) => setEdit({ ...s })} />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Day & time</th>
                    <th>Subject</th>
                    <th>Section</th>
                    <th>Instructor</th>
                    <th>Room</th>
                    <th className="num" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(({ s, d }) => (
                    <tr key={s.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <b>{DAYS[s.day_of_week - 1]}</b>
                        <div style={{ color: 'var(--text-soft)', fontSize: 'calc(12.5px * var(--text-scale))' }}>{d.time}</div>
                      </td>
                      <td>
                        <b>{d.subjectCode}</b>
                        <div style={{ color: 'var(--text-soft)', fontSize: 'calc(12.5px * var(--text-scale))' }}>{d.subjectName}</div>
                      </td>
                      <td>
                        {d.section}
                        <div style={{ color: 'var(--text-soft)', fontSize: 'calc(12.5px * var(--text-scale))' }}>Year {d.year}</div>
                      </td>
                      <td>
                        {d.instructor}
                        <div style={{ color: 'var(--text-soft)', fontSize: 'calc(12.5px * var(--text-scale))' }}>
                          {d.employeeId || '—'}
                          {d.department ? ` · ${d.department}` : ''}
                        </div>
                      </td>
                      <td>{d.room}</td>
                      <td className="num">
                        <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => setEdit({ ...s })}>
                            Edit
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setDel(s)} aria-label="Delete schedule">
                            <Icon name="trash" size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager paging={paging} noun="classes" />
          </>
        )}
      </div>

      {edit ? (
        <ScheduleForm
          value={edit}
          onClose={() => setEdit(null)}
          onDelete={edit.id ? () => setDel(w.schedules.find((s) => s.id === edit.id) ?? null) : undefined}
          onSaved={async (isNew) => {
            setEdit(null);
            await refresh();
            setDone({
              title: isNew ? 'Schedule assigned' : 'Schedule updated',
              body: 'The instructor and the students of the section were notified and see the change in the mobile app.',
            });
          }}
        />
      ) : null}
      {del ? (
        <Confirm
          title="Cancel this class?"
          body={(() => {
            const d = describe(w, del);
            return `${d.subjectCode} · ${d.section} · ${DAYS[del.day_of_week - 1]} ${d.time} · ${d.room} (${d.instructor}). The instructor and the section's students will be notified. Other schedules are not affected.`;
          })()}
          confirmLabel="Delete schedule"
          danger
          onClose={() => setDel(null)}
          onConfirm={async () => {
            await deleteSchedule(del.id);
            setDel(null);
            setEdit(null);
            await refresh();
            setDone({ title: 'Schedule cancelled', body: 'The instructor and students were notified.' });
          }}
        />
      ) : null}
      {done ? <Success title={done.title} body={done.body} onDone={() => setDone(null)} /> : null}
    </>
  );
}

/** One block per section: its own week timetable plus the list of subjects, instructors and rooms. */
function BySection({ w, rows, onOpen }: { w: Workspace; rows: { s: OfficialSchedule; d: ReturnType<typeof describe> }[]; onOpen: (s: OfficialSchedule) => void }) {
  const sections = w.sections
    .filter((sec) => rows.some((r) => r.s.section_id === sec.id))
    .sort((a, b) => a.year_level - b.year_level || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return (
    <div className="sec-sched-list">
      {sections.map((sec) => {
        const mine = rows.filter((r) => r.s.section_id === sec.id);
        const subjectIds = [...new Set(mine.map((r) => r.s.subject_id))];
        const units = subjectIds.reduce((n, id) => n + (w.subjects.find((x) => x.id === id)?.units ?? 0), 0);
        const minutes = mine.reduce((n, r) => n + minutesOf(r.s.end_time) - minutesOf(r.s.start_time), 0);
        const hrs = Math.round((minutes / 60) * 10) / 10;
        return (
          <section key={sec.id} className="sec-sched">
            <div className="sec-sched-head">
              <div>
                <h3>{sec.name}</h3>
                <p>
                  {sec.program ? `${sec.program} · ` : ''}Year {sec.year_level} · {subjectIds.length} subject{subjectIds.length === 1 ? '' : 's'} · {units} unit{units === 1 ? '' : 's'} ·{' '}
                  {hrs} hr{hrs === 1 ? '' : 's'}/week
                </p>
              </div>
            </div>
            <WeekCalendar w={w} items={mine.map((r) => r.s)} onOpen={onOpen} hideSection />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Instructor</th>
                    <th>Day & time</th>
                    <th>Room</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.map(({ s, d }) => (
                    <tr key={s.id} className="clickable" onClick={() => onOpen(s)}>
                      <td>
                        <b>{d.subjectCode}</b>
                        <div style={{ color: 'var(--text-soft)', fontSize: 'calc(12.5px * var(--text-scale))' }}>{d.subjectName}</div>
                      </td>
                      <td>{d.instructor}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {DAYS[s.day_of_week - 1]} · {d.time}
                      </td>
                      <td>{d.room}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function WeekCalendar({ w, items, onOpen, hideSection = false }: { w: Workspace; items: OfficialSchedule[]; onOpen: (s: OfficialSchedule) => void; hideSection?: boolean }) {
  const days = items.some((s) => s.day_of_week === 7) ? 7 : 6;
  const start = Math.min(7 * 60, ...items.map((s) => Math.floor(minutesOf(s.start_time) / 60) * 60));
  const end = Math.max(18 * 60, ...items.map((s) => Math.ceil(minutesOf(s.end_time) / 60) * 60));
  const hours = Array.from({ length: (end - start) / 60 }, (_, i) => start / 60 + i);
  return (
    <div className="table-wrap">
      <div className="week-grid" style={{ ['--days' as string]: days }}>
        <div className="week-head" />
        {DAYS.slice(0, days).map((d) => (
          <div key={d} className="week-head">
            {d.slice(0, 3).toUpperCase()}
          </div>
        ))}
        <div>
          {hours.map((h) => (
            <div key={h} className="week-hour">
              {fmtClock(`${h}:00`).replace(':00', '')}
            </div>
          ))}
        </div>
        {DAYS.slice(0, days).map((d, i) => (
          <div key={d} className="week-col" style={{ height: hours.length * HOUR_PX }}>
            {hours.map((h) => (
              <div key={h} style={{ height: HOUR_PX, borderBottom: '1px solid var(--grid)' }} />
            ))}
            {items
              .filter((s) => s.day_of_week === i + 1)
              .map((s) => {
                const dsc = describe(w, s);
                const top = ((minutesOf(s.start_time) - start) / 60) * HOUR_PX;
                const height = ((minutesOf(s.end_time) - minutesOf(s.start_time)) / 60) * HOUR_PX - 2;
                return (
                  <button key={s.id} className={`week-slot ${tint(dsc.subjectCode)}`} style={{ top, height }} onClick={() => onOpen(s)} title={`${dsc.subjectCode} ${dsc.subjectName}\n${dsc.section} · ${dsc.time}\n${dsc.instructor} · ${dsc.room}`}>
                    <b>{dsc.subjectCode}</b>
                    {hideSection ? null : <small>{dsc.section}</small>}
                    <small>{dsc.time}</small>
                    <small>
                      {dsc.instructor} · {dsc.room}
                    </small>
                  </button>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}

function ScheduleForm({ value, onClose, onSaved, onDelete }: { value: ScheduleInput; onClose: () => void; onSaved: (isNew: boolean) => void; onDelete?: () => void }) {
  const { w } = useWorkspace();
  const [v, setV] = useState<ScheduleInput>({ ...value, start_time: value.start_time.slice(0, 5), end_time: value.end_time.slice(0, 5) });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof ScheduleInput>(k: K, x: ScheduleInput[K]) => setV((o) => ({ ...o, [k]: x }));
  const approved = w.profiles.filter((p) => isApprovedInstructor(w, p.id) || p.id === value.instructor_id);
  const conflicts = conflictsOf(w, v);
  const ip = w.instructorProfiles.find((x) => x.user_id === v.instructor_id);
  const sec = w.sections.find((x) => x.id === v.section_id);

  const save = async () => {
    if (!v.instructor_id || !v.subject_id || !v.section_id || !v.room_id) return setErr('Choose the instructor, subject, section and room.');
    if (minutesOf(v.end_time) <= minutesOf(v.start_time)) return setErr('End time must be later than start time.');
    if (!/^\d{4}-\d{4}$/.test(v.academic_year)) return setErr('Academic year must look like 2026-2027.');
    setBusy(true);
    setErr(null);
    try {
      await saveSchedule({ ...v, day_of_week: Number(v.day_of_week) });
      onSaved(!v.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={v.id ? 'Edit schedule' : 'Add schedule'}
      sub="The instructor and the section's students are notified when you save."
      onClose={onClose}
      footer={
        <>
          {onDelete ? (
            <button className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={onDelete}>
              <Icon name="trash" size={14} /> Delete
            </button>
          ) : null}
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : v.id ? 'Save changes' : 'Assign schedule'}
          </button>
        </>
      }>
      <Field label="Instructor" hint={ip ? `ID ${ip.employee_id || '—'}${ip.department ? ` · ${ip.department}` : ''}` : 'Only approved instructors can be assigned.'}>
        <select className="select" value={v.instructor_id} onChange={(e) => set('instructor_id', e.target.value)}>
          {approved.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name || p.email}
            </option>
          ))}
        </select>
      </Field>
      <div className="form-grid">
        <Field label="Subject">
          <select className="select" value={v.subject_id} onChange={(e) => set('subject_id', e.target.value)}>
            {w.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Section" hint={sec ? `Year level ${sec.year_level}` : undefined}>
          <select className="select" value={v.section_id} onChange={(e) => set('section_id', e.target.value)}>
            {w.sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="form-grid">
        <Field label="Day">
          <select className="select" value={v.day_of_week} onChange={(e) => set('day_of_week', Number(e.target.value))}>
            {DAYS.map((d, i) => (
              <option key={d} value={i + 1}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Room">
          <select className="select" value={v.room_id} onChange={(e) => set('room_id', e.target.value)}>
            {ROOM_TYPES.map((t) => {
              const list = w.rooms.filter((r) => (r.room_type ?? 'lecture') === t.value);
              return list.length ? (
                <optgroup key={t.value} label={t.plural}>
                  {list.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {r.building ? ` · ${r.building}` : ''}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </select>
        </Field>
      </div>
      <div className="form-grid">
        <Field label="Start time">
          <input className="input" type="time" step={300} value={v.start_time} onChange={(e) => set('start_time', e.target.value)} />
        </Field>
        <Field label="End time">
          <input className="input" type="time" step={300} value={v.end_time} onChange={(e) => set('end_time', e.target.value)} />
        </Field>
      </div>
      <div className="form-grid">
        <Field label="Semester">
          <select className="select" value={v.semester} onChange={(e) => set('semester', e.target.value)}>
            {SEMESTERS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Academic year">
          <input className="input" value={v.academic_year} onChange={(e) => set('academic_year', e.target.value)} placeholder="2026-2027" />
        </Field>
      </div>
      {conflicts.length ? (
        <div className="note red">
          <Icon name="alert" />
          <div>
            <b>Conflicts — this can’t be saved:</b>
            {conflicts.map((c) => (
              <div key={c}>• {c}</div>
            ))}
          </div>
        </div>
      ) : v.start_time && v.end_time && minutesOf(v.end_time) > minutesOf(v.start_time) ? (
        <div className="note">
          <Icon name="checkCircle" />
          <div>No conflicts with this instructor, room or section.</div>
        </div>
      ) : null}
      {err ? <ErrorNote message={err} /> : null}
    </Modal>
  );
}
