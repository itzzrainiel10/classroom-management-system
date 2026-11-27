import { supabase } from './supabase';

export type RenewalStatus = 'pending' | 'approved' | 'rejected';
export type Renewal = {
  id: string;
  semester_id: string;
  user_id: string;
  kind: 'student' | 'instructor';
  status: RenewalStatus;
  full_name: string;
  program: string;
  year_level: number | null;
  preferred_section_id: string | null;
  preferred_section_name: string;
  assigned_section_id: string | null;
  assigned_section_name: string;
  details: { student_number?: string; contact_number?: string; employee_id?: string; department?: string; note?: string };
  reason: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by_name: string;
};

export type ActiveSemester = { id: string; semester: string; academic_year: string } | null;

/** Renewals for the active semester, or (between semesters) for the next one. */
export type RenewalTerm = { semester: ActiveSemester; open: boolean; label: string };

const must = <T>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

/** The active semester and every renewal filed for it. */
export async function fetchRenewals(): Promise<RenewalTerm & { renewals: Renewal[] }> {
  const all = must(await supabase.from('semesters').select('id, semester, academic_year, status')) as (NonNullable<ActiveSemester> & { status: string })[];
  const active = all.find((s) => s.status === 'active') ?? null;
  const open = all.length > 0;
  const q = supabase.from('renewals').select('*').order('submitted_at', { ascending: false });
  const renewals = open ? (must(await (active ? q.eq('semester_id', active.id) : q.is('semester_id', null))) as Renewal[]) : [];
  return {
    semester: active ? { id: active.id, semester: active.semester, academic_year: active.academic_year } : null,
    open,
    label: active ? `${active.semester}, AY ${active.academic_year}` : 'the next semester',
    renewals,
  };
}

/** Approve (student: enroll in a section) or reject (with a reason the person sees). */
export async function reviewRenewal(userId: string, approve: boolean, opts: { reason?: string; sectionId?: string | null } = {}) {
  must(
    await supabase.rpc('review_renewal', {
      _user_id: userId,
      _approve: approve,
      _reason: opts.reason ?? '',
      _section_id: opts.sectionId ?? null,
    }),
  );
}
