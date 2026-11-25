import { useState } from 'react';

import { Icon } from '../components/icons';
import { useWorkspace } from '../components/Shell';
import { Confirm, Empty, ErrorNote, Field, Modal, PageHeader } from '../components/ui';
import { deleteSubject, saveSubject, type Subject } from '../lib/data';

export default function Subjects() {
  const { w, refresh } = useWorkspace();
  const [edit, setEdit] = useState<Partial<Subject> | null>(null);
  const [del, setDel] = useState<Subject | null>(null);
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('all');
  const depts = [...new Set(w.subjects.map((s) => s.department).filter(Boolean))].sort();
  const needle = q.trim().toLowerCase();
  const rows = w.subjects.filter((s) => (dept === 'all' || s.department === dept) && (!needle || `${s.code} ${s.name}`.toLowerCase().includes(needle)));
  const uses = (id: string) => w.schedules.filter((x) => x.subject_id === id).length;

  return (
    <>
      <PageHeader
        title="Subject Management"
        subtitle="Courses that can be scheduled for a section."
        actions={
          <button className="btn btn-primary" onClick={() => setEdit({ units: 3, department: '', description: '' })}>
            <Icon name="plus" size={16} /> Add subject
          </button>
        }
      />
      <div className="filters">
        <input className="input" placeholder="Search code or name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search subjects" />
        <select className="select" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
          <option value="all">All departments</option>
          {depts.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </div>
      <div className="card">
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Subject name</th>
                  <th>Department</th>
                  <th className="num">Units</th>
                  <th className="num">Scheduled classes</th>
                  <th className="num" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <b>{s.code}</b>
                    </td>
                    <td>{s.name}</td>
                    <td>{s.department || '—'}</td>
                    <td className="num">{s.units}</td>
                    <td className="num">{uses(s.id)}</td>
                    <td className="num">
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => setEdit(s)}>
                          Edit
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setDel(s)} aria-label={`Delete ${s.code}`}>
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
          <Empty icon="book" title={needle || dept !== 'all' ? 'No matching subjects' : 'No subjects yet'} body="Add the subjects your departments offer, then schedule them per section." />
        )}
      </div>

      {edit ? (
        <SubjectForm
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
          title={`Delete ${del.code}?`}
          body={uses(del.id) ? `It is used by ${uses(del.id)} scheduled class(es); remove those first.` : 'This subject will be removed permanently.'}
          confirmLabel="Delete subject"
          danger
          onClose={() => setDel(null)}
          onConfirm={async () => {
            await deleteSubject(del.id);
            setDel(null);
            await refresh();
          }}
        />
      ) : null}
    </>
  );
}

function SubjectForm({ value, onClose, onSaved }: { value: Partial<Subject>; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof Subject, x: string | number) => setV((o) => ({ ...o, [k]: x }));
  const save = async () => {
    if (!v.code?.trim() || !v.name?.trim()) return setErr('Enter the subject code and name.');
    setBusy(true);
    setErr(null);
    try {
      await saveSubject({ id: v.id, code: v.code.trim().toUpperCase(), name: v.name.trim(), department: (v.department ?? '').trim(), units: Number(v.units ?? 3), description: (v.description ?? '').trim() });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={v.id ? 'Edit subject' : 'Add subject'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save subject'}
          </button>
        </>
      }>
      <div className="form-grid">
        <Field label="Subject code">
          <input className="input" value={v.code ?? ''} onChange={(e) => set('code', e.target.value)} placeholder="ITEC 116" autoFocus />
        </Field>
        <Field label="Units">
          <input className="input" type="number" min={0} max={12} value={v.units ?? 3} onChange={(e) => set('units', e.target.value)} />
        </Field>
      </div>
      <Field label="Subject name">
        <input className="input" value={v.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="Web Development" />
      </Field>
      <Field label="Department">
        <input className="input" value={v.department ?? ''} onChange={(e) => set('department', e.target.value)} placeholder="Department of Information Technology" />
      </Field>
      {err ? <ErrorNote message={err} /> : null}
    </Modal>
  );
}
