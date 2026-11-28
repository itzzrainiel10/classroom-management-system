import { useState } from 'react';

import { Icon } from '../components/icons';
import { useWorkspace } from '../layouts/AdminLayout';
import { ActionIconButton, CardHead, Confirm, Empty, ErrorNote, Field, Modal, PageHeader } from '../components/ui';
import { ROOM_TYPES, deleteRoom, saveRoom, type Room, type RoomType } from '../services/data';

/** /admin/rooms — lecture rooms and laboratories that classes are scheduled in. */
export default function Rooms() {
  const { w, refresh } = useWorkspace();
  const [edit, setEdit] = useState<Partial<Room> | null>(null);
  const [del, setDel] = useState<Room | null>(null);
  const uses = (id: string) => w.schedules.filter((s) => s.room_id === id).length;

  return (
    <>
      <PageHeader title="Rooms" subtitle="Classrooms and laboratories used when scheduling classes." />
      <div className="card">
        <CardHead
          title="Rooms"
          sub={ROOM_TYPES.map((t) => `${w.rooms.filter((r) => (r.room_type ?? 'lecture') === t.value).length} ${t.plural.toLowerCase()}`).join(' · ')}
          right={
            <button className="btn btn-primary btn-sm" onClick={() => setEdit({ building: '', capacity: null, room_type: 'lecture' })}>
              <Icon name="plus" size={14} /> Add room
            </button>
          }
        />
        {w.rooms.length ? (
          ROOM_TYPES.map((t) => {
            const list = w.rooms.filter((r) => (r.room_type ?? 'lecture') === t.value);
            return (
          <div key={t.value} className="list">
            <div className="list-group">
              {t.plural} <span>({list.length})</span>
            </div>
            {!list.length ? <div className="list-item"><small>No {t.plural.toLowerCase()} yet.</small></div> : null}
            {list.map((r) => (
              <div key={r.id} className="list-item">
                <span className={`ic${r.room_type === 'laboratory' ? ' gold' : ''}`}>
                  <Icon name={r.room_type === 'laboratory' ? 'clipboard' : 'home'} size={16} />
                </span>
                <div className="grow">
                  <b>{r.name}</b>
                  <small>
                    {[r.building, r.capacity ? `${r.capacity} seats` : '', `${uses(r.id)} class${uses(r.id) === 1 ? '' : 'es'}`].filter(Boolean).join(' · ')}
                  </small>
                </div>
                <ActionIconButton action="edit" label={`Edit ${r.name}`} onClick={() => setEdit(r)} />
                <ActionIconButton action="delete" label={`Delete ${r.name}`} onClick={() => setDel(r)} />
              </div>
            ))}
          </div>
            );
          })
        ) : (
          <Empty icon="home" title="No rooms yet" body="Add classrooms and laboratories so classes can be scheduled in them." />
        )}
      </div>

    {edit ? (
      <RoomForm
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
        body={uses(del.id) ? `It is used by ${uses(del.id)} class(es). Move those classes to another room first.` : 'This room will be removed.'}
        confirmLabel="Delete room"
        danger
        onClose={() => setDel(null)}
        onConfirm={async () => {
          await deleteRoom(del.id);
          setDel(null);
          await refresh();
        }}
      />
    ) : null}
    </>
  );
}

function RoomForm({ value, onClose, onSaved }: { value: Partial<Room>; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!v.name?.trim()) return setErr('Enter the room name or number.');
    setBusy(true);
    setErr(null);
    try {
      await saveRoom({ id: v.id, name: v.name.trim(), building: (v.building ?? '').trim(), capacity: v.capacity ? Number(v.capacity) : null, room_type: v.room_type ?? 'lecture' });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={v.id ? 'Edit room' : 'Add room'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save room'}
          </button>
        </>
      }>
      <div className="field">
        <span>Room type</span>
        <div className="radio-cards">
          {ROOM_TYPES.map((t) => (
            <label key={t.value} className={(v.room_type ?? 'lecture') === t.value ? 'on' : ''}>
              <input type="radio" name="room_type" checked={(v.room_type ?? 'lecture') === t.value} onChange={() => setV({ ...v, room_type: t.value as RoomType })} />
              <div>
                <b>{t.label}</b>
                <small>{t.value === 'lecture' ? 'Regular classroom for lectures' : 'Computer, science or other lab'}</small>
              </div>
            </label>
          ))}
        </div>
      </div>
      <Field label="Room name / number">
        <input className="input" value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Computer Laboratory 03" autoFocus />
      </Field>
      <div className="form-grid">
        <Field label="Building">
          <input className="input" value={v.building ?? ''} onChange={(e) => setV({ ...v, building: e.target.value })} placeholder="CEIT Building" />
        </Field>
        <Field label="Capacity">
          <input className="input" type="number" min={1} value={v.capacity ?? ''} onChange={(e) => setV({ ...v, capacity: e.target.value ? Number(e.target.value) : null })} placeholder="40" />
        </Field>
      </div>
      {err ? <ErrorNote message={err} /> : null}
    </Modal>
  );
}
