import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Icon } from '../components/icons';
import { Pager, usePaged } from '../components/pager';
import { useWorkspace } from '../layouts/AdminLayout';
import { Empty, ErrorNote, Field, Loading, Modal, PageHeader, Person, Tile } from '../components/ui';
import { isApprovedInstructor, proofUrl, reviewInstructor, rolesOf, useData, type InstructorProfile, type Profile } from '../services/data';
import { fmtDateTime, fmtNum } from '../services/format';
import { fetchRenewals, reviewRenewal, type Renewal, type RenewalStatus } from '../services/renewals';

type Kind = 'student' | 'instructor';
type Filter = RenewalStatus | 'none';
type Row = { p: Profile; r: Renewal | null; /** New instructor applicant (not approved yet). */ app?: InstructorProfile };

const STATUS_LABEL: Record<Filter, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', none: 'Not yet renewed' };
/** Students renew themselves (no approval); only instructors are approved by the administrator. */
const FILTERS: Record<Kind, Filter[]> = { student: ['approved', 'none'], instructor: ['pending', 'approved', 'rejected', 'none'] };
const labelFor = (k: Kind, f: Filter) => (f === 'approved' ? (k === 'student' ? 'Renewed' : 'Confirmed') : STATUS_LABEL[f]);
const BADGE: Record<Filter, string> = { pending: 'gold', approved: 'green', rejected: 'red', none: 'gray' };

