import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ErrorNote, Loading } from '../components/ui';
import { BUBBLE_R, LETTERS, MARKERS, ORIENT_DOT, QR_BOX, SHEET, bubbleCenter, fetchLayout, fetchOmrExams, prepareSheets, type LayoutQuestion, type OmrExam, type Sheet } from '../services/omr';

/** Printable answer sheets (one per enrolled student). Positions are exact millimetres — print at 100 % on A4. */
export default function OmrPrint() {
  const { quizId } = useParams();
  const [state, setState] = useState<{ exam: OmrExam; layout: LayoutQuestion[]; sheets: Sheet[]; qr: Record<string, string> } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const exam = (await fetchOmrExams()).find((e) => e.id === quizId);
        if (!exam) throw new Error('Exam not found.');
        const layout = await fetchLayout(exam.id);
        const sheets = await prepareSheets(exam.id);
        const qr: Record<string, string> = {};
        for (const s of sheets) qr[s.id] = await QRCode.toDataURL(`CMSOMR:${s.id}`, { errorCorrectionLevel: 'M', margin: 0, width: 360 });
        setState({ exam, layout, sheets, qr });
        document.title = `Answer sheets · ${exam.title}`;
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [quizId]);

  if (err)
    return (
      <div style={{ padding: 24, maxWidth: 640 }}>
        <ErrorNote message={err} />
        <p style={{ marginTop: 12 }}>
          <Link className="link" to="/omr">
            Back to OMR Management
          </Link>
        </p>
      </div>
    );
  if (!state) return <div style={{ padding: 24 }}><Loading /></div>;
  const { exam, layout, sheets, qr } = state;

  return (
    <div className="omr-print-root">
      <div className="omr-print-bar no-print">
        <Link to="/omr" className="btn btn-secondary btn-sm">
          ← Back
        </Link>
        <div style={{ flex: 1 }}>
          <b>{exam.title}</b> · {sheets.length} sheet{sheets.length === 1 ? '' : 's'} · {layout.length} questions
          <div style={{ fontSize: 12.5, color: 'var(--text-soft)' }}>Print on A4 paper at 100 % (no “fit to page”). Students shade one bubble per question with a dark pencil or pen.</div>
        </div>
        <button className="btn btn-primary" onClick={() => window.print()} disabled={!sheets.length}>
          Print {sheets.length} sheets
        </button>
      </div>
      {!sheets.length ? <p style={{ padding: 24 }}>No students are enrolled in this class yet. Add students first (My Classes & Students).</p> : null}
      {sheets.map((s) => (
        <section key={s.id} className="omr-page" style={{ width: `${SHEET.w}mm`, height: `${SHEET.h}mm` }}>
          {MARKERS.map(([x, y], i) => (
            <div key={i} className="omr-abs omr-black" style={{ left: `${x - 5}mm`, top: `${y - 5}mm`, width: '10mm', height: '10mm' }} />
          ))}
          <div className="omr-abs omr-black" style={{ left: `${ORIENT_DOT[0] - 2.5}mm`, top: `${ORIENT_DOT[1] - 2.5}mm`, width: '5mm', height: '5mm' }} />
          <img className="omr-abs" src={qr[s.id]} alt="" style={{ left: `${QR_BOX.x}mm`, top: `${QR_BOX.y}mm`, width: `${QR_BOX.size}mm`, height: `${QR_BOX.size}mm` }} />
          <div className="omr-abs omr-head" style={{ left: '40mm', top: '9mm', width: '145mm' }}>
            CAVITE STATE UNIVERSITY · CLASSROOM MANAGEMENT SYSTEM · OMR ANSWER SHEET
          </div>
          <div className="omr-abs omr-info" style={{ left: '20mm', top: '24mm', width: '134mm' }}>
            <div className="omr-title">{exam.title}</div>
            <div>
              {exam.class ? `${exam.class.code} · ${exam.class.title} · ${exam.class.section}` : ''}
            </div>
            <div className="omr-student">
              Student: <b>{s.student_name || '—'}</b>
            </div>
            <div>{s.student_email}</div>
            <div className="omr-rules">Shade ONE bubble per question completely. Erase cleanly. Do not write near the black squares or the QR code.</div>
          </div>
          {layout.map((q, i) => {
            const [nx, ny] = bubbleCenter(i, 0);
            return (
              <div key={i}>
                <div className="omr-abs omr-num" style={{ left: `${nx - 14}mm`, top: `${ny - 2}mm`, width: '8mm' }}>
                  {i + 1}
                </div>
                {Array.from({ length: q.choices }, (_, c) => {
                  const [bx, by] = bubbleCenter(i, c);
                  return (
                    <div key={c} className="omr-abs omr-bubble" style={{ left: `${bx - BUBBLE_R}mm`, top: `${by - BUBBLE_R}mm`, width: `${BUBBLE_R * 2}mm`, height: `${BUBBLE_R * 2}mm` }}>
                      {q.type === 'true_false' ? (c === 0 ? 'T' : 'F') : LETTERS[c]}
                    </div>
                  );
                })}
              </div>
            );
          })}
          <div className="omr-abs omr-foot" style={{ left: '30mm', top: '289mm', width: '150mm' }}>
            Sheet {s.id.slice(0, 8)} · Truth · Excellence · Service
          </div>
        </section>
      ))}
    </div>
  );
}
