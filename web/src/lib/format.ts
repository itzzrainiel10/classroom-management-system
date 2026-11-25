const TZ = 'Asia/Manila';

export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });

export const fmtToday = (d = new Date()) =>
  d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

/** CvSU calendar: Semester 1 Aug–Dec, Semester 2 Jan–May, Midyear Jun–Jul. */
export function semesterLabel(d = new Date()) {
  const m = d.getMonth() + 1;
  const y = d.getFullYear();
  const start = m >= 8 ? y : y - 1;
  const term = m >= 8 ? 'Semester 1' : m <= 5 ? 'Semester 2' : 'Midyear';
  return `${term}, AY ${start}–${start + 1}`;
}

export function greeting(d = new Date()) {
  const h = Number(d.toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }));
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
export const fmtPct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 10) / 10}%`);
export const fmtNum = (n: number) => n.toLocaleString('en-US');

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('') || '?';

export function splitName(full: string) {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return { first: parts[0] ?? '', last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

/** Downloads rows as a CSV file. */
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const startOfDay = (d = new Date()) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/** "13:30:00" → "1:30 PM" */
export function fmtClock(t: string) {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ampm}`;
}

export const minutesOf = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/** "2026-08-11" → "Aug 11, 2026" (date only, no time-zone shift). */
export function fmtDay(d: string | null | undefined) {
  if (!d) return '—';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Aug 11 – Dec 19, 2026 · 19 weeks" for a semester's dates. */
export function semesterRange(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) return 'Dates not set';
  const weeks = Math.ceil((Date.parse(end) - Date.parse(start) + 86400000) / (7 * 86400000));
  return `${fmtDay(start)} – ${fmtDay(end)} · ${weeks} weeks`;
}
