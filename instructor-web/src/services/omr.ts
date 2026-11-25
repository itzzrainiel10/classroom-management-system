import { supabase } from './supabase';

/**
 * OMR (paper answer sheets). The website and the mobile app use the same pipeline:
 * upload an image to the private "omr-scans" bucket → the "omr-process" Edge Function reads it →
 * the instructor reviews → omr_finalize() grades it with the same scoring as phone quizzes.
 */

/* ---------- Sheet template (must match supabase/functions/omr-process/engine.ts) ---------- */
export const SHEET = { w: 210, h: 297 } as const;
export const MARKERS: [number, number][] = [
  [15, 15],
  [195, 15],
  [195, 282],
  [15, 282],
];
export const ORIENT_DOT: [number, number] = [31, 15];
export const QR_BOX = { x: 160, y: 24, size: 30 } as const;
export const BUBBLE_R = 2.5;
export const MAX_QUESTIONS = 50;
export const LETTERS = ['A', 'B', 'C', 'D', 'E'];
export function bubbleCenter(q: number, c: number): [number, number] {
  const col = Math.floor(q / 25);
  const row = q % 25;
  return [[34, 122][col] + c * 8, 74 + row * 8];
}

/* ---------- Types ---------- */
export type LayoutQuestion = { position: number; type: 'multiple_choice' | 'true_false'; choices: number };
export type Sheet = { id: string; quiz_id: string; class_id: string; student_email: string; student_name: string };
export type Detected = { choice: number | null; status: 'answered' | 'blank' | 'multiple' | 'uncertain'; confidence: number; fills: number[] };
export type Issue = { code: string; message: string; blocking: boolean };
export type ScanStatus = 'uploaded' | 'processing' | 'failed' | 'needs_review' | 'ready' | 'finalized' | 'duplicate';
export type Scan = {
  id: string;
  quiz_id: string;
  class_id: string;
  sheet_id: string | null;
  source: 'physical_scanner' | 'mobile_camera';
  original_name: string;
  image_path: string;
  processed_path: string | null;
  status: ScanStatus;
  message: string;
  issues: Issue[];
  metrics: Record<string, number>;
  detected: Detected[];
  answers: (number | null)[];
  confidence: number | null;
  score: number | null;
  total: number | null;
  created_at: string;
  processed_at: string | null;
  finalized_at: string | null;
};
export type OmrExam = { id: string; title: string; kind: string; status: string; class_id: string; class: { code: string; title: string; section: string } | null };

const must = <T>(r: { data: T; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

/* ---------- Reads ---------- */
export async function fetchOmrExams(): Promise<OmrExam[]> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Not signed in');
  const rows = must(
    await supabase.from('quizzes').select('id, title, kind, status, class_id, classes!inner(code, title, section, instructor_id)').eq('classes.instructor_id', auth.user.id).order('created_at', { ascending: false }),
  ) as Record<string, unknown>[];
  return rows.map((r) => ({ ...(r as unknown as OmrExam), class: r.classes as OmrExam['class'] }));
}

/** Questions on the sheet; throws a readable message when the exam can't be done on paper. */
export async function fetchLayout(quizId: string): Promise<LayoutQuestion[]> {
  return must(await supabase.rpc('omr_layout', { _quiz_id: quizId })) as LayoutQuestion[];
}

export async function fetchSheets(quizId: string): Promise<Sheet[]> {
  return must(await supabase.from('omr_sheets').select('*').eq('quiz_id', quizId).order('student_name')) as Sheet[];
}

/** Creates one sheet per enrolled student (keeps existing ones) and returns them all. */
export async function prepareSheets(quizId: string): Promise<Sheet[]> {
  return must(await supabase.rpc('prepare_omr_sheets', { _quiz_id: quizId })) as Sheet[];
}

export async function fetchScans(quizId: string): Promise<Scan[]> {
  return must(await supabase.from('omr_scans').select('*').eq('quiz_id', quizId).order('created_at', { ascending: false })) as Scan[];
}

export async function imageUrl(path: string) {
  const { data, error } = await supabase.storage.from('omr-scans').createSignedUrl(path, 60 * 10);
  if (error || !data) throw new Error(error?.message ?? 'Could not load the image');
  return data.signedUrl;
}

/* ---------- Preparing files (scanner uploads) ---------- */
export const MAX_UPLOAD_MB = 25;
const MAX_SIDE = 2000; // long side sent to the server (≈170 dpi for A4) — sharp enough, fast to process

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not convert the image'))), 'image/jpeg', 0.9));
}

