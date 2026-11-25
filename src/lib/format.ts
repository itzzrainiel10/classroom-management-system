export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export const DAY_SHORT = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

export function dayName(dayOfWeek: number) {
  return DAYS[(dayOfWeek - 1 + 7) % 7] ?? '';
}

/** "Nov 08, 2026" */
export function fmtDate(iso: string | null | undefined) {
  if (!iso) return 'No due date';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

/** "Nov 08, 2026 · 11:59 PM" */
export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return 'No due date';
  const d = new Date(iso);
  return `${fmtDate(iso)} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

/** "Sunday, November 15" */
export function fmtToday(d = new Date()) {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

/** "09:00:00" → "9:00 AM" */
export function fmtTime(t: string) {
  const [h = '0', m = '0'] = t.split(':');
  const hour = Number(h);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${m.padStart(2, '0')} ${suffix}`;
}

export function minutesToTime(mins: number) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

export function timeToMinutes(t: string) {
  const [h = '0', m = '0'] = t.split(':');
  return Number(h) * 60 + Number(m);
}

export function pct(score: number, total: number) {
  return total > 0 ? Math.round((score / total) * 100) : 0;
}

/** ISO weekday 1 (Mon) … 7 (Sun) */
export function isoWeekday(d = new Date()) {
  const n = d.getDay();
  return n === 0 ? 7 : n;
}

export function greetingFor(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function firstName(full: string) {
  return full.trim().split(/\s+/)[0] ?? '';
}

export function mmss(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