/** /admin/renewals — approve students' enrollment and confirm instructors for the active semester. */
export default function Renewals({ embedded = false, initialKind = 'student' }: { embedded?: boolean; initialKind?: Kind } = {}) {
  const { w, refresh: refreshWorkspace } = useWorkspace();
  const { data, error, loading, refresh } = useData(fetchRenewals);
  const [kind, setKind] = useState<Kind>(initialKind);
  const [filter, setFilter] = useState<Filter>(initialKind === 'instructor' ? 'pending' : 'approved');
  const [q, setQ] = useState('');
  const [acting, setActing] = useState<{ row: Row; approve: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const people = (k: Kind) =>
    w.profiles.filter((p) =>
      k === 'instructor' ? isApprovedInstructor(w, p.id) : rolesOf(w, p.id).includes('student') && !rolesOf(w, p.id).includes('admin'),
    );
  const rowsOf = (k: Kind): Row[] => {
    const base: Row[] = people(k).map((p) => ({ p, r: data?.renewals.find((x) => x.user_id === p.id && x.kind === k) ?? null }));
    if (k !== 'instructor') return base;
    // New instructor applications are approved in the same list as renewals.
    const apps = w.instructorProfiles
      .filter((a) => (a.status === 'pending' || a.status === 'rejected') && !isApprovedInstructor(w, a.user_id))
      .flatMap((a): Row[] => {
        const p = w.profiles.find((x) => x.id === a.user_id);
        return p ? [{ p, r: null, app: a }] : [];
      });
    return [...base, ...apps];
  };
  const statusOf = (row: Row): Filter => (row.app ? (row.app.status as Filter) : (row.r?.status ?? 'none'));
  const submittedOf = (row: Row) => row.r?.submitted_at ?? row.app?.submitted_at ?? null;
  const count = (k: Kind, f: Filter) => rowsOf(k).filter((x) => statusOf(x) === f).length;

  const needle = q.trim().toLowerCase();
  const rows = rowsOf(kind)
    .filter((x) => statusOf(x) === filter)
    .filter((x) => !needle || `${x.p.full_name} ${x.p.email} ${x.p.student_number}`.toLowerCase().includes(needle))
    .sort((a, b) => (submittedOf(b) ?? '').localeCompare(submittedOf(a) ?? '') || a.p.full_name.localeCompare(b.p.full_name));
  const { shown, paging } = usePaged(rows, `${kind}|${filter}|${q}`);

  if (loading && !data) return <Loading />;
  const sem = data?.open ? data : null;

  return (
    <>
      {(() => {
        const sub = sem
          ? `For ${sem.label} · students renew themselves in the app (choosing their section enrolls them); instructors need your approval before they can be given classes.${sem.semester ? '' : ' (No semester is running: requests are for the next one. Create its sections first to enroll students.)'}`
          : 'Renewal opens after the first semester is started on the Semesters page.';
        return embedded ? <p className="sem-lead">{sub}</p> : <PageHeader title="Renewals" subtitle={sub} />;
      })()}
      {error ? <ErrorNote message={error} /> : null}
      {notice ? (
        <div className="note">
          <Icon name="checkCircle" />
          <div>{notice}</div>
        </div>
      ) : null}

      {sem ? (
        <>
          <div className="grid grid-4">
            <Tile hero icon="users" label="Students renewed" value={fmtNum(count('student', 'approved'))} sub="Enrolled in their section" />
            <Tile icon="checkCircle" tone="neutral" label="Students not yet renewed" value={fmtNum(count('student', 'none'))} sub="They renew themselves in the app" />
            <Tile icon="school" tone="warn" label="Instructors waiting" value={fmtNum(count('instructor', 'pending'))} sub={`${count('instructor', 'none')} haven’t confirmed`} />
            <Tile icon="shield" tone="neutral" label="Instructors confirmed" value={fmtNum(count('instructor', 'approved'))} sub="Can be given schedules" />
          </div>

          <div className="filters" style={{ justifyContent: 'space-between' }}>
            <div className="tabs" role="tablist">
              {(['student', 'instructor'] as const).map((k) => (
                <button
                  key={k}
                  className={kind === k ? 'on' : ''}
                  onClick={() => {
                    setKind(k);
                    setFilter(k === 'student' ? 'approved' : 'pending');
                  }}
                  role="tab"
                  aria-selected={kind === k}>
                  {k === 'student' ? 'Students' : 'Instructors'}
                  <Count n={k === 'student' ? count(k, 'approved') : count(k, 'pending')} />
                </button>
              ))}
            </div>
            <div className="search" style={{ margin: 0, flex: '1 1 220px', maxWidth: 300 }}>
              <Icon name="search" size={16} />
              <input placeholder="Search name, email or number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
            </div>
          </div>
          <div className="tabs" role="tablist" style={{ alignSelf: 'flex-start' }}>
            {FILTERS[kind].map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)} role="tab" aria-selected={filter === f}>
                {labelFor(kind, f)}
                <Count n={count(kind, f)} />
              </button>
            ))}
          </div>

          <div className="card">
            {shown.length ? (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      {kind === 'student' ? (
                        <tr>
                          <th>Student</th>
                          <th>Course · Year</th>
                          <th>Section</th>
                          <th>Submitted</th>
                          <th>Status</th>
                          <th className="num" aria-label="Actions" />
                        </tr>
                      ) : (
                        <tr>
                          <th>Instructor</th>
                          <th>Employee ID · Department</th>
                          <th>Contact</th>
                          <th>Submitted</th>
                          <th>Status</th>
                          <th className="num" aria-label="Actions" />
                        </tr>
                      )}
                    </thead>
                    <tbody>
                      {shown.map((row) => {
                        const st = statusOf(row);
                        const ip = w.instructorProfiles.find((x) => x.user_id === row.p.id);
                        return (
                          <tr key={row.p.id}>
                            <td>
                              <Link to={`/admin/users/${row.p.id}`}>
                                <Person name={row.r?.full_name || row.p.full_name || row.p.email} sub={[row.r?.details.student_number || row.p.student_number, row.p.email].filter(Boolean).join(' · ')} />
                              </Link>
                              {kind === 'instructor' && st === 'pending' ? (
                                <span className={`badge ${row.app ? 'gold' : 'gray'}`} style={{ marginTop: 4 }}>
                                  {row.app ? 'New applicant' : 'Renewal'}
                                </span>
                              ) : null}
                            </td>
                            {kind === 'student' ? (
                              <>
                                <td>{row.r ? `${row.r.program || '—'} · Year ${row.r.year_level ?? '—'}` : '—'}</td>
                                <td>
                                  {row.r?.assigned_section_name ? <b>{row.r.assigned_section_name}</b> : row.r?.preferred_section_name ? <span>Wants {row.r.preferred_section_name}</span> : '—'}
                                </td>
                              </>
                            ) : (
                              <>
                                <td>
                                  <b>{row.r?.details.employee_id || ip?.employee_id || '—'}</b>
                                  <div style={{ color: 'var(--text-soft)', fontSize: 'calc(12.5px * var(--text-scale))' }}>{row.r?.details.department || ip?.department || '—'}</div>
                                </td>
                                <td>{row.r?.details.contact_number || ip?.contact_number || '—'}</td>
                              </>
                            )}
                            <td>{submittedOf(row) ? fmtDateTime(submittedOf(row)) : '—'}</td>
                            <td>
                              <span className={`badge ${BADGE[st]}`}>{labelFor(kind, st)}</span>
                              {st === 'rejected' && (row.r?.reason || row.app?.rejection_reason) ? (
                                <div style={{ color: 'var(--text-soft)', fontSize: 'calc(12px * var(--text-scale))' }}>{row.r?.reason || row.app?.rejection_reason}</div>
                              ) : null}
                            </td>
                            <td className="num">
                              <div className="row" style={{ justifyContent: 'flex-end', gap: 6, flexWrap: 'nowrap' }}>
                                {st === 'approved' ? (
                                  kind === 'instructor' ? (
                                    <Link className="btn btn-primary btn-sm" to={`/admin/schedules?instructor=${row.p.id}`}>
                                      Assign classes
                                    </Link>
                                  ) : (
                                    <button className="btn btn-secondary btn-sm" onClick={() => setActing({ row, approve: true })}>
                                      Change section
                                    </button>
                                  )
                                ) : (
                                  <button className="btn btn-primary btn-sm" onClick={() => setActing({ row, approve: true })}>
                                    {kind === 'student' ? (st === 'none' ? 'Enroll' : 'Approve') : row.app ? 'Approve' : 'Confirm'}
                                  </button>
                                )}
                                {st === 'pending' ? (
                                  <button className="btn btn-danger btn-sm" onClick={() => setActing({ row, approve: false })}>
                                    Reject
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pager paging={paging} noun={kind === 'student' ? 'students' : 'instructors'} />
              </>
            ) : (
              <Empty
                icon={kind === 'student' ? 'users' : 'school'}
                title={`No ${labelFor(kind, filter).toLowerCase()} ${kind === 'student' ? 'students' : 'instructors'}`}
                body={kind === 'student' ? 'Students renew in the app by choosing their section; they appear here once renewed.' : filter === 'pending' ? 'Confirm Status requests from the mobile app appear here.' : 'Try another tab.'}
              />
            )}
          </div>
          {kind === 'instructor' ? (
            <p className="sem-lead">
              To suspend or reactivate an instructor, or see application history, open{' '}
              <Link className="link" to="/admin/instructor-records">
                Instructor records
              </Link>
              .
            </p>
          ) : null}
        </>
      ) : null}

      {acting ? (
        <ReviewDialog
          row={acting.row}
          kind={kind}
          approve={acting.approve}
          sections={w.sections}
          onClose={() => setActing(null)}
          onDone={async (msg) => {
            setActing(null);
            await Promise.all([refresh(), refreshWorkspace()]);
            setNotice(msg);
          }}
        />
      ) : null}
    </>
  );
}

function ReviewDialog({
  row,
  kind,
  approve,
  sections,
  onClose,
  onDone,
}: {
  row: Row;
  kind: Kind;
  approve: boolean;
  sections: { id: string; name: string; year_level: number; program?: string | null }[];
  onClose: () => void;
  onDone: (msg: string) => Promise<void>;
}) {
  const name = row.r?.full_name || row.p.full_name || row.p.email;
  const [sectionId, setSectionId] = useState(row.r?.assigned_section_id || row.r?.preferred_section_id || '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const year = row.r?.year_level;
  const list = [...sections].sort((a, b) => (a.year_level === year ? -1 : 0) - (b.year_level === year ? -1 : 0) || a.year_level - b.year_level || a.name.localeCompare(b.name));

  const run = async () => {
    if (approve && kind === 'student' && !sectionId) return setErr('Choose the section to enroll them in.');
    if (!approve && !reason.trim()) return setErr('Give a reason. They will see it.');
    setBusy(true);
    setErr(null);
    try {
      if (row.app) await reviewInstructor(row.p.id, approve, reason.trim());
      else await reviewRenewal(row.p.id, approve, { reason: reason.trim(), sectionId: sectionId || null });
      const sec = sections.find((s) => s.id === sectionId)?.name;
      await onDone(
        approve
          ? kind === 'student'
            ? `${name} is enrolled in ${sec} and has been notified.`
            : row.app
              ? `${name} is approved as an instructor. Assign their subjects and sections in Schedules.`
              : `${name} is confirmed. Assign their subjects and sections in Schedules.`
          : `${name}’s renewal was rejected. They were told why.`,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={approve ? (kind === 'student' ? `Enroll ${name}` : `Confirm ${name}`) : `Reject ${name}’s renewal`}
      sub={
        approve
          ? kind === 'student'
            ? 'They join this semester’s classes for the section you choose.'
            : 'They can then be given subjects and sections for this semester.'
          : 'They can fix their details and send it again.'
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className={`btn ${approve ? 'btn-primary' : 'btn-danger-solid'}`} onClick={() => void run()} disabled={busy}>
            {busy ? 'Saving…' : approve ? (kind === 'student' ? 'Enroll' : 'Confirm') : 'Reject'}
          </button>
        </>
      }>
      {row.r ? (
        <dl className="sem-stats" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
          {kind === 'student' ? (
            <>
              <div>
                <dt>Course</dt>
                <dd style={{ fontSize: 'calc(15px * var(--text-scale))' }}>{row.r.program || '—'}</dd>
              </div>
              <div>
                <dt>Year level</dt>
                <dd style={{ fontSize: 'calc(15px * var(--text-scale))' }}>{row.r.year_level ?? '—'}</dd>
              </div>
              <div>
                <dt>Wants section</dt>
                <dd style={{ fontSize: 'calc(15px * var(--text-scale))' }}>{row.r.preferred_section_name || '—'}</dd>
              </div>
            </>
          ) : (
            <>
              <div>
                <dt>Employee ID</dt>
                <dd style={{ fontSize: 'calc(15px * var(--text-scale))' }}>{row.r.details.employee_id || '—'}</dd>
              </div>
              <div>
                <dt>Department</dt>
                <dd style={{ fontSize: 'calc(15px * var(--text-scale))' }}>{row.r.details.department || '—'}</dd>
              </div>
            </>
          )}
        </dl>
      ) : (
        <p style={{ color: 'var(--text-soft)', marginBottom: 12 }}>They haven’t sent a renewal request. You can still {kind === 'student' ? 'enroll' : 'confirm'} them directly.</p>
      )}
      {row.r?.details.note ? <p style={{ color: 'var(--text-soft)', marginBottom: 12 }}>Note: “{row.r.details.note}”</p> : null}
      {row.app ? (
        <div className="note" style={{ marginBottom: 12 }}>
          <div>
            <b>New instructor applicant.</b> Employee ID {row.app.employee_id || '—'} · {row.app.department || 'No department'} · {row.app.contact_number || 'No contact number'}
            {row.app.proof_path ? (
              <>
                {' · '}
                <button
                  type="button"
                  className="link"
                  onClick={async () => {
                    try {
                      window.open(await proofUrl(row.app!.proof_path!), '_blank', 'noopener');
                    } catch (e) {
                      setErr(e instanceof Error ? e.message : String(e));
                    }
                  }}>
                  View document
                </button>
              </>
            ) : (
              ' · No document uploaded'
            )}
          </div>
        </div>
      ) : null}
      {approve && kind === 'student' ? (
        <Field label="Enroll in section" required>
          <select className="select" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            <option value="">Choose a section…</option>
            {list.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · Year {s.year_level}
                {s.program ? ` · ${s.program}` : ''}
                {s.id === row.r?.preferred_section_id ? ' (requested)' : ''}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {!approve ? (
        <Field label="Reason" required hint="Sent to them as a notification.">
          <textarea className="textarea" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Year level doesn’t match your records — please check with the Registrar" />
        </Field>
      ) : null}
      {err ? <ErrorNote message={err} /> : null}
    </Modal>
  );
}

/** Tab count: hidden while there is nothing yet (no "0"). */
function Count({ n }: { n: number }) {
  return n > 0 ? <span className="n">{n}</span> : null;
}
