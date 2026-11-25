import { useState } from 'react';

import { Icon } from '../components/icons';
import { useWorkspace } from '../layouts/AdminLayout';
import { Confirm, Empty, ErrorNote, Field, Modal, PageHeader, Person, Success } from '../components/ui';
import { fetchVerificationHistory, nameOf, proofUrl, reviewInstructor, setInstructorSuspension, useData, type AppStatus, type InstructorProfile } from '../services/data';
import { fmtDateTime } from '../services/format';

const TABS: { id: AppStatus; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'suspended', label: 'Suspended' },
];

export const AppBadge = ({ status }: { status: AppStatus }) => (
  <span className={`badge ${status === 'approved' ? 'green' : status === 'pending' ? 'gold' : status === 'suspended' ? 'gray' : 'red'}`}>{status[0].toUpperCase() + status.slice(1)}</span>
);

export default function Verification() {
  const { w } = useWorkspace();
  const [tab, setTab] = useState<AppStatus>('pending');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const needle = q.trim().toLowerCase();
  const rows = w.instructorProfiles
    .filter((a) => a.status === tab)
    .map((a) => ({ a, p: w.profiles.find((p) => p.id === a.user_id) }))
    .filter(({ a, p }) => !needle || [p?.full_name, p?.email, a.employee_id, a.department].some((x) => (x ?? '').toLowerCase().includes(needle)));
  const count = (s: AppStatus) => w.instructorProfiles.filter((a) => a.status === s).length;
  const current = w.instructorProfiles.find((a) => a.user_id === open);

  return (
    <>
      <PageHeader title="Instructor applications" subtitle="Confirm that each instructor applicant is a legitimate CvSU faculty member before they can teach." />
      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} role="tab" aria-selected={tab === t.id}>
                {t.label}
                <span className="n">{count(t.id)}</span>
              </button>
            ))}
          </div>
          <div className="search" style={{ margin: 0, maxWidth: 340 }}>
            <Icon name="search" size={16} />
            <input placeholder="Search name, email, employee ID or department" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search applications" />
          </div>
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Applicant</th>
                  <th>Employee / Faculty ID</th>
                  <th>Department</th>
                  <th>{tab === 'pending' ? 'Submitted' : 'Decided'}</th>
                  <th>Proof</th>
                  <th className="num" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ a, p }) => (
                  <tr key={a.user_id}>
                    <td>
                      <Person name={p?.full_name || p?.email || 'Unknown'} sub={p?.email} />
                    </td>
                    <td>{a.employee_id || <span style={{ color: 'var(--danger)' }}>Missing</span>}</td>
                    <td>{a.department || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {tab === 'pending' ? fmtDateTime(a.submitted_at) : `${fmtDateTime(a.reviewed_at)}`}
                      {tab !== 'pending' && a.reviewed_by ? <div style={{ color: 'var(--text-soft)', fontSize: 12 }}>by {nameOf(w, a.reviewed_by)}</div> : null}
                    </td>
                    <td>{a.proof_path ? <span className="badge green">Attached</span> : <span className="badge gray">None</span>}</td>
                    <td className="num">
                      <button className={`btn btn-sm ${tab === 'pending' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setOpen(a.user_id)}>
                        {tab === 'pending' ? 'Review' : 'View'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={tab === 'pending' ? 'checkCircle' : 'users'}
            title={tab === 'pending' ? 'No applications waiting' : `No ${tab} applications`}
            body={tab === 'pending' ? 'People who register as Instructor (Instructor Portal or mobile app) appear here.' : undefined}
          />
        )}
      </div>
      {current ? <ReviewDialog app={current} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function ReviewDialog({ app, onClose }: { app: InstructorProfile; onClose: () => void }) {
  const { w, refresh } = useWorkspace();
  const p = w.profiles.find((x) => x.id === app.user_id);
  const name = p?.full_name || p?.email || 'this applicant';
  const history = useData(() => fetchVerificationHistory(app.user_id), [app.user_id]);
  const [reason, setReason] = useState(app.rejection_reason);
  const [confirm, setConfirm] = useState<'approve' | 'reject' | 'suspend' | 'reactivate' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ title: string; body: string } | null>(null);

  const openProof = async () => {
    try {
      window.open(await proofUrl(app.proof_path!), '_blank', 'noopener');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  if (done) return <Success title={done.title} body={done.body} onDone={onClose} />;
  if (confirm === 'suspend' || confirm === 'reactivate') {
    const suspend = confirm === 'suspend';
    return (
      <Confirm
        title={suspend ? `Suspend ${name}?` : `Reactivate ${name}?`}
        body={
          suspend
            ? 'They keep their account, but lose the Instructor Portal, the mobile instructor screens, their classes and schedule until you reactivate them. They are notified with your reason.'
            : 'Their instructor access on the website and the mobile app returns right away, and they are notified.'
        }
        confirmLabel={suspend ? 'Suspend instructor' : 'Reactivate instructor'}
        danger={suspend}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          await setInstructorSuspension(app.user_id, suspend, suspend ? reason : '');
          await refresh();
          setDone(suspend ? { title: 'Instructor suspended', body: `${name} has been notified with your reason.` } : { title: 'Instructor reactivated', body: `${name} can use the Instructor Portal and the mobile app again.` });
        }}>
        {suspend ? (
          <div className="note red">
            <Icon name="info" />
            <div>Reason sent: “{reason.trim()}”</div>
          </div>
        ) : null}
      </Confirm>
    );
  }
  if (confirm) {
    const approve = confirm === 'approve';
    return (
      <Confirm
        title={approve ? `Approve ${name}?` : `Reject ${name}?`}
        body={
          approve
            ? 'They get instructor access in the mobile app right away and are notified.'
            : 'They lose instructor access, are notified with your reason, and can correct and resend their application.'
        }
        confirmLabel={approve ? 'Approve instructor' : 'Reject application'}
        danger={!approve}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          await reviewInstructor(app.user_id, approve, approve ? '' : reason);
          await refresh();
          setDone(
            approve
              ? { title: 'Instructor approved', body: `${name} can now open the instructor dashboard and be assigned to subjects and sections.` }
              : { title: 'Application rejected', body: `${name} has been notified with your reason.` },
          );
        }}>
        {!approve ? (
          <div className="note red">
            <Icon name="info" />
            <div>Reason sent: “{reason.trim()}”</div>
          </div>
        ) : null}
      </Confirm>
    );
  }

  return (
    <Modal
      title={name}
      sub={p?.email}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          {app.status === 'approved' ? (
            <button className="btn btn-danger" onClick={() => (reason.trim() ? setConfirm('suspend') : setErr('Write a reason for the suspension first.'))}>
              Suspend
            </button>
          ) : null}
          {app.status === 'suspended' ? (
            <button className="btn btn-primary" onClick={() => setConfirm('reactivate')}>
              <Icon name="checkCircle" size={16} /> Reactivate
            </button>
          ) : null}
          {app.status === 'pending' || app.status === 'approved' ? (
            <button className="btn btn-danger" onClick={() => (reason.trim() ? setConfirm('reject') : setErr('Write a reason for the rejection first.'))}>
              Reject
            </button>
          ) : null}
          {app.status === 'pending' || app.status === 'rejected' ? (
            <button className="btn btn-primary" onClick={() => setConfirm('approve')} disabled={!app.employee_id || !app.department}>
              <Icon name="checkCircle" size={16} /> Approve
            </button>
          ) : null}
        </>
      }>
      <div className="row" style={{ gap: 8 }}>
        <AppBadge status={app.status} />
        <span style={{ color: 'var(--text-soft)', fontSize: 12.5 }}>Submitted {fmtDateTime(app.submitted_at)}</span>
      </div>
      <div className="detail-grid">
        <div>
          <small>Full name</small>
          <b>{p?.full_name || '—'}</b>
        </div>
        <div>
          <small>Email address</small>
          <b>{p?.email}</b>
        </div>
        <div>
          <small>Employee / Faculty ID</small>
          <b>{app.employee_id || '—'}</b>
        </div>
        <div>
          <small>Department</small>
          <b>{app.department || '—'}</b>
        </div>
        <div>
          <small>Contact number</small>
          <b>{app.contact_number || '—'}</b>
        </div>
        <div>
          <small>Proof of identity</small>
          {app.proof_path ? (
            <button className="link" onClick={() => void openProof()}>
              Open document <Icon name="external" size={13} />
            </button>
          ) : (
            <b>Not provided</b>
          )}
        </div>
      </div>
      {!app.employee_id || !app.department ? (
        <div className="note gold">
          <Icon name="info" />
          <div>The application is incomplete. The applicant can finish it in the mobile app before you approve it.</div>
        </div>
      ) : null}
      {app.status === 'pending' || app.status === 'approved' ? (
        <Field label={app.status === 'approved' ? 'Reason (required to suspend or reject)' : 'Reason (required to reject)'} hint="Shown to the instructor on the website and in the mobile app.">
          <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Employee ID not found in HR records." />
        </Field>
      ) : (
        <div className="note red">
          <Icon name="alert" />
          <div>
            <b>{app.status === 'suspended' ? 'Suspended' : 'Rejected'}:</b> {app.rejection_reason}
          </div>
        </div>
      )}
      {history.data?.length ? (
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: 'var(--muted)', marginBottom: 6 }}>DECISION HISTORY</div>
          {history.data.map((h, i) => (
            <div key={i} style={{ fontSize: 13, padding: '6px 0', borderTop: i ? '1px solid var(--line)' : 0 }}>
              <b style={{ textTransform: 'capitalize' }}>{h.decision}</b> by {nameOf(w, h.decided_by)} · {fmtDateTime(h.decided_at)}
              {h.reason ? <div style={{ color: 'var(--text-soft)' }}>{h.reason}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
      {err ? <ErrorNote message={err} /> : null}
    </Modal>
  );
}
