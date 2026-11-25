// omr-process — the one OMR service used by both the Instructor website (scanner uploads) and the
// mobile app (camera photos). Called with { scan_id } after the image is uploaded to "omr-scans".
// Runs with the caller's own login, so row-level security limits it to the instructor's classes.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import jpeg from 'npm:jpeg-js@0.4.4';
import jsQR from 'npm:jsqr@1.4.0';

import { analyzeSheet, SHEET, toGray, warp, type QuestionResult } from './engine.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Auto answers from detection: chosen index, -1 for a confident blank, null when it needs a human. */
const autoAnswer = (q: QuestionResult) => (q.status === 'answered' ? q.choice : q.status === 'blank' ? -1 : null);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'Sign in first' }, 401);

  let scanId: string;
  try {
    scanId = String((await req.json()).scan_id ?? '');
  } catch {
    return json({ error: 'Send { scan_id }' }, 400);
  }
  if (!/^[0-9a-f-]{36}$/i.test(scanId)) return json({ error: 'Invalid scan id' }, 400);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: scan, error: scanErr } = await db.from('omr_scans').select('*').eq('id', scanId).maybeSingle();
  if (scanErr) return json({ error: scanErr.message }, 400);
  if (!scan) return json({ error: 'Scan not found (or not one of your classes)' }, 404);
  if (scan.status === 'finalized') return json({ error: 'This answer sheet is already finalized' }, 409);

  const fail = async (message: string, issues: unknown[] = [], metrics: Record<string, number> = {}) => {
    await db.from('omr_scans').update({ status: 'failed', message, issues, metrics, processed_at: new Date().toISOString() }).eq('id', scanId);
    return json({ status: 'failed', message, issues });
  };

  await db.from('omr_scans').update({ status: 'processing', message: '' }).eq('id', scanId);

  // Which questions are on the sheet (also checks the exam can be done on paper).
  const layout = await db.rpc('omr_layout', { _quiz_id: scan.quiz_id });
  if (layout.error) return fail(layout.error.message);
  const specs = (layout.data as { choices: number }[]).map((q) => ({ choices: q.choices }));

  // The uploaded image.
  const file = await db.storage.from('omr-scans').download(scan.image_path);
  if (file.error || !file.data) return fail('The uploaded image could not be read. Please upload it again.');
  let decoded: { width: number; height: number; data: Uint8Array };
  try {
    decoded = jpeg.decode(new Uint8Array(await file.data.arrayBuffer()), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 512 });
  } catch {
    return fail('Unsupported image. Upload a JPG photo or scan (PDF and PNG files are converted automatically by the website).');
  }

  const gray = toGray(decoded.data, decoded.width, decoded.height, 4);
  const result = analyzeSheet(gray, specs, {
    originalSize: { width: decoded.width, height: decoded.height },
    decodeQR: (rgba, w, h) => jsQR(rgba, w, h)?.data ?? null,
  });
  const blocking = result.issues.find((i) => i.blocking);
  if (!result.ok || blocking) return fail(blocking?.message ?? 'The answer sheet could not be read.', result.issues, result.metrics);

  // Which student's sheet is this? (QR: "CMSOMR:<sheet id>")
  const issues = [...result.issues];
  let sheetId: string | null = null;
  let message = '';
  const m = result.sheetCode?.match(/^CMSOMR:([0-9a-f-]{36})$/i);
  if (m) {
    const { data: sheet } = await db.from('omr_sheets').select('id, quiz_id, student_name, student_email').eq('id', m[1]).maybeSingle();
    if (!sheet) {
      issues.push({ code: 'unknown_sheet', message: 'The QR code is not a sheet from your classes. Choose the student manually.', blocking: false });
    } else if (sheet.quiz_id !== scan.quiz_id) {
      return fail('This answer sheet belongs to a different exam. Choose the right exam and upload it again.', issues, result.metrics);
    } else {
      sheetId = sheet.id;
    }
  } else if (result.sheetCode) {
    issues.push({ code: 'unknown_sheet', message: 'The QR code is not a CvSU CMS answer sheet code. Choose the student manually.', blocking: false });
  }

  // Duplicate protection: one graded sheet per student per exam.
  let status: 'needs_review' | 'ready' | 'duplicate' = 'needs_review';
  if (sheetId) {
    const { data: graded } = await db.from('omr_scans').select('id').eq('sheet_id', sheetId).eq('status', 'finalized').limit(1);
    if (graded?.length) {
      status = 'duplicate';
      message = 'This student’s answer sheet was already graded. This scan was not counted.';
    } else {
      // A newer scan replaces older, unfinished scans of the same sheet.
      await db
        .from('omr_scans')
        .update({ status: 'duplicate', message: 'Replaced by a newer scan of the same answer sheet.' })
        .eq('sheet_id', sheetId)
        .neq('id', scanId)
        .not('status', 'in', '(finalized,duplicate)');
    }
  }

  const answers = result.questions.map(autoAnswer);
  const unresolved = answers.some((a) => a === null);
  if (status !== 'duplicate') status = !unresolved && sheetId ? 'ready' : 'needs_review';
  const answeredConf = result.questions.filter((q) => q.status === 'answered').map((q) => q.confidence);
  const confidence = answeredConf.length ? Math.min(...answeredConf) : null;

  // Straightened copy for the review screen (3 px/mm, grayscale JPEG).
  let processedPath: string | null = null;
  try {
    const flat = warp(gray, result.homography!, 0, 0, SHEET.w, SHEET.h, 3);
    const rgba = new Uint8Array(flat.width * flat.height * 4);
    for (let i = 0; i < flat.data.length; i++) {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = flat.data[i];
      rgba[i * 4 + 3] = 255;
    }
    const out = jpeg.encode({ data: rgba, width: flat.width, height: flat.height }, 80);
    processedPath = scan.image_path.replace(/\.(jpe?g|png)$/i, '') + '.processed.jpg';
    const up = await db.storage.from('omr-scans').upload(processedPath, out.data, { contentType: 'image/jpeg', upsert: true });
    if (up.error) processedPath = null;
  } catch {
    processedPath = null;
  }

  const update = {
    status,
    message: message || (status === 'ready' ? 'All answers read clearly. Check and finalize.' : 'Some answers or the student need your review.'),
    issues,
    metrics: result.metrics,
    detected: result.questions,
    answers,
    confidence,
    sheet_id: sheetId,
    processed_path: processedPath,
    processed_at: new Date().toISOString(),
  };
  const saved = await db.from('omr_scans').update(update).eq('id', scanId).select('*').single();
  if (saved.error) return json({ error: saved.error.message }, 400);
  return json(saved.data);
});
