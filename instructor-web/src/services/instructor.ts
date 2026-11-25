import { supabase } from './supabase';
import type { Section, Settings, Subject } from './common';

/**
 * Instructor Portal data. Everything is read with the instructor's own session, so the database's
 * row-level security returns only their own profile, application, schedule and notifications —
 * the same rules the mobile app goes through.
 */

export type MyClass = {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  semester: string;
  academic_year: string;
  subject_code: string;
  subject_name: string;
  section_name: string;
  year_level: number;
  room: string;
  updated_at: string;
};

export type MyApplication = {
  employee_id: string;
  department: string;
  contact_number: string;
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  submitted_at: string;
  reviewed_at: string | null;
  proof_path: string | null;
};

export type Notice = { id: string; kind: string; title: string; body: string; read_at: string | null; created_at: string };

export type InstructorData = {
  profile: { full_name: string; email: string; created_at: string };
  application: MyApplication | null;
  term: Settings | null;
  schedule: MyClass[];
  subjects: Subject[];
  sections: Section[];
  notifications: Notice[];
};

const must = <T>(r: { data: T; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

export async function fetchInstructorData(): Promise<InstructorData> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Not signed in');
  const uid = auth.user.id;
  const [profile, application, term, schedule, subjects, sections, notifications] = await Promise.all([
    supabase.from('profiles').select('full_name, email, created_at').eq('id', uid).single(),
    supabase.from('instructor_profiles').select('employee_id, department, contact_number, status, submitted_at, reviewed_at, proof_path').eq('user_id', uid).maybeSingle(),
    supabase.from('app_settings').select('current_semester, current_academic_year, semester_start, semester_end').maybeSingle(),
    supabase.rpc('my_schedule'),
    supabase.from('subjects').select('*'),
    supabase.from('sections').select('*'),
    supabase.from('notifications').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(100),
  ]);
  const mine = must(schedule) as MyClass[];
  const codes = new Set(mine.map((c) => c.subject_code.toLowerCase()));
  const names = new Set(mine.map((c) => c.section_name.toLowerCase()));
  return {
    profile: must(profile) as InstructorData['profile'],
    application: must(application) as MyApplication | null,
    term: must(term) as Settings | null,
    schedule: mine,
    subjects: (must(subjects) as Subject[]).filter((s) => codes.has(s.code.toLowerCase())),
    sections: (must(sections) as Section[]).filter((s) => names.has(s.name.toLowerCase())),
    notifications: must(notifications) as Notice[],
  };
}

export async function markNotificationsRead() {
  must(await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null).select('id'));
}

/** Instructors may change their own display name only (status, role and verification are admin-controlled). */
export async function updateMyName(fullName: string) {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Not signed in');
  must(await supabase.from('profiles').update({ full_name: fullName.trim() }).eq('id', auth.user.id).select('id'));
}

export async function changeMyPassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message);
}

/** Minutes between two "HH:MM:SS" times. */
export const minutes = (a: string, b: string) => {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  return bh * 60 + bm - (ah * 60 + am);
};
export const hours = (list: MyClass[]) => Math.round((list.reduce((n, c) => n + minutes(c.start_time, c.end_time), 0) / 60) * 10) / 10;
