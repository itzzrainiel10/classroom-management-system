/**
 * CvSU CMS OMR engine — reads the CMS answer sheet template from a photo or a scan.
 * Pure TypeScript (no native code), so the same file runs in the Supabase Edge Function
 * that both the Instructor website and the mobile app send images to.
 *
 * Pipeline: grayscale → downscale → quality checks → adaptive threshold → find the 4 corner
 * markers → perspective transform (homography) → orientation (dot beside the top-left marker)
 * → per-bubble fill measurement against the local paper level → per-question decision.
 * Unclear marks are never guessed: they come back as "uncertain" / "multiple" for review.
 */

/* ======================= Template (millimetres, A4 portrait) ======================= */

export const SHEET = { w: 210, h: 297 } as const;
/** Centres of the four solid 10 mm corner squares: TL, TR, BR, BL. */
export const MARKERS: [number, number][] = [
  [15, 15],
  [195, 15],
  [195, 282],
  [15, 282],
];
export const MARKER_MM = 10;
/** 5 mm square right of the top-left marker: tells which way up the sheet is. */
export const ORIENT_DOT: [number, number] = [31, 15];
export const ORIENT_MM = 5;
/** QR code box (contains "CMSOMR:<sheet id>"). */
export const QR_BOX = { x: 160, y: 24, size: 30 } as const;
export const MAX_QUESTIONS = 50;
export const MAX_CHOICES = 5;
export const BUBBLE_R = 2.5;
const ROWS = 25;
const ROW0 = 74;
const ROW_STEP = 8;
const COL_X = [34, 122]; // centre of the first bubble (A) in each column
const CHOICE_STEP = 8;

/** Centre (mm) of a bubble. q is 0-based question index, c is 0-based choice index. */
export function bubbleCenter(q: number, c: number): [number, number] {
  const col = Math.floor(q / ROWS);
  const row = q % ROWS;
  return [COL_X[col] + c * CHOICE_STEP, ROW0 + row * ROW_STEP];
}
/** Where the question number is printed (right-aligned at this x). */
export function numberLabelAt(q: number): [number, number] {
  const [x, y] = bubbleCenter(q, 0);
  return [x - 6, y];
}

/* ======================= Types ======================= */

export type Gray = { width: number; height: number; data: Uint8Array };
export type QuestionSpec = { choices: number }; // number of bubbles (2 for True/False)
export type BubbleStatus = 'answered' | 'blank' | 'multiple' | 'uncertain';
export type QuestionResult = {
  /** 0-based chosen option, or null when blank / multiple / uncertain. */
  choice: number | null;
  status: BubbleStatus;
  /** 0..1 — how clearly the chosen bubble stands out (0 when no single answer). */
  confidence: number;
  /** Fill level of every bubble, 0 (empty) .. 1 (fully shaded). */
  fills: number[];
};
export type QualityIssue = { code: string; message: string; blocking: boolean };
export type OmrResult = {
  ok: boolean;
  /** Text read from the QR code (null if unreadable). */
  sheetCode: string | null;
  questions: QuestionResult[];
  issues: QualityIssue[];
  metrics: Record<string, number>;
  /** Image-space corner marker centres (TL, TR, BR, BL) after orientation, for debugging/overlays. */
  corners: [number, number][] | null;
  /** Homography sheet-mm → image px (row-major 3x3), when the sheet was found. */
  homography: number[] | null;
};

/* ======================= Image helpers ======================= */

/** RGBA (or RGB) bytes → 8-bit luma. */
export function toGray(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, channels = 4): Gray {
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += channels) {
    out[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
  }
  return { width, height, data: out };
}

/** Box-filter downscale so the longer side is at most maxSide. */
export function downscale(img: Gray, maxSide: number): Gray {
  const scale = Math.max(img.width, img.height) / maxSide;
  if (scale <= 1) return img;
  const f = Math.ceil(scale);
  const w = Math.floor(img.width / f);
  const h = Math.floor(img.height / f);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < f; dy++) {
        const row = (y * f + dy) * img.width + x * f;
        for (let dx = 0; dx < f; dx++) s += img.data[row + dx];
      }
      out[y * w + x] = Math.round(s / (f * f));
    }
  }
  return { width: w, height: h, data: out };
}

