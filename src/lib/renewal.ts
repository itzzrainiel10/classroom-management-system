// Semester renewal: students renew their enrollment, instructors confirm their status, for the active
// semester. The database decides everything (nobody is enrolled until an administrator approves).
import { supabase } from '@/lib/supabase';

export type MyRenewal = {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  kind: 'student' | 'instructor';
  program: string;
  year_level: number | null;
  preferred_section_id: string | null;
  preferred_section_name: string;
  assigned_section_name: string;
  details: { student_number?: string; contact_number?: string; employee_id?: string; department?: string; note?: string };
  reason: string;
  submitted_at: string | null;
};

export type RenewalState = {
  semester: { id: string; semester: string; academic_year: string } | null;
  /** Renewal is open: during a semester, and right after one ends (for the next semester). */
  open: boolean;
  /** "2nd Semester, AY 2026-2027" or "the next semester". */
  label: string;
  renewal: MyRenewal | null;
  profile: { full_name: string; student_number: string } | null;
  instructor: { employee_id: string; department: string; contact_number: string } | null;
};

function sb() {
  if (!supabase) throw new Error('Not connected to the server');
  return supabase;
}

const must = <T>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export async function fetchMyRenewal(): Promise<RenewalState> {
  const c = sb();
  const { data: auth } = await c.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return { semester: null, open: false, label: '', renewal: null, profile: null, instructor: null };
  const all = must(await c.from('semesters').select('id, semester, academic_year, status')) as (NonNullable<RenewalState['semester']> & { status: string })[];
  const active = all.find((s) => s.status === 'active');
  const semester = active ? { id: active.id, semester: active.semester, academic_year: active.academic_year } : null;
  const open = all.length > 0;
  const mine = c.from('renewals').select('*').eq('user_id', uid);
  const [renewal, profile, instructor] = await Promise.all([
    open ? (semester ? mine.eq('semester_id', semester.id) : mine.is('semester_id', null)).maybeSingle() : Promise.resolve({ data: null, error: null }),
    c.from('profiles').select('full_name, student_number').eq('id', uid).maybeSingle(),
    c.from('instructor_profiles').select('employee_id, department, contact_number').eq('user_id', uid).maybeSingle(),
  ]);
  return {
    semester,
    open,
    label: semester ? `${semester.semester}, AY ${semester.academic_year}` : 'the next semester',
    renewal: must(renewal) as MyRenewal | null,
    profile: must(profile) as RenewalState['profile'],
    instructor: must(instructor) as RenewalState['instructor'],
  };
}

export async function submitRenewal(details: Record<string, unknown>) {
  must(await sb().rpc('submit_renewal', { _details: { ...details, confirmed: true } }));
}
