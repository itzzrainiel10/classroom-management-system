import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Icon } from '../components/icons';
import { useWorkspace } from '../layouts/AdminLayout';
import { CardHead, Confirm, Empty, ErrorNote, Field, Modal, PageHeader, Person } from '../components/ui';
import { deleteSection, rolesOf, saveSection, setStudentSection, type Section } from '../services/data';

export default function Sections() {
  const { w, refresh } = useWorkspace();
  const [edit, setEdit] = useState<Partial<Section> | null>(null);
  const [del, setDel] = useState<Section | null>(null);
  const [year, setYear] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = w.sections.filter((s) => year === 'all' || String(s.year_level) === year);
  const students = (id: string) => w.profiles.filter((p) => p.section_id === id);
  const classes = (id: string) => w.schedules.filter((x) => x.section_id === id && x.semester === w.settings.current_semester && x.academic_year === w.settings.current_academic_year);
  const open = w.sections.find((s) => s.id === openId);

  return (
    <>
      <PageHeader
        title="Sections"
        subtitle="Year levels and sections. Students see the official schedule of the section they belong to."
        actions={
          <button className="btn btn-primary" onClick={() => setEdit({ year_level: 1, program: '', department: '' })}>
            <Icon name="plus" size={16} /> Add section
          </button>
        }
      />
      <div className="filters">
        <select className="select" value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year level">
          <option value="all">All year levels</option>
          {[1, 2, 3, 4, 5, 6].map((y) => (
            <option key={y} value={y}>
              Year {y}
            </option>
          ))}
        </select>
      </div>
      <div className="card">
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Section</th>
                  <th>Program</th>
                  <th>Year level</th>
                  <th className="num">Students</th>
                  <th className="num">Classes this term</th>
                  <th className="num" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <b>{s.name}</b>
                      {s.department ? <div style={{ color: 'var(--text-soft)', fontSize: 12.5 }}>{s.department}</div> : null}
                    </td>
                    <td>{s.program || '—'}</td>
                    <td>Year {s.year_level}</td>
                    <td className="num">{students(s.id).length}</td>
                    <td className="num">
                      <Link className="link" to={`/admin/schedules?section=${s.id}`}>
                        {classes(s.id).length}
                      </Link>
                    </td>
                    <td className="num">
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                        <button className="btn btn-primary btn-sm" onClick={() => setOpenId(s.id)}>
                          Students
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setEdit(s)}>
                          Edit
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setDel(s)} aria-label={`Delete ${s.name}`}>
                          <Icon name="trash" size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="school" title="No sections yet" body="Add sections like “BSIT 3-1”, then assign students and schedule their subjects." />
        )}
      </div>

      {open ? <SectionStudents section={open} onClose={() => setOpenId(null)} /> : null}
      {edit ? (
        <SectionForm
          value={edit}
          onClose={() => setEdit(null)}
          onSaved={async () => {
            setEdit(null);
            await refresh();
          }}
        />
      ) : null}
      {del ? (
        <Confirm
          title={`Delete ${del.name}?`}
          body={
            classes(del.id).length || w.schedules.some((x) => x.section_id === del.id)
              ? 'This section still has scheduled classes. Delete them on the Schedules page first.'
              : `${students(del.id).length} student(s) will be left without a section.`
          }
          confirmLabel="Delete section"
          danger
          onClose={() => setDel(null)}
          onConfirm={async () => {
            await deleteSection(del.id);
            setDel(null);
            await refresh();
          }}
        />
      ) : null}
    </>
  );
}

function SectionForm({ value, onClose, onSaved }: { value: Partial<Section>; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof Section, x: string | number) => setV((o) => ({ ...o, [k]: x }));
  const save = async () => {
    if (!v.name?.trim()) return setErr('Enter the section name, e.g. BSIT 3-1.');
    setBusy(true);
    setErr(null);
    try {
      await saveSection({ id: v.id, name: v.name.trim(), program: (v.program ?? '').trim().toUpperCase(), year_level: Number(v.year_level ?? 1), department: (v.department ?? '').trim() });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={v.id ? 'Edit section' : 'Add section'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save section'}
          </button>
        </>
      }>
      <Field label="Section name">
        <input className="input" value={v.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="BSIT 3-1" autoFocus />
      </Field>
      <div className="form-grid">
        <Field label="Program">
          <input className="input" value={v.program ?? ''} onChange={(e) => set('program', e.target.value)} placeholder="BSIT" />
        </Field>
        <Field label="Year level">
          <select className="select" value={v.year_level ?? 1} onChange={(e) => set('year_level', e.target.value)}>
            {[1, 2, 3, 4, 5, 6].map((y) => (
              <option key={y} value={y}>
                Year {y}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Department">
        <input className="input" value={v.department ?? ''} onChange={(e) => set('department', e.target.value)} placeholder="Department of Information Technology" />
      </Field>
      {err ? <ErrorNote message={err} /> : null}
    </Modal>
  );
}

/** Students in a section: add by email / student number, move out. */
function SectionStudents({ section, onClose }: { section: Section; onClose: () => void }) {
  const { w, refresh } = useWorkspace();
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const members = w.profiles.filter((p) => p.section_id === section.id);

  const add = async () => {
    const q = who.trim().toLowerCase();
    if (!q) return;
    const p = w.profiles.find((x) => x.email === q || (x.student_number && x.student_number.toLowerCase() === q));
    if (!p) return setErr('No account with that email or student number. The student must sign up in the app first.');
    if (!rolesOf(w, p.id).includes('student')) return setErr('That account is not a student.');
    setBusy(true);
    setErr(null);
    try {
      await setStudentSection(p.id, section.id);
      await refresh();
      setWho('');
      setDone(`${p.full_name || p.email} is now in ${section.name} and was notified.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`${section.name} · students`} sub={`Year ${section.year_level}${section.program ? ` · ${section.program}` : ''}`} onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <Field label="Add a student (university email or student number)">
        <div className="row">
          <input className="input" value={who} onChange={(e) => setWho(e.target.value)} placeholder="ahl.vale@cvsu.edu.ph or 2026-01428" onKeyDown={(e) => e.key === 'Enter' && void add()} />
          <button className="btn btn-primary" onClick={() => void add()} disabled={busy}>
            Add
          </button>
        </div>
      </Field>
      {err ? <ErrorNote message={err} /> : null}
      {done ? <div className="note"><Icon name="checkCircle" /><div>{done}</div></div> : null}
      <div className="card" style={{ boxShadow: 'none' }}>
        <CardHead title={`${members.length} student${members.length === 1 ? '' : 's'}`} />
        {members.length ? (
          <div className="list">
            {members.map((p) => (
              <div className="list-item" key={p.id}>
                <div className="grow">
                  <Person name={p.full_name || p.email} sub={p.student_number ? `${p.email} · ${p.student_number}` : p.email} />
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={async () => {
                    await setStudentSection(p.id, null);
                    await refresh();
                  }}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="users" title="No students yet" />
        )}
      </div>
    </Modal>
  );
}