function bilinear(img: Gray, x: number, y: number): number {
  if (x < 0 || y < 0 || x > img.width - 1 || y > img.height - 1) return 255;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, img.width - 1);
  const y1 = Math.min(y0 + 1, img.height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const d = img.data;
  const a = d[y0 * img.width + x0] * (1 - fx) + d[y0 * img.width + x1] * fx;
  const b = d[y1 * img.width + x0] * (1 - fx) + d[y1 * img.width + x1] * fx;
  return a * (1 - fy) + b * fy;
}

/* ======================= Geometry ======================= */

/** Homography mapping src points → dst points (4 pairs), as a row-major 3x3 with h[8] = 1. */
export function homography(src: [number, number][], dst: [number, number][]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  // Gaussian elimination with partial pivoting.
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    if (Math.abs(A[c][c]) < 1e-12) throw new Error('degenerate homography');
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = new Array(8).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * h[k];
    h[r] = s / A[r][r];
  }
  return [...h, 1];
}

export function project(H: number[], x: number, y: number): [number, number] {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/** Render the sheet region (mm rectangle) into a straight grayscale image at pxPerMm. */
export function warp(img: Gray, H: number[], x0: number, y0: number, wMm: number, hMm: number, pxPerMm: number): Gray {
  const w = Math.round(wMm * pxPerMm);
  const h = Math.round(hMm * pxPerMm);
  const out = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const [sx, sy] = project(H, x0 + (i + 0.5) / pxPerMm, y0 + (j + 0.5) / pxPerMm);
      out[j * w + i] = Math.round(bilinear(img, sx, sy));
    }
  }
  return { width: w, height: h, data: out };
}

/* ======================= Marker detection ======================= */

type Blob = { area: number; cx: number; cy: number; x0: number; y0: number; x1: number; y1: number };

/** Dark mask via local-mean threshold (robust to shadows / uneven light). */
function darkMask(img: Gray): Uint8Array {
  const { width: W, height: H, data } = img;
  const integ = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += data[y * W + x];
      integ[(y + 1) * (W + 1) + x + 1] = integ[y * (W + 1) + x + 1] + row;
    }
  }
  const r = Math.max(8, Math.round(Math.min(W, H) / 10));
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const ya = Math.max(0, y - r);
    const yb = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const xa = Math.max(0, x - r);
      const xb = Math.min(W, x + r + 1);
      const sum = integ[yb * (W + 1) + xb] - integ[ya * (W + 1) + xb] - integ[yb * (W + 1) + xa] + integ[ya * (W + 1) + xa];
      const mean = sum / ((yb - ya) * (xb - xa));
      const v = data[y * W + x];
      mask[y * W + x] = v < mean * 0.72 && v < 150 ? 1 : 0;
    }
  }
  return mask;
}

function blobs(mask: Uint8Array, W: number, H: number): Blob[] {
  const seen = new Uint8Array(W * H);
  const out: Blob[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let area = 0, sx = 0, sy = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W;
      const y = (p - x) / W;
      area++;
      sx += x;
      sy += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < W - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && mask[p - W] && !seen[p - W]) { seen[p - W] = 1; stack.push(p - W); }
      if (y < H - 1 && mask[p + W] && !seen[p + W]) { seen[p + W] = 1; stack.push(p + W); }
    }
    out.push({ area, cx: sx / area, cy: sy / area, x0, y0, x1, y1 });
  }
  return out;
}

/** Solid, roughly square blobs that could be corner markers. */
function markerCandidates(img: Gray): { list: Blob[]; touchesEdge: boolean } {
  const { width: W, height: H } = img;
  const all = blobs(darkMask(img), W, H);
  const minSide = Math.min(W, H);
  const list = all.filter((b) => {
    const bw = b.x1 - b.x0 + 1;
    const bh = b.y1 - b.y0 + 1;
    const s = Math.max(bw, bh);
    if (s < minSide * 0.012 || s > minSide * 0.14) return false;
    const aspect = bw / bh;
    if (aspect < 0.55 || aspect > 1.8) return false;
    return b.area / (bw * bh) > 0.62; // solid (a rotated square still fills ≥ 0.5 of its box; perspective a bit less)
  });
  const touchesEdge = all.some((b) => b.area > minSide * minSide * 0.0004 && (b.x0 === 0 || b.y0 === 0 || b.x1 === W - 1 || b.y1 === H - 1) && b.area / ((b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1)) > 0.6);
  return { list, touchesEdge };
}

