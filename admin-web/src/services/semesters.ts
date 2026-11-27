import { supabase } from './supabase';

export type Semester = {
  id: string;
  semester: string;
  academic_year: string;
  starts_on: string | null;
  ends_on: string | null;
  status: 'active' | 'completed';
  created_at: string;
  ended_at: string | null;
  ended_by_name: string;
};

/** What ending the active semester will archive (counts come from the database). */
export type EndPreview = {
  semester: Semester;
  classes: number;
  instructors: number;
  subjects: number;
  sections: number;
  students: number;
  enrollments: number;
  quizzes: number;
  grades: number;
  assignments: number;
  announcements: number;
  attendance_sessions: number;
  attendance_records: number;
  omr_scans: number;
  schedules: number;
};

export type ArchiveSummary = { semester_id: string; summary: Partial<EndPreview> & { archived_classes?: number; archived_student_records?: number }; archived_at: string; archived_by_name: string };

const must = <T>(r: { data: T; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

export async function fetchSemesters() {
  const [semesters, preview, archives] = await Promise.all([
    supabase.from('semesters').select('*').order('created_at', { ascending: false }),
    supabase.rpc('semester_end_preview'),
    supabase.from('semester_archives').select('semester_id, summary, archived_at, archived_by_name'),
  ]);
  return {
    semesters: must(semesters) as Semester[],
    preview: must(preview) as EndPreview | null,
    archives: must(archives) as ArchiveSummary[],
  };
}

/** Archives everything of the semester in one database transaction, then marks it Completed. */
export async function endSemester(id: string) {
  return must(await supabase.rpc('end_semester', { _semester_id: id })) as EndPreview & { archived_classes: number; archived_student_records: number };
}

export async function startSemester(v: { semester: string; academic_year: string; starts_on: string; ends_on: string }) {
  return must(
    await supabase.rpc('start_semester', { _semester: v.semester, _academic_year: v.academic_year, _starts_on: v.starts_on, _ends_on: v.ends_on }),
  ) as string;
}
