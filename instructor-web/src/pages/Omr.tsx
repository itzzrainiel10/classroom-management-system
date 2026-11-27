import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { Icon } from '../components/icons';
import { Pager, usePaged } from '../components/pager';
import { toast } from '../components/toast';
import { CardHead, Confirm, Empty, ErrorNote, Field, Loading, Modal, PageHeader, Tile } from '../components/ui';
import { useData } from '../hooks/useData';
import { fmtDateTime, fmtNum } from '../services/format';
import {
  LETTERS,
  MAX_UPLOAD_MB,
  STATUS_LABEL,
  bubbleCenter,
  deleteScan,
  fetchLayout,
  fetchOmrExams,
  fetchScans,
  fetchSheets,
  finalizeScan,
  imageUrl,
  preparePages,
  reprocess,
  saveReview,
  uploadAndProcess,
  type LayoutQuestion,
  type OmrExam,
  type PreparedPage,
  type Scan,
  type Sheet,
} from '../services/omr';

type Tab = 'print' | 'upload' | 'results';

/** OMR Management: print sheets → upload scanner files → review → finalize. Phone scans appear here too. */
export default function Omr() {
  const exams = useData(fetchOmrExams);
  const [params, setParams] = useSearchParams();
  const examId = params.get('exam') ?? '';
  const tab = (params.get('tab') as Tab) || 'upload';
  const go = (p: Record<string, string>) => setParams({ exam: examId, tab, ...p }, { replace: true });

  useEffect(() => {
    if (exams.data?.length && !exams.data.some((e) => e.id === examId)) setParams({ exam: exams.data[0].id, tab }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exams.data]);

  const exam = exams.data?.find((e) => e.id === examId) ?? null;
  const layout = useData(() => (exam ? fetchLayout(exam.id) : Promise.resolve([] as LayoutQuestion[])), [exam?.id]);
  const sheets = useData(() => (exam ? fetchSheets(exam.id) : Promise.resolve([] as Sheet[])), [exam?.id]);
  const scans = useData(() => (exam ? fetchScans(exam.id) : Promise.resolve([] as Scan[])), [exam?.id]);

  // Keep results in sync with phone scans / other tabs.
  useEffect(() => {
    if (!exam) return;
    const t = setInterval(() => void scans.refresh(), 8000);
    return () => clearInterval(t);
  }, [exam, scans]);

  if (exams.error) return <ErrorNote message={exams.error} />;
  if (!exams.data) return <Loading />;

  const list = scans.data ?? [];
  const graded = list.filter((s) => s.status === 'finalized').length;
  const review = list.filter((s) => s.status === 'needs_review' || s.status === 'ready').length;
  const failed = list.filter((s) => s.status === 'failed').length;

  return (
    <>
      <PageHeader title="OMR Management" subtitle="Grade paper answer sheets from a scanner (here) or the phone camera (mobile app → OMR Scanner). Both use the same reader and grading." />
      {!exams.data.length ? (
        <div className="card">
          <Empty icon="clipboard" title="No exams yet" body="Create a multiple-choice or True/False quiz or exam first.">
            <Link to="/quizzes/new" className="btn btn-primary">
              Create quiz / exam
            </Link>
          </Empty>
        </div>
      ) : (
        <>
          <div className="card card-pad">
            <Field label="Examination">
              <select className="select" value={examId} onChange={(e) => setParams({ exam: e.target.value, tab }, { replace: true })}>
                {exams.data.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title} · {e.class ? `${e.class.code} ${e.class.section}` : ''} {e.status === 'draft' ? '(draft)' : ''}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {layout.error ? (
            <div className="note gold">
              <Icon name="alert" />
              <div>
                <b>This exam can’t be done on paper.</b> {layout.error}
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-4">
                <Tile icon="users" label="Answer sheets printed" value={fmtNum(sheets.data?.length ?? 0)} sub={`${layout.data?.length ?? 0} questions each`} />
                <Tile icon="checkCircle" tone="ok" label="Graded" value={fmtNum(graded)} sub="Scores saved" />
                <Tile icon="alert" tone="warn" label="To review" value={fmtNum(review)} sub="Check, then finalize" />
                <Tile icon="x" tone="neutral" label="Could not read" value={fmtNum(failed)} sub="Rescan these" />
              </div>
              <div className="tabs" role="tablist">
                {(
                  [
                    ['print', 'Print answer sheets'],
                    ['upload', 'Scanner upload'],
                    ['results', `Results & review (${list.length})`],
                  ] as [Tab, string][]
                ).map(([t, label]) => (
                  <button key={t} className={tab === t ? 'on' : ''} onClick={() => go({ tab: t })} role="tab" aria-selected={tab === t}>
                    {label}
                  </button>
                ))}
              </div>
              {exam && tab === 'print' ? <PrintTab exam={exam} sheets={sheets.data ?? []} /> : null}
              {exam && tab === 'upload' ? (
                <UploadTab
                  exam={exam}
                  onDone={async () => {
                    await Promise.all([scans.refresh(), sheets.refresh()]);
                  }}
                  openResults={() => go({ tab: 'results' })}
                />
              ) : null}
              {exam && tab === 'results' && layout.data ? (
                <ResultsTab layout={layout.data} sheets={sheets.data ?? []} scans={list} loading={!scans.data} refresh={scans.refresh} />
              ) : null}
            </>
          )}
        </>
      )}
    </>
  );
}

/* ---------------- Print ---------------- */
function PrintTab({ exam, sheets }: { exam: OmrExam; sheets: Sheet[] }) {
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="row row-wrap" style={{ justifyContent: 'space-between' }}>
        <div>
          <b>One personalised sheet per enrolled student.</b>
          <div style={{ color: 'var(--text-soft)' }}>Each sheet has the student’s name and a QR code, so scanned sheets are matched to the right student automatically.</div>
        </div>
        <Link to={`/omr/print/${exam.id}`} className="btn btn-primary">
          <Icon name="download" size={16} /> Open printable sheets
        </Link>
      </div>
      <div className="note">
        <Icon name="info" />
        <div>
          Print on A4 at 100 % scale. Students shade one bubble completely with a dark pencil or pen. Keep the four black corner squares and the QR code clean. {sheets.length ? `${sheets.length} sheets prepared so far.` : ''}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Scanner upload ---------------- */
type QueueItem = { key: string; page: PreparedPage; state: 'ready' | 'uploading' | 'processing' | 'done' | 'error'; scan?: Scan; error?: string };

function UploadTab({ exam, onDone, openResults }: { exam: OmrExam; onDone: () => Promise<void>; openResults: () => void }) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(0);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    setErr(null);
    const arr = Array.from(files);
    const bad = arr.find((f) => !/\.(jpe?g|png|pdf)$/i.test(f.name));
    if (bad) return setErr(`${bad.name}: only JPG, JPEG, PNG and PDF files are supported.`);
    const big = arr.find((f) => f.size > MAX_UPLOAD_MB * 1048576);
    if (big) return setErr(`${big.name} is larger than ${MAX_UPLOAD_MB} MB.`);
    setReading((n) => n + arr.length);
    for (const f of arr) {
      try {
        const pages = await preparePages(f);
        setQueue((q) => [...q, ...pages.map((page) => ({ key: crypto.randomUUID(), page, state: 'ready' as const }))]);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setReading((n) => n - 1);
      }
    }
  }, []);

  const update = (key: string, patch: Partial<QueueItem>) => setQueue((q) => q.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  const processAll = async () => {
    setBusy(true);
    const todo = queue.filter((it) => it.state === 'ready' || it.state === 'error');
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const it = todo[i++];
        try {
          const scan = await uploadAndProcess(exam, it.page, 'physical_scanner', (s) => update(it.key, { state: s, error: undefined }));
          update(it.key, { state: 'done', scan });
        } catch (e) {
          update(it.key, { state: 'error', error: e instanceof Error ? e.message : String(e) });
        }
      }
    };
    await Promise.all([worker(), worker()]); // two at a time
    setBusy(false);
    await onDone();
    toast.success('Scanning finished', 'Open Results & review to check and finalize the sheets.');
  };

  const counts = useMemo(() => {
    const c = { ready: 0, done: 0, error: 0 };
    for (const it of queue) {
      if (it.state === 'ready') c.ready++;
      if (it.state === 'done') c.done++;
      if (it.state === 'error' || it.scan?.status === 'failed') c.error++;
    }
    return c;
  }, [queue]);

  return (
    <div className="card">
      <CardHead
        title="Scanner upload"
        sub="Upload scans from a flatbed or document scanner: JPG, PNG, or multi-page PDF (one answer sheet per page)."
        right={
          queue.length ? (
            <div className="row">
              <button className="btn btn-ghost btn-sm" onClick={() => setQueue([])} disabled={busy}>
                Clear
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => void processAll()} disabled={busy || !queue.some((q) => q.state === 'ready' || q.state === 'error')}>
                {busy ? 'Processing…' : `Process ${queue.filter((q) => q.state === 'ready' || q.state === 'error').length} sheet(s)`}
              </button>
            </div>
          ) : null
        }
      />
      <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div
          className={`dropzone${drag ? ' on' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void addFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}>
          <Icon name="download" size={26} />
          <b>Drag scanned answer sheets here, or click to choose files</b>
          <small>JPG · PNG · PDF (multi-page) · up to {MAX_UPLOAD_MB} MB per file · scan at 150–300 dpi, grayscale or color</small>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        {reading ? (
          <div className="note">
            <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
            <div>Reading {reading} file(s)… (PDF pages are converted to images)</div>
          </div>
        ) : null}
        {err ? <ErrorNote message={err} /> : null}
        {queue.length ? (
          <>
            <div className="row" style={{ justifyContent: 'space-between', color: 'var(--text-soft)', fontSize: 'calc(13px * var(--text-scale))' }}>
              <span>
                {queue.length} page(s) · {counts.ready} waiting · {counts.done} processed{counts.error ? ` · ${counts.error} need attention` : ''}
              </span>
              {counts.done ? (
                <button className="link" onClick={openResults}>
                  Go to Results & review →
                </button>
              ) : null}
            </div>
            <div className="scan-grid">
              {queue.map((it) => {
                const st = it.scan ? STATUS_LABEL[it.scan.status] : null;
                return (
                  <div key={it.key} className="scan-card">
                    <img src={it.page.preview} alt={it.page.name} />
                    <div className="scan-meta">
                      <b title={it.page.name}>{it.page.name}</b>
                      <small>
                        {it.page.width}×{it.page.height}px
                      </small>
                      {it.state === 'ready' ? <span className="badge gray">Waiting</span> : null}
                      {it.state === 'uploading' ? <span className="badge gray">Uploading…</span> : null}
                      {it.state === 'processing' ? <span className="badge gray">Reading bubbles…</span> : null}
                      {it.state === 'error' ? <span className="badge red">Error</span> : null}
                      {st ? <span className={`badge ${st.tone}`}>{st.label}</span> : null}
                      {it.error || (it.scan && it.scan.status === 'failed') || it.scan?.status === 'duplicate' ? <small className="scan-msg">{it.error ?? it.scan?.message}</small> : null}
                    </div>
                    {it.state === 'ready' || it.state === 'error' ? (
                      <button className="scan-x" onClick={() => setQueue((q) => q.filter((x) => x.key !== it.key))} aria-label={`Remove ${it.page.name}`} disabled={busy}>
                        <Icon name="x" size={14} />
                      </button>
                    ) : null}
                    {it.state === 'uploading' || it.state === 'processing' ? <div className="scan-progress" /> : null}
                  </div>
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------- Results & review ---------------- */
function ResultsTab({ layout, sheets, scans, loading, refresh }: { layout: LayoutQuestion[]; sheets: Sheet[]; scans: Scan[]; loading: boolean; refresh: () => Promise<void> }) {
  const [filter, setFilter] = useState<'all' | 'review' | 'finalized' | 'failed'>('all');
  const [open, setOpen] = useState<Scan | null>(null);
  const [del, setDel] = useState<Scan | null>(null);
  const sheetOf = (id: string | null) => sheets.find((s) => s.id === id);
  const rows = scans.filter((s) =>
    filter === 'all' ? true : filter === 'review' ? s.status === 'needs_review' || s.status === 'ready' : filter === 'finalized' ? s.status === 'finalized' : s.status === 'failed' || s.status === 'duplicate',
  );
  const notScanned = sheets.filter((sh) => !scans.some((s) => s.sheet_id === sh.id && s.status !== 'failed' && s.status !== 'duplicate'));
  const { shown: pageRows, paging } = usePaged(rows, filter);

  return (
    <div className="card">
      <CardHead
        title="Results & review"
        sub="Scanner uploads and phone photos for this exam. Updates automatically."
        right={
          <div className="view-toggle">
            {(
              [
                ['all', 'All'],
                ['review', 'To review'],
                ['finalized', 'Graded'],
                ['failed', 'Problems'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
                {l}
              </button>
            ))}
          </div>
        }
      />
      {loading ? (
        <div className="card-pad">
          <Loading />
        </div>
      ) : rows.length ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th className="num">Answers read</th>
                  <th className="num">Confidence</th>
                  <th className="num">Score</th>
                  <th>Scanned</th>
                  <th className="num" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((s) => {
                  const sh = sheetOf(s.sheet_id);
                  const st = STATUS_LABEL[s.status];
                  const problems = s.detected.filter((d) => d.status === 'multiple' || d.status === 'uncertain').length;
                  const unresolved = s.answers.filter((a) => a === null).length;
                  return (
                    <tr key={s.id}>
                      <td>
                        <b>{sh ? sh.student_name || sh.student_email : <span style={{ color: 'var(--danger)' }}>Unknown student</span>}</b>
                        <small style={{ display: 'block', color: 'var(--text-soft)' }}>{sh?.student_email ?? s.original_name}</small>
                      </td>
                      <td>{s.source === 'mobile_camera' ? 'Phone camera' : 'Scanner'}</td>
                      <td>
                        <span className={`badge ${st.tone}`}>{st.label}</span>
                        {s.status === 'failed' || s.status === 'duplicate' ? <small style={{ display: 'block', color: 'var(--text-soft)', maxWidth: 260 }}>{s.message}</small> : null}
                      </td>
                      <td className="num">{s.detected.length ? `${s.detected.length - problems}/${s.detected.length}${unresolved ? ` · ${unresolved} to check` : ''}` : '—'}</td>
                      <td className="num">{s.confidence == null ? '—' : `${Math.round(s.confidence * 100)}%`}</td>
                      <td className="num">{s.status === 'finalized' ? `${s.score}/${s.total}` : '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(s.created_at)}</td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>
                        {s.status === 'needs_review' || s.status === 'ready' || s.status === 'finalized' ? (
                          <button className={`btn btn-sm ${s.status === 'finalized' ? 'btn-secondary' : 'btn-primary'}`} onClick={() => setOpen(s)}>
                            {s.status === 'finalized' ? 'View' : 'Review'}
                          </button>
                        ) : null}
                        {s.status !== 'finalized' ? (
                          <button className="btn btn-ghost btn-sm" onClick={() => setDel(s)} aria-label="Delete scan">
                            <Icon name="trash" size={14} />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager paging={paging} noun="scans" />
        </>
      ) : (
        <Empty icon="clipboard" title="No scans here yet" body="Upload scanner files, or scan with the phone camera in the mobile app." />
      )}
      {notScanned.length && filter === 'all' ? (
        <div className="table-foot">
          <span>
            Not scanned yet ({notScanned.length}): {notScanned.slice(0, 8).map((s) => s.student_name || s.student_email).join(', ')}
            {notScanned.length > 8 ? '…' : ''}
          </span>
        </div>
      ) : null}
      {open ? (
        <ReviewModal
          scan={open}
          layout={layout}
          sheets={sheets}
          onClose={() => setOpen(null)}
          onChanged={async () => {
            await refresh();
          }}
        />
      ) : null}
      {del ? (
        <Confirm
          title="Delete this scan?"
          body="The uploaded image and its detected answers will be removed. Scores already graded are not affected."
          confirmLabel="Delete scan"
          danger
          onClose={() => setDel(null)}
          onConfirm={async () => {
            await deleteScan(del);
            setDel(null);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

const STATUS_TEXT: Record<string, string> = { answered: 'Read', blank: 'Blank', multiple: 'Multiple marks', uncertain: 'Unclear' };

function ReviewModal({ scan, layout, sheets, onClose, onChanged }: { scan: Scan; layout: LayoutQuestion[]; sheets: Sheet[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [answers, setAnswers] = useState<(number | null)[]>(() => (scan.answers.length === layout.length ? [...scan.answers] : layout.map(() => null)));
  const [sheetId, setSheetId] = useState<string>(scan.sheet_id ?? '');
  const [img, setImg] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'final' | 'rerun' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const done = scan.status === 'finalized';

  useEffect(() => {
    const p = scan.processed_path ?? scan.image_path;
    imageUrl(p).then(setImg).catch(() => setImg(null));
  }, [scan]);

  const unresolved = answers.filter((a) => a === null).length;
  const canFinalize = !done && unresolved === 0 && !!sheetId;

  const save = async () => {
    setBusy('save');
    setErr(null);
    try {
      const s = await saveReview(scan.id, answers, sheetId || null);
      await onChanged();
      toast.success('Review saved', s.status === 'ready' ? 'Ready to finalize.' : `${answers.filter((a) => a === null).length} answer(s) still need a decision.`);
      return s;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const finalize = async () => {
    setErr(null);
    const s = await save();
    if (!s) return;
    setBusy('final');
    try {
      const f = await finalizeScan(scan.id);
      toast.success('Answer sheet graded', `Score ${f.score}/${f.total}. The student sees it in the mobile app.`);
      await onChanged();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      title={done ? 'Graded answer sheet' : 'Review answer sheet'}
      sub={`${scan.source === 'mobile_camera' ? 'Phone camera' : 'Scanner'} · ${fmtDateTime(scan.created_at)}${done ? ` · Score ${scan.score}/${scan.total}` : ''}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          {!done ? (
            <>
              <button
                className="btn btn-secondary"
                disabled={!!busy}
                onClick={async () => {
                  setBusy('rerun');
                  try {
                    await reprocess(scan.id);
                    await onChanged();
                    onClose();
                  } catch (e) {
                    setErr(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(null);
                  }
                }}>
                Read again
              </button>
              <button className="btn btn-secondary" disabled={!!busy} onClick={() => void save()}>
                {busy === 'save' ? 'Saving…' : 'Save review'}
              </button>
              <button className="btn btn-primary" disabled={!!busy || !canFinalize} onClick={() => void finalize()} title={canFinalize ? '' : 'Resolve every unclear answer and choose the student first'}>
                {busy === 'final' ? 'Grading…' : 'Confirm & finalize'}
              </button>
            </>
          ) : null}
        </>
      }>
      <div className="review-wrap">
        <div className="review-img">
          {img ? (
            <div className="review-sheet">
              <img src={img} alt="Scanned answer sheet" />
              {scan.processed_path
                ? layout.map((q, i) =>
                    Array.from({ length: q.choices }, (_, c) => {
                      const [x, y] = bubbleCenter(i, c);
                      const a = answers[i];
                      const det = scan.detected[i];
                      const cls = a === c ? 'pick' : det && det.fills[c] >= 0.2 ? 'faint' : '';
                      return cls ? <span key={`${i}-${c}`} className={`review-dot ${cls}`} style={{ left: `${(x / 210) * 100}%`, top: `${(y / 297) * 100}%` }} /> : null;
                    }),
                  )
                : null}
            </div>
          ) : (
            <Loading rows={2} />
          )}
        </div>
        <div className="review-side">
          <Field label="Student" required>
            <select className="select" value={sheetId} onChange={(e) => setSheetId(e.target.value)} disabled={done}>
              <option value="">— Choose the student —</option>
              {sheets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.student_name || s.student_email} ({s.student_email})
                </option>
              ))}
            </select>
          </Field>
          {scan.issues.filter((i) => !i.blocking).map((i) => (
            <div key={i.code} className="note gold" style={{ fontSize: 'calc(12.5px * var(--text-scale))' }}>
              <Icon name="alert" />
              <div>{i.message}</div>
            </div>
          ))}
          <div className="row" style={{ justifyContent: 'space-between', fontSize: 'calc(13px * var(--text-scale))' }}>
            <span>
              <b>{layout.length - unresolved}</b>/{layout.length} decided
            </span>
            {unresolved ? <span className="badge gold">{unresolved} need your decision</span> : <span className="badge green">All decided</span>}
          </div>
          <div className="review-list">
            {layout.map((q, i) => {
              const det = scan.detected[i];
              const a = answers[i];
              const flagged = det && (det.status === 'multiple' || det.status === 'uncertain');
              return (
                <div key={i} className={`review-q${a === null ? ' open' : ''}${flagged ? ' flagged' : ''}`}>
                  <span className="review-n">{i + 1}</span>
                  <div className="review-opts">
                    {Array.from({ length: q.choices }, (_, c) => (
                      <button
                        key={c}
                        type="button"
                        disabled={done}
                        className={a === c ? 'on' : ''}
                        title={det ? `Fill ${Math.round((det.fills[c] ?? 0) * 100)}%` : ''}
                        onClick={() => setAnswers(answers.map((x, j) => (j === i ? c : x)))}>
                        {q.type === 'true_false' ? (c === 0 ? 'T' : 'F') : LETTERS[c]}
                      </button>
                    ))}
                    <button type="button" disabled={done} className={a === -1 ? 'on blank' : 'blank'} onClick={() => setAnswers(answers.map((x, j) => (j === i ? -1 : x)))}>
                      Blank
                    </button>
                  </div>
                  <span className={`review-st ${det?.status ?? ''}`}>
                    {det ? STATUS_TEXT[det.status] : '—'}
                    {det && det.status === 'answered' ? ` ${Math.round(det.confidence * 100)}%` : ''}
                  </span>
                </div>
              );
            })}
          </div>
          {err ? <ErrorNote message={err} /> : null}
        </div>
      </div>
    </Modal>
  );
}