/** Order 4 points clockwise starting from the one with the smallest angle around their centre. */
function clockwise(pts: [number, number][]): [number, number][] {
  const cx = pts.reduce((s, p) => s + p[0], 0) / 4;
  const cy = pts.reduce((s, p) => s + p[1], 0) / 4;
  return [...pts].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
}

function quadAngles(q: [number, number][]): number[] {
  return q.map((p, i) => {
    const a = q[(i + 3) % 4];
    const c = q[(i + 1) % 4];
    const v1 = [a[0] - p[0], a[1] - p[1]];
    const v2 = [c[0] - p[0], c[1] - p[1]];
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]));
    return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  });
}

/** Pick the 4 blobs that best form the sheet's marker rectangle (180 × 267 mm, aspect 0.674). */
function pickMarkers(cands: Blob[]): [number, number][] | null {
  const top = [...cands].sort((a, b) => b.area - a.area).slice(0, 10);
  let best: { score: number; pts: [number, number][] } | null = null;
  const n = top.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++) {
          const set = [top[a], top[b], top[c], top[d]];
          const areas = set.map((s) => s.area);
          const areaRatio = Math.max(...areas) / Math.min(...areas);
          if (areaRatio > 3.5) continue;
          const q = clockwise(set.map((s) => [s.cx, s.cy] as [number, number]));
          const ang = quadAngles(q);
          if (ang.some((x) => x < 45 || x > 135)) continue;
          const sides = q.map((p, i) => Math.hypot(q[(i + 1) % 4][0] - p[0], q[(i + 1) % 4][1] - p[1]));
          const short = (sides[0] + sides[2]) / 2;
          const long = (sides[1] + sides[3]) / 2;
          const aspect = Math.min(short, long) / Math.max(short, long);
          // marker size vs quad size: a 10 mm marker is ~5.6 % of the 180 mm side
          const markerSide = Math.sqrt(areas.reduce((s, x) => s + x, 0) / 4);
          const rel = markerSide / Math.min(short, long);
          if (rel < 0.025 || rel > 0.12) continue;
          const score =
            Math.abs(aspect - 180 / 267) * 4 +
            Math.abs(Math.log(areaRatio)) * 0.5 +
            ang.reduce((s, x) => s + Math.abs(90 - x), 0) / 180 +
            Math.abs(Math.log(rel / 0.0556)) * 0.5;
          if (!best || score < best.score) best = { score, pts: q };
        }
  return best && best.score < 1.6 ? best.pts : null;
}

/* ======================= Sampling ======================= */

/** Mean brightness of a disc (mm units) on the sheet. */
function discMean(img: Gray, H: number[], cx: number, cy: number, r: number, step = 0.35): number {
  let s = 0, n = 0;
  for (let dy = -r; dy <= r; dy += step)
    for (let dx = -r; dx <= r; dx += step) {
      if (dx * dx + dy * dy > r * r) continue;
      const [x, y] = project(H, cx + dx, cy + dy);
      s += bilinear(img, x, y);
      n++;
    }
  return n ? s / n : 255;
}

/** Brightness percentile of a ring (mm) — the paper around a bubble. */
function ringLevel(img: Gray, H: number[], cx: number, cy: number, r0: number, r1: number): number {
  const vals: number[] = [];
  for (let k = 0; k < 48; k++) {
    const t = (k / 48) * Math.PI * 2;
    for (const r of [r0, (r0 + r1) / 2, r1]) {
      const [x, y] = project(H, cx + Math.cos(t) * r, cy + Math.sin(t) * r);
      vals.push(bilinear(img, x, y));
    }
  }
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length * 0.75)];
}

