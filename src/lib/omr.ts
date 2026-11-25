/**
 * OMR (paper answer sheets) — mobile camera side.
 *
 * Same pipeline as the Instructor website's scanner upload: the photo is shrunk to ~2000 px, uploaded to
 * the private "omr-scans" bucket, and the shared "omr-process" Edge Function reads it (marker detection,
 * perspective correction, quality checks, bubble reading, QR → student). The instructor reviews unclear
 * answers and finalizes; omr_finalize() grades with the same scoring as phone quizzes.
 */
import { randomUUID } from 'expo-crypto';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { supabase } from './supabase';

export const OMR_STATUS = 'available' as const;

export type LayoutQuestion = { position: number; type: 'multiple_choice' | 'true_false'; choices: number };
export type OmrSheet = { id: string; quiz_id: string; student_email: string; student_name: string };
export type Detected = { choice: number | null; status: 'answered' | 'blank' | 'multiple' | 'uncertain'; confidence: number; fills: number[] };
export type ScanStatus = 'uploaded' | 'processing' | 'failed' | 'needs_review' | 'ready' | 'finalized' | 'duplicate';
export type OmrScan = {
  id: string;
  quiz_id: string;
  class_id: string;
  sheet_id: string | null;
  source: 'physical_scanner' | 'mobile_camera';
  image_path: string;
  processed_path: string | null;
  status: ScanStatus;
  message: string;
  issues: { code: string; message: string; blocking: boolean }[];
  detected: Detected[];
  answers: (number | null)[];
  confidence: number | null;
  score: number | null;
  total: number | null;
  created_at: string;
};
export type OmrExam = { id: string; title: string; status: string; class_id: string; class: { code: string; title: string; section: string } | null };

export const LETTERS = ['A', 'B', 'C', 'D', 'E'];
export const STATUS_LABEL: Record<ScanStatus, { label: string; tone: 'green' | 'gold' | 'red' | 'muted' }> = {
  uploaded: { label: 'Uploaded', tone: 'muted' },
  processing: { label: 'Processing', tone: 'muted' },
  failed: { label: 'Could not read', tone: 'red' },
  needs_review: { label: 'Needs review', tone: 'gold' },
  ready: { label: 'Ready to finalize', tone: 'green' },
  finalized: { label: 'Graded', tone: 'green' },
  duplicate: { label: 'Duplicate', tone: 'muted' },
};

function client() {
  if (!supabase) throw new Error('Not connected to the server');
  return supabase;
}
function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export async function fetchOmrExams(): Promise<OmrExam[]> {
  const c = client();
  const { data: auth } = await c.auth.getUser();
  if (!auth.user) throw new Error('Not signed in');
  const rows = must(
    await c.from('quizzes').select('id, title, status, class_id, classes!inner(code, title, section, instructor_id)').eq('classes.instructor_id', auth.user.id).order('created_at', { ascending: false }),
  ) as Record<string, unknown>[];
  return rows.map((r) => ({ ...(r as unknown as OmrExam), class: r.classes as OmrExam['class'] }));
}

export const fetchLayout = async (quizId: string) => must(await client().rpc('omr_layout', { _quiz_id: quizId })) as LayoutQuestion[];
export const fetchSheets = async (quizId: string) => must(await client().from('omr_sheets').select('id, quiz_id, student_email, student_name').eq('quiz_id', quizId).order('student_name')) as OmrSheet[];
export const fetchScans = async (quizId: string) => must(await client().from('omr_scans').select('*').eq('quiz_id', quizId).order('created_at', { ascending: false })) as OmrScan[];
export const fetchScan = async (id: string) => must(await client().from('omr_scans').select('*').eq('id', id).maybeSingle()) as OmrScan | null;

export async function imageUrl(path: string) {
  const { data, error } = await client().storage.from('omr-scans').createSignedUrl(path, 60 * 10);
  if (error || !data) throw new Error(error?.message ?? 'Could not load the image');
  return data.signedUrl;
}

/** Shrinks a camera photo so the long side is ~2000 px (plenty for 5 mm bubbles, quick to upload and read). */
export async function preparePhoto(uri: string, width: number, height: number) {
  const resize = width >= height ? { width: Math.min(width, 2000) } : { height: Math.min(height, 2000) };
  const out = await manipulateAsync(uri, [{ resize }], { compress: 0.88, format: SaveFormat.JPEG });
  return out.uri;
}

/** Upload a prepared photo and run the shared OMR engine on it. */
export async function uploadAndProcess(exam: OmrExam, photoUri: string, onStage?: (s: 'uploading' | 'processing') => void): Promise<OmrScan> {
  const c = client();
  const { data: auth } = await c.auth.getUser();
  if (!auth.user) throw new Error('Not signed in');
  const id = randomUUID();
  const path = `${exam.class_id}/${exam.id}/${id}.jpg`;
  onStage?.('uploading');
  const body = await (await fetch(photoUri)).arrayBuffer();
  const up = await c.storage.from('omr-scans').upload(path, body, { contentType: 'image/jpeg', upsert: false });
  if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
  must(
    await c
      .from('omr_scans')
      .insert({ id, quiz_id: exam.id, class_id: exam.class_id, source: 'mobile_camera', original_name: `Phone photo ${new Date().toLocaleTimeString()}`, image_path: path, created_by: auth.user.id })
      .select('id'),
  );
  onStage?.('processing');
  const { data, error } = await c.functions.invoke('omr-process', { body: { scan_id: id } });
  if (error) {
    const row = await fetchScan(id);
    if (row && row.status !== 'processing') return row;
    throw new Error(`Processing failed: ${error.message}`);
  }
  return data as OmrScan;
}

export const saveReview = async (scanId: string, answers: (number | null)[], sheetId: string | null) =>
  must(await client().rpc('omr_save_review', { _scan_id: scanId, _answers: answers, _sheet_id: sheetId })) as OmrScan;
export const finalizeScan = async (scanId: string) => must(await client().rpc('omr_finalize', { _scan_id: scanId })) as OmrScan;
export async function reprocess(scanId: string) {
  const { data, error } = await client().functions.invoke('omr-process', { body: { scan_id: scanId } });
  if (error) throw new Error(error.message);
  return data as OmrScan;
}

/* ---------- Capture queue shared by the camera and the scanner screen ---------- */
export type QueueItem = { key: string; uri: string; examId: string; state: 'waiting' | 'uploading' | 'processing' | 'done' | 'error'; scan?: OmrScan; error?: string };
let queue: QueueItem[] = [];
const listeners = new Set<(q: QueueItem[]) => void>();
const emit = () => listeners.forEach((l) => l([...queue]));
export const omrQueue = {
  get: () => [...queue],
  subscribe(fn: (q: QueueItem[]) => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  add(uri: string, examId: string) {
    queue = [...queue, { key: randomUUID(), uri, examId, state: 'waiting' }];
    emit();
  },
  update(key: string, patch: Partial<QueueItem>) {
    queue = queue.map((q) => (q.key === key ? { ...q, ...patch } : q));
    emit();
  },
  remove(key: string) {
    queue = queue.filter((q) => q.key !== key);
    emit();
  },
  clearDone() {
    queue = queue.filter((q) => q.state !== 'done');
    emit();
  },
};
