import { supabase } from './supabase';

/** Attendance (Present / Absent). Writes go through save_attendance, which checks the class's instructor and roster. */
export type AttendanceStatus = 'present' | 'absent';
export type AttendanceSession = { id: string; class_id: string; session_date: string; updated_at: string };
export type AttendanceRecord = { id: string; session_id: string; class_id: string; student_email: string; student_name: string; status: AttendanceStatus };

const must = <T>(r: { data: T; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

/** Every session and record of one class (row-level security: only the class's instructor gets them). */
export async function fetchClassAttendance(classId: string) {
  const [sessions, records] = await Promise.all([
    supabase.from('attendance_sessions').select('id, class_id, session_date, updated_at').eq('class_id', classId).order('session_date', { ascending: false }),
    supabase.from('attendance_records').select('id, session_id, class_id, student_email, student_name, status').eq('class_id', classId),
  ]);
  return { sessions: must(sessions) as AttendanceSession[], records: must(records) as AttendanceRecord[] };
}

export async function saveAttendance(classId: string, date: string, marks: { email: string; status: AttendanceStatus }[]) {
  must(await supabase.rpc('save_attendance', { _class_id: classId, _date: date, _records: marks }));
}

export async function deleteAttendanceSession(id: string) {
  must(await supabase.from('attendance_sessions').delete().eq('id', id).select('id'));
}

/** Today's date as YYYY-MM-DD in local time. */
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const fmtSessionDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};