function fitCanvas(w: number, h: number) {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  return c;
}

/** One page ready to upload: a JPEG plus a small preview. */
export type PreparedPage = { name: string; blob: Blob; preview: string; width: number; height: number };

/** Images → 1 page each; PDFs → 1 page per PDF page (rendered at ~200 dpi). */
export async function preparePages(file: File): Promise<PreparedPage[]> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) {
    const pdfjs = await import('pdfjs-dist');
    const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = worker;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages: PreparedPage[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(200 / 72, MAX_SIDE / Math.max(base.width, base.height));
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await canvasToJpeg(canvas);
      pages.push({ name: `${file.name} · page ${p}`, blob, preview: URL.createObjectURL(blob), width: canvas.width, height: canvas.height });
    }
    return pages;
  }
  if (!/^image\/(jpeg|png)$/.test(file.type) && !/\.(jpe?g|png)$/i.test(file.name)) throw new Error(`${file.name}: use JPG, PNG or PDF files`);
  const bmp = await createImageBitmap(file);
  const canvas = fitCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToJpeg(canvas);
  return [{ name: file.name, blob, preview: URL.createObjectURL(blob), width: canvas.width, height: canvas.height }];
}

/* ---------- Upload + process (same steps as the mobile app) ---------- */
export async function uploadAndProcess(exam: OmrExam, page: PreparedPage, source: Scan['source'], onStage?: (s: 'uploading' | 'processing') => void): Promise<Scan> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Not signed in');
  const id = crypto.randomUUID();
  const path = `${exam.class_id}/${exam.id}/${id}.jpg`;
  onStage?.('uploading');
  const up = await supabase.storage.from('omr-scans').upload(path, page.blob, { contentType: 'image/jpeg', upsert: false });
  if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
  must(
    await supabase
      .from('omr_scans')
      .insert({ id, quiz_id: exam.id, class_id: exam.class_id, source, original_name: page.name, image_path: path, created_by: auth.user.id })
      .select('id'),
  );
  onStage?.('processing');
  const { data, error } = await supabase.functions.invoke('omr-process', { body: { scan_id: id } });
  if (error) {
    // The function stores its own failure reason on the scan; read it back for the message.
    const row = await supabase.from('omr_scans').select('*').eq('id', id).maybeSingle();
    if (row.data && row.data.status !== 'processing') return row.data as Scan;
    throw new Error(`Processing failed: ${error.message}`);
  }
  return data as Scan;
}

/** Run the OMR engine again on an existing scan (e.g. after a server update). */
export async function reprocess(scanId: string): Promise<Scan> {
  const { data, error } = await supabase.functions.invoke('omr-process', { body: { scan_id: scanId } });
  if (error) throw new Error(error.message);
  return data as Scan;
}

export async function saveReview(scanId: string, answers: (number | null)[], sheetId: string | null) {
  return must(await supabase.rpc('omr_save_review', { _scan_id: scanId, _answers: answers, _sheet_id: sheetId })) as Scan;
}
export async function finalizeScan(scanId: string) {
  return must(await supabase.rpc('omr_finalize', { _scan_id: scanId })) as Scan;
}
export async function deleteScan(scan: Scan) {
  must(await supabase.from('omr_scans').delete().eq('id', scan.id).select('id'));
  await supabase.storage.from('omr-scans').remove([scan.image_path, ...(scan.processed_path ? [scan.processed_path] : [])]);
}

export const STATUS_LABEL: Record<ScanStatus, { label: string; tone: 'green' | 'gold' | 'red' | 'gray' }> = {
  uploaded: { label: 'Uploaded', tone: 'gray' },
  processing: { label: 'Processing', tone: 'gray' },
  failed: { label: 'Could not read', tone: 'red' },
  needs_review: { label: 'Needs review', tone: 'gold' },
  ready: { label: 'Ready to finalize', tone: 'green' },
  finalized: { label: 'Graded', tone: 'green' },
  duplicate: { label: 'Duplicate', tone: 'gray' },
};