/** Median 20→80 % edge width (mm) across the outer left and top edges of the four corner markers. */
function edgeWidthMm(img: Gray, H: number[], ink: number, paper: number): number {
  const widths: number[] = [];
  const lo = ink + (paper - ink) * 0.2;
  const hi = ink + (paper - ink) * 0.8;
  const step = 0.05;
  const half = MARKER_MM / 2;
  for (const [mx, my] of MARKERS) {
    for (const horizontal of [true, false]) {
      for (const off of [-2.5, 0, 2.5]) {
        // walk from inside the marker outward across its left (or top) edge
        let tLo = NaN;
        let tHi = NaN;
        for (let t = 0; t <= 6; t += step) {
          const x = horizontal ? mx - half + 2 - t : mx + off;
          const y = horizontal ? my + off : my - half + 2 - t;
          const [px, py] = project(H, x, y);
          const v = bilinear(img, px, py);
          if (Number.isNaN(tLo) && v >= lo) tLo = t;
          if (Number.isNaN(tHi) && v >= hi) {
            tHi = t;
            break;
          }
        }
        if (!Number.isNaN(tLo) && !Number.isNaN(tHi)) widths.push(tHi - tLo);
      }
    }
  }
  if (!widths.length) return 99;
  widths.sort((a, b) => a - b);
  return widths[Math.floor(widths.length / 2)];
}

function laplacianVariance(img: Gray): number {
  const { width: W, height: H, data } = img;
  let s = 0, s2 = 0, n = 0;
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const l = data[i - 1] + data[i + 1] + data[i - W] + data[i + W] - 4 * data[i];
      s += l;
      s2 += l * l;
      n++;
    }
  const m = s / n;
  return s2 / n - m * m;
}

/* ======================= Main ======================= */

export type AnalyzeOptions = {
  /** Decodes a QR code from RGBA pixels; returns its text or null. */
  decodeQR?: (rgba: Uint8ClampedArray, width: number, height: number) => string | null;
  /** Original (pre-downscale) size, for the resolution check. */
  originalSize?: { width: number; height: number };
  /** Testing only: read the bubbles even when the blur check would reject the image. */
  ignoreQuality?: boolean;
};

const issue = (code: string, message: string, blocking: boolean): QualityIssue => ({ code, message, blocking });

