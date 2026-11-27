// Previous-semester records (read-only). The database returns only the signed-in person's own archive:
// a student gets their own copy of each class; an instructor gets the classes they handled.
import { supabase } from '@/lib/supabase';

export type SemesterRef = { id: string; semester: string; academic_year: string; starts_on: string | null; ends_on: string | null; status: 'active' | 'completed'; ended_at: string | null };

export type ArchivedSchedule = { day_of_week: number; start_time: string; end_time: string; room: string; extra: boolean };
export type ArchivedAnnouncement = { id: string; title: string; message: string; created_at: string; author_name?: string };
export type ArchivedAssignment = { id: string; title: string; description: string; due_at: string | null; created_at: string };
export type ArchivedAttempt = {
  student_name: string;
  student_email: string;
  score: number | null;
  total: number | null;
  submitted_at: string | null;
  feedback: string | null;
  needs_grading: boolean | null;
};

/** A student's own copy of one class. */
export type StudentClassRecord = {
  id: string;
  semester_id: string;
  code: string;
  title: string;
  section: string;
  instructor_name: string;
  data: {
    subject?: { name?: string; units?: number; department?: string } | null;
    instructor?: { full_name?: string; email?: string; department?: string };
    schedule: ArchivedSchedule[];
    announcements: ArchivedAnnouncement[];
    assignments: ArchivedAssignment[];
    quizzes: { id: string; title: string; kind: string | null; due_at: string | null; passing_score: number | null; attempt: ArchivedAttempt | null }[];
    attendance: { date: string; status: string }[];
  };
};

/** One class an instructor handled, as it was when the semester ended. */
export type InstructorClassRecord = {
  id: string;
  semester_id: string;
  code: string;
  title: string;
  section: string;
  student_count: number;
  data?: {
    subject?: { name?: string; units?: number; department?: string } | null;
    schedule: ArchivedSchedule[];
    students: { email: string; full_name: string; student_number: string }[];
    quizzes: { id: string; title: string; kind: string | null; status: string; due_at: string | null; passing_score: number | null; attempts: ArchivedAttempt[] }[];
    assignments: ArchivedAssignment[];
    announcements: ArchivedAnnouncement[];
    attendance: { id: string; session_date: string; records: { student_name: string; student_email: string; status: string }[] }[];
  };
};

function sb() {
  if (!supabase) throw new Error('Not connected to the server');
  return supabase;
}

const must = <T>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export const semesterLabel = (s: Pick<SemesterRef, 'semester' | 'academic_year'>) => `${s.semester}, AY ${s.academic_year}`;

/** All semesters, newest first. */
export async function fetchSemesters(): Promise<SemesterRef[]> {
  return must(await sb().from('semesters').select('id, semester, academic_year, starts_on, ends_on, status, ended_at').order('created_at', { ascending: false })) as SemesterRef[];
}

/** Student: every archived class of theirs (all semesters). */
export async function fetchMyStudentArchive(): Promise<StudentClassRecord[]> {
  return must(
    await sb().from('semester_student_archives').select('id, semester_id, code, title, section, instructor_name, data').order('code'),
  ) as StudentClassRecord[];
}

/** Instructor: the classes they handled in ended semesters (list only, without the full snapshot). */
export async function fetchMyInstructorArchive(): Promise<InstructorClassRecord[]> {
  return must(
    await sb().from('semester_class_archives').select('id, semester_id, code, title, section, student_count').order('code'),
  ) as InstructorClassRecord[];
}

/** Instructor: one archived class with students, grades, attendance and posts. */
export async function fetchInstructorClassRecord(id: string): Promise<InstructorClassRecord | null> {
  return must(
    await sb().from('semester_class_archives').select('id, semester_id, code, title, section, student_count, data').eq('id', id).maybeSingle(),
  ) as InstructorClassRecord | null;
}

export const pctOf = (a: ArchivedAttempt | null | undefined) => (a && a.total ? Math.round(((a.score ?? 0) / a.total) * 100) : null);
