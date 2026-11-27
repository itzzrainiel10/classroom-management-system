import { CardHead, Empty, Loading, Tile } from '../components/ui';
import { Pager, usePaged } from '../components/pager';
import { useWorkspace } from '../layouts/AdminLayout';
import { classLabel, nameOf, useData, type ClassRow } from '../services/data';
import { fmtNum } from '../services/format';
import { supabase } from '../services/supabase';

type ScanRow = { id: string; quiz_id: string; class_id: string; source: 'physical_scanner' | 'mobile_camera'; status: string; score: number | null; total: number | null; created_at: string; issues: { code: string; blocking: boolean }[] };

async function fetchOmr() {
  const [scans, sheets] = await Promise.all([
    supabase.from('omr_scans').select('id, quiz_id, class_id, source, status, score, total, created_at, issues'),
    supabase.from('omr_sheets').select('quiz_id'),
  ]);
  if (scans.error) throw new Error(scans.error.message);
  if (sheets.error) throw new Error(sheets.error.message);
  return { scans: scans.data as ScanRow[], sheets: sheets.data as { quiz_id: string }[] };
}

/** OMR (paper answer sheet) activity for the Reports page: scanner vs phone, outcomes, per exam. */
export function OmrReport({ classes, since }: { classes: ClassRow[]; since: Date }) {
  const { w } = useWorkspace();
  const { data, error } = useData(fetchOmr);
  const ids = new Set(classes.map((c) => c.id));
  const scans = (data?.scans ?? []).filter((s) => ids.has(s.class_id) && new Date(s.created_at) >= since);
  const graded = scans.filter((s) => s.status === 'finalized');
  const failed = scans.filter((s) => s.status === 'failed');
  const review = scans.filter((s) => s.status === 'needs_review' || s.status === 'ready');
  const bySource = (src: ScanRow['source']) => scans.filter((s) => s.source === src).length;
  const reasons = new Map<string, number>();
  for (const s of failed) for (const i of s.issues.filter((x) => x.blocking)) reasons.set(i.code, (reasons.get(i.code) ?? 0) + 1);
  const REASON: Record<string, string> = { blurry: 'Too blurry', too_dark: 'Too dark', low_contrast: 'Too dark / faded', shadow: 'Shadows', glare: 'Glare', cropped: 'Cropped', markers_missing: 'Markers not found', perspective: 'Strong angle', low_resolution: 'Low resolution', too_small: 'Sheet too small', not_a_sheet: 'Not a CMS sheet' };

  const exams = [...new Set(scans.map((s) => s.quiz_id))].map((qid) => {
    const quiz = w.quizzes.find((q) => q.id === qid);
    const cls = classes.find((c) => c.id === quiz?.class_id);
    const mine = scans.filter((s) => s.quiz_id === qid);
    const done = mine.filter((s) => s.status === 'finalized');
    const avg = done.length ? Math.round((done.reduce((n, s) => n + (s.total ? (s.score ?? 0) / s.total : 0), 0) / done.length) * 100) : null;
    return { qid, title: quiz?.title ?? 'Exam', cls, printed: (data?.sheets ?? []).filter((s) => s.quiz_id === qid).length, scans: mine.length, done: done.length, review: mine.filter((s) => s.status === 'needs_review' || s.status === 'ready').length, failed: mine.filter((s) => s.status === 'failed').length, avg };
  });
  const { shown: pageRows, paging } = usePaged(exams);

  return (
    <>
      <div className="page-head" style={{ marginTop: 8 }}>
        <div>
          <h1 style={{ fontSize: 'calc(19px * var(--text-scale))' }}>Paper answer sheets (OMR)</h1>
          <p>Scanner uploads (Instructor website) and phone photos (mobile app), read by the same engine.</p>
        </div>
      </div>
      {error ? <div className="note red">{error}</div> : null}
      {!data ? (
        <Loading rows={2} />
      ) : (
        <>
          <div className="grid grid-4">
            <Tile icon="clipboard" label="Sheets scanned" value={fmtNum(scans.length)} sub={`${fmtNum(bySource('physical_scanner'))} scanner · ${fmtNum(bySource('mobile_camera'))} phone`} />
            <Tile icon="checkCircle" tone="ok" label="Graded" value={fmtNum(graded.length)} sub="Finalized by instructors" />
            <Tile icon="alert" tone="warn" label="Waiting for review" value={fmtNum(review.length)} sub="Unclear answers / student" />
            <Tile icon="x" tone="neutral" label="Could not be read" value={fmtNum(failed.length)} sub={[...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, n]) => `${REASON[k] ?? k} ${n}`).join(' · ') || 'None'} />
          </div>
          <div className="card">
            <CardHead title="OMR by exam" sub="In this period" />
            {exams.length ? (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Exam</th>
                        <th>Instructor</th>
                        <th className="num">Printed</th>
                        <th className="num">Scans</th>
                        <th className="num">Graded</th>
                        <th className="num">To review</th>
                        <th className="num">Unreadable</th>
                        <th className="num">Avg. score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((x) => (
                        <tr key={x.qid}>
                          <td>
                            <b>{x.title}</b>
                            <div style={{ color: 'var(--text-soft)', fontSize: 'calc(12.5px * var(--text-scale))' }}>{x.cls ? classLabel(x.cls) : ''}</div>
                          </td>
                          <td>{x.cls ? nameOf(w, x.cls.instructor_id) : '—'}</td>
                          <td className="num">{x.printed}</td>
                          <td className="num">{x.scans}</td>
                          <td className="num">{x.done}</td>
                          <td className="num">{x.review ? <span className="badge gold">{x.review}</span> : 0}</td>
                          <td className="num">{x.failed ? <span className="badge red">{x.failed}</span> : 0}</td>
                          <td className="num">{x.avg == null ? '—' : `${x.avg}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager paging={paging} noun="exams" />
              </>
            ) : (
              <Empty icon="clipboard" title="No paper answer sheets scanned in this period" body="Instructors scan sheets on the Instructor website (OMR Management) or with the mobile app (OMR Scanner)." />
            )}
          </div>
        </>
      )}
    </>
  );
}