export function analyzeSheet(input: Gray, questions: QuestionSpec[], opts: AnalyzeOptions = {}): OmrResult {
  const issues: QualityIssue[] = [];
  const metrics: Record<string, number> = {};
  const fail = (): OmrResult => ({ ok: false, sheetCode: null, questions: [], issues, metrics, corners: null, homography: null });

  const orig = opts.originalSize ?? { width: input.width, height: input.height };
  metrics.width = orig.width;
  metrics.height = orig.height;
  if (Math.min(orig.width, orig.height) < 700) {
    issues.push(issue('low_resolution', 'The image resolution is too low. Scan at 150 dpi or higher, or move the camera closer.', true));
    return fail();
  }

  const img = downscale(input, 1600);
  let sum = 0;
  for (let i = 0; i < img.data.length; i++) sum += img.data[i];
  metrics.brightness = sum / img.data.length;
  if (metrics.brightness < 60) {
    issues.push(issue('too_dark', 'The image is too dark. Please improve the lighting.', true));
    return fail();
  }

  const { list, touchesEdge } = markerCandidates(img);
  metrics.markerCandidates = list.length;
  const quad = pickMarkers(list);
  if (!quad) {
    issues.push(
      touchesEdge
        ? issue('cropped', 'The answer sheet is partially cropped. Make sure the whole sheet and all four corner squares are visible.', true)
        : list.length >= 4
          ? issue('markers_missing', 'The answer sheet could not be lined up. Hold the camera directly above the sheet and make sure all four black corner squares are visible.', true)
          : issue('markers_missing', 'Some alignment markers are missing. Make sure all four black corner squares are visible and not covered.', true),
    );
    return fail();
  }

  // Try the 4 possible orientations; the dark dot beside the top-left marker decides.
  let bestH: number[] | null = null;
  let bestCorners: [number, number][] | null = null;
  let bestContrast = -Infinity;
  for (let k = 0; k < 4; k++) {
    const corners = [0, 1, 2, 3].map((i) => quad[(i + k) % 4]);
    const H = homography(MARKERS, corners);
    const dot = discMean(img, H, ORIENT_DOT[0], ORIENT_DOT[1], ORIENT_MM * 0.3);
    const paper = discMean(img, H, ORIENT_DOT[0] + 8, ORIENT_DOT[1], 1.5);
    const contrast = paper - dot;
    if (contrast > bestContrast) {
      bestContrast = contrast;
      bestH = H;
      bestCorners = corners;
    }
  }
  metrics.orientationContrast = bestContrast;
  if (!bestH || !bestCorners || bestContrast < 40) {
    issues.push(issue('not_a_sheet', 'This does not look like a CvSU CMS answer sheet (orientation mark not found). Use the printed sheet for this exam.', true));
    return fail();
  }
  const H = bestH;

  // Perspective: how far from a rectangle are the marker positions?
  const ang = quadAngles(bestCorners);
  metrics.maxSkew = Math.max(...ang.map((a) => Math.abs(90 - a)));
  if (metrics.maxSkew > 30) {
    issues.push(issue('perspective', 'The photo is taken at a strong angle. Please position the camera directly above the answer sheet.', true));
    return fail();
  } else if (metrics.maxSkew > 16) {
    issues.push(issue('perspective_warn', 'The photo is taken at an angle; results were straightened but please check them.', false));
  }

  // Straightened sheet for quality checks (4 px/mm).
  const flat = warp(img, H, 0, 0, SHEET.w, SHEET.h, 4);
  const markerPx = (MARKER_MM / SHEET.w) * Math.hypot(bestCorners[1][0] - bestCorners[0][0], bestCorners[1][1] - bestCorners[0][1]) * (SHEET.w / 180);
  metrics.markerPx = markerPx;
  if (markerPx < 14) {
    issues.push(issue('too_small', 'The answer sheet is too small in the picture. Move the camera closer so the sheet fills the frame.', true));
    return fail();
  }

  // Blur: Laplacian variance of the straightened bubble area.
  const bubbleArea = warp(img, H, 20, 66, 160, 200, 4);
  metrics.sharpness = laplacianVariance(bubbleArea);

  // Paper level across the sheet (blank strip between the two columns + margins).
  const paperPts: [number, number][] = [];
  for (let y = 70; y <= 266; y += 14) paperPts.push([96, y], [182, y]);
  for (let x = 40; x <= 170; x += 26) paperPts.push([x, 60], [x, 270]);
  const levels = paperPts.map(([x, y]) => discMean(img, H, x, y, 1.5));
  const sortedLevels = [...levels].sort((a, b) => a - b);
  const paperHi = sortedLevels[Math.floor(levels.length * 0.9)];
  const paperLo = sortedLevels[Math.floor(levels.length * 0.1)];
  metrics.paperLevel = paperHi;
  metrics.shadowRatio = paperLo / Math.max(1, paperHi);
  const ink = Math.min(...[0, 1, 2, 3].map((i) => discMean(img, H, MARKERS[i][0], MARKERS[i][1], 3)));
  metrics.inkLevel = ink;
  metrics.contrast = paperHi - ink;

  if (metrics.contrast < 55) {
    issues.push(issue('low_contrast', 'The image is too dark or faded. Please improve the lighting.', true));
    return fail();
  }
  if (metrics.shadowRatio < 0.55) {
    issues.push(issue('shadow', 'There are strong shadows on the answer sheet. Avoid shadows and scan again.', true));
    return fail();
  } else if (metrics.shadowRatio < 0.72) {
    issues.push(issue('shadow_warn', 'Uneven lighting detected; results were adjusted but please check them.', false));
  }
  // Blur: how wide (in mm) the black→white edges of the corner markers are. A sharp scan is ~0.2 mm;
  // 5 mm bubbles stay readable up to ~1 mm of spread. Independent of image size and brightness.
  metrics.sharpnessRel = metrics.sharpness / Math.max(1, metrics.contrast);
  metrics.edgeMm = edgeWidthMm(img, H, ink, paperHi);
  if (!opts.ignoreQuality && metrics.edgeMm > 1.5) {
    issues.push(issue('blurry', 'Image is too blurry. Please scan again and keep the camera steady.', true));
    return fail();
  } else if (metrics.edgeMm > 0.8) {
    issues.push(issue('blurry_warn', 'The image is slightly blurry; please check the detected answers.', false));
  }

  // Glare: blown-out pixels inside the bubble area.
  let blown = 0;
  for (let i = 0; i < bubbleArea.data.length; i++) if (bubbleArea.data[i] >= 252) blown++;
  metrics.glare = blown / bubbleArea.data.length;
  // A scanner (or bright, even light) makes ALL the paper white — that is not glare. Glare is a blown-out
  // patch on a sheet whose paper is otherwise normally lit, so only check when the paper isn't uniformly white.
  const unevenPaper = paperLo < 238;
  if (unevenPaper && metrics.glare > 0.3) {
    issues.push(issue('glare', 'Glare is hiding part of the answer sheet. Tilt the sheet or the light and scan again.', true));
    return fail();
  } else if (unevenPaper && metrics.glare > 0.1) {
    issues.push(issue('glare_warn', 'Some glare detected; please check the detected answers.', false));
  }

  // QR code (sheet identity).
  let sheetCode: string | null = null;
  if (opts.decodeQR) {
    for (const scale of [8, 6, 10]) {
      const pad = 3;
      const crop = warp(img, H, QR_BOX.x - pad, QR_BOX.y - pad, QR_BOX.size + pad * 2, QR_BOX.size + pad * 2, scale);
      const rgba = new Uint8ClampedArray(crop.width * crop.height * 4);
      for (let i = 0; i < crop.data.length; i++) {
        rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = crop.data[i];
        rgba[i * 4 + 3] = 255;
      }
      sheetCode = opts.decodeQR(rgba, crop.width, crop.height);
      if (sheetCode) break;
    }
    if (!sheetCode) issues.push(issue('qr_unreadable', 'The QR code on the sheet could not be read, so the student could not be identified. Choose the student manually during review.', false));
  }

  // Bubbles.
  const paperMid = sortedLevels[Math.floor(levels.length / 2)];
  const results: QuestionResult[] = questions.slice(0, MAX_QUESTIONS).map((qs, q) => {
    const n = Math.max(2, Math.min(MAX_CHOICES, qs.choices));
    const fills: number[] = [];
    let glared = false;
    for (let c = 0; c < n; c++) {
      const [bx, by] = bubbleCenter(q, c);
      const inside = discMean(img, H, bx, by, 1.55);
      const paper = ringLevel(img, H, bx, by, 3.1, 3.6);
      // Local glare: paper around this bubble is blown out while the sheet is normally lit — a pencil
      // mark here could be washed out, so never trust a "blank" from this row.
      if (unevenPaper && paper >= 248 && paper - paperMid > 20) glared = true;
      const f = (paper - inside) / Math.max(20, paper - ink);
      fills.push(Math.round(Math.max(0, Math.min(1, f)) * 1000) / 1000);
    }
    if (glared) return { choice: null, status: 'uncertain' as BubbleStatus, confidence: 0, fills };
    const order = fills.map((f, i) => [f, i] as [number, number]).sort((a, b) => b[0] - a[0]);
    const [top, topIdx] = order[0];
    const second = order[1]?.[0] ?? 0;
    const MARK = 0.42;
    const FAINT = 0.2;
    const marked = fills.filter((f) => f >= MARK).length;
    let status: BubbleStatus;
    let choice: number | null = null;
    let confidence = 0;
    if (marked >= 2 && second >= Math.max(MARK, top * 0.6)) {
      status = 'multiple';
    } else if (top < FAINT) {
      status = 'blank';
      confidence = Math.round((1 - top / FAINT) * 100) / 100;
    } else if (top >= MARK && second < FAINT) {
      status = 'answered';
      choice = topIdx;
      confidence = Math.round(Math.min(1, (top - second) / 0.45) * 100) / 100;
    } else if (top >= MARK && second < top * 0.5) {
      // A clear mark plus a faint smudge (e.g. an erased answer): accept, lower confidence.
      status = 'answered';
      choice = topIdx;
      confidence = Math.round(Math.min(0.75, (top - second) / 0.6) * 100) / 100;
    } else {
      status = 'uncertain';
    }
    return { choice, status, confidence, fills };
  });

  metrics.answered = results.filter((r) => r.status === 'answered').length;
  metrics.problems = results.filter((r) => r.status === 'multiple' || r.status === 'uncertain').length;
  return { ok: true, sheetCode, questions: results, issues, metrics, corners: bestCorners, homography: H };
}
