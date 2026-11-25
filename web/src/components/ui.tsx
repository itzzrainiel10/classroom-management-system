import { useEffect, useState, type ReactNode } from 'react';

import type { UserRow } from '../lib/data';
import { initials } from '../lib/format';
import { Icon, type IconName } from './icons';

export function PageHeader({ eyebrow = 'MANAGE', title, subtitle, actions }: { eyebrow?: string; title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="head-actions">{actions}</div> : null}
    </div>
  );
}

export function Tile({ label, value, sub, icon, hero }: { label: string; value: string; sub?: string; icon: IconName; hero?: boolean }) {
  return (
    <div className={`card tile${hero ? ' hero' : ''}`}>
      <div className="label">
        <span className="ic">
          <Icon name={icon} size={15} />
        </span>
        {label}
      </div>
      <div className="value">{value}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

export function CardHead({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="card-head">
      <div>
        <h2>{title}</h2>
        {sub ? <p>{sub}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function Avatar({ name, lg }: { name: string; lg?: boolean }) {
  return <span className={`avatar${lg ? ' lg' : ''}`}>{initials(name)}</span>;
}

export function Person({ name, sub }: { name: string; sub?: string }) {
  return (
    <div className="person">
      <Avatar name={name} />
      <div style={{ minWidth: 0 }}>
        <b>{name}</b>
        {sub ? <small>{sub}</small> : null}
      </div>
    </div>
  );
}

export function RoleChip({ role, isAdmin }: { role: UserRow['role']; isAdmin?: boolean }) {
  if (role === 'admin' || (role === 'none' && isAdmin)) return <span className="role-chip admin">Admin</span>;
  if (role === 'none') return <span className="role-chip">No role</span>;
  return <span className={`role-chip ${role}`}>{role === 'instructor' ? 'Instructor' : 'Student'}</span>;
}

export function StatusBadge({ status }: { status: UserRow['status'] }) {
  const tone = status === 'Active' ? 'green' : status === 'Invited' ? 'gold' : 'red';
  return <span className={`badge ${tone}`}>{status}</span>;
}

export function Empty({ icon, title, body, children }: { icon: IconName; title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ic">
        <Icon name={icon} size={22} />
      </div>
      <b>{title}</b>
      {body ? <p>{body}</p> : null}
      {children ? <div style={{ marginTop: 14 }}>{children}</div> : null}
    </div>
  );
}

export function Loading() {
  return (
    <div className="loading">
      <div className="spinner" />
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="note red">
      <Icon name="alert" />
      <div>{message}</div>
    </div>
  );
}

export function Modal({ title, sub, onClose, children, footer }: { title: string; sub?: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          {sub ? <p>{sub}</p> : null}
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">{footer}</div>
      </div>
    </div>
  );
}

/** "✓ Done" confirmation shown after a change is saved. */
export function Success({ title, body, onDone }: { title: string; body: string; onDone: () => void }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onDone()}>
      <div className="modal success" role="dialog" aria-modal="true" aria-label={title}>
        <div className="check">
          <Icon name="check" size={26} strokeWidth={2.5} />
        </div>
        <h3>{title}</h3>
        <p>{body}</p>
        <button className="btn btn-primary btn-block" onClick={onDone} autoFocus>
          Done
        </button>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

/** Confirmation for important actions (approve, reject, delete). Shows the server's error if it fails. */
export function Confirm({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal
      title={title}
      sub={body}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await onConfirm();
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
                setBusy(false);
              }
            }}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }>
      {children}
      {err ? <ErrorNote message={err} /> : null}
    </Modal>
  );
}
