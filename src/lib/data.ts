import { randomUUID } from 'expo-crypto';

import type { OutboxOp } from './offline';
import { supabase } from './supabase';

/* ---------- Types ---------- */

export type ClassRef = { code: string; title: string; section: string };
export type ClassRow = ClassRef & { id: string; instructor_id: string; description: string; created_at: string };
export type ClassSummary = ClassRow & { students: number; quizzes: number; assignments: number; _pending?: true };
export type Student = { id: string; class_id: string; email: string; full_name: string; created_at: string; _pending?: true };
export type QuizStatus = 'draft' | 'published';
export type AssessmentKind = 'quiz' | 'exam';
export type Quiz = {
  kind?: AssessmentKind;
  id: string;
  class_id: string;
  title: string;
  description: string;
  due_at: string | null;
  time_limit_minutes: number;
  passing_score: number;
  status: QuizStatus;
  created_at: string;
  _pending?: true;
};
export type QuizSummary = Quiz & { class: ClassRef | null; questions: number; enrolled: number; attempts: Attempt[] };
export type QuestionType = 'multiple_choice' | 'true_false' | 'modified_true_false' | 'identification' | 'enumeration' | 'essay';
export const QUESTION_TYPES: { type: QuestionType; label: string; short: string }[] = [
  { type: 'multiple_choice', label: 'Multiple choice', short: 'Multiple choice' },
  { type: 'true_false', label: 'True or False', short: 'True / False' },
  { type: 'modified_true_false', label: 'Modified True or False', short: 'Modified T/F' },
  { type: 'identification', label: 'Identification', short: 'Identification' },
  { type: 'enumeration', label: 'Enumeration', short: 'Enumeration' },
  { type: 'essay', label: 'Essay', short: 'Essay' },
];
export const typeLabel = (t: QuestionType | undefined) => QUESTION_TYPES.find((x) => x.type === (t ?? 'multiple_choice'))?.label ?? 'Multiple choice';
export type Question = {
  id: string;
  quiz_id: string;
  position: number;
  prompt: string;
  choices: string[];
  type?: QuestionType;
  points?: number;
  /** Number of blanks for enumeration. */
  item_count?: number;
};
/** One student answer, in question order. */
export type Response =
  | { choice: number }
  | { value: boolean; correction?: string }
  | { text: string }
  | { items: string[] }
  | Record<string, never>;
export type ItemScore = { question_id: string; points: number; max: number; pending: boolean };
export type Attempt = {
  id: string;
  quiz_id: string;
  student_id: string;
  student_name: string;
  student_email: string;
  answers: number[];
  responses?: Response[];
  item_scores?: ItemScore[];
  /** An essay is waiting for the instructor's points. */
  needs_grading?: boolean;
  graded_at?: string | null;
  feedback?: string;
  score: number;
  total: number;
  started_at: string | null;
  submitted_at: string;
};
export type Assignment = { id: string; class_id: string; title: string; description: string; due_at: string | null; created_at: string; class?: ClassRef | null; _pending?: true };
export type Announcement = { id: string; class_id: string; title: string; message: string; created_at: string; class?: ClassRef | null; _pending?: true };
export type Schedule = { id: string; class_id: string; day_of_week: number; start_time: string; end_time: string; room: string; class?: ClassRef | null; _pending?: true };

/* ---------- Helpers ---------- */

function client() {
  if (!supabase) throw new Error('Not connected to the server');
  return supabase;
}

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

const count = (v: unknown) => (Array.isArray(v) && v[0] && typeof v[0].count === 'number' ? (v[0].count as number) : 0);

type Raw = Record<string, unknown>;

function toQuizSummary(r: Raw): QuizSummary {
  const cls = r.classes as (ClassRef & { class_students?: unknown }) | null;
  return {
    ...(r as unknown as Quiz),
    class: cls ? { code: cls.code, title: cls.title, section: cls.section } : null,
    questions: count(r.quiz_questions),
    enrolled: count(cls?.class_students),
    attempts: (r.quiz_attempts as Attempt[] | undefined) ?? [],
  };
}

/* ---------- Instructor reads ---------- */

export async function fetchClasses(): Promise<ClassSummary[]> {
  const rows = must(
    await client()
      .from('classes')
      .select('*, class_students(count), quizzes(count), assignments(count)')
      .order('created_at', { ascending: false }),
  ) as Raw[];
  return rows.map((r) => ({
    ...(r as unknown as ClassRow),
    students: count(r.class_students),
    quizzes: count(r.quizzes),
    assignments: count(r.assignments),
  }));
}

export async function fetchClassDetail(id: string) {
  const c = client();
  const [cls, students, quizzes, assignments, announcements, schedules] = await Promise.all([
    c.from('classes').select('*').eq('id', id).maybeSingle(),
    c.from('class_students').select('*').eq('class_id', id).order('full_name'),
    c.from('quizzes').select('*, quiz_questions(count), quiz_attempts(id)').eq('class_id', id).order('created_at', { ascending: false }),
    c.from('assignments').select('*').eq('class_id', id).order('created_at', { ascending: false }),
    c.from('announcements').select('*').eq('class_id', id).order('created_at', { ascending: false }),
    c.from('class_schedules').select('*').eq('class_id', id).order('day_of_week'),
  ]);
  return {
    cls: must(cls) as ClassRow | null,
    students: must(students) as Student[],
    quizzes: (must(quizzes) as Raw[]).map((q) => ({
      ...(q as unknown as Quiz),
      questions: count(q.quiz_questions),
      submitted: Array.isArray(q.quiz_attempts) ? q.quiz_attempts.length : 0,
    })),
    assignments: must(assignments) as Assignment[],
    announcements: must(announcements) as Announcement[],
    schedules: must(schedules) as Schedule[],
  };
}

export async function fetchQuizSummaries(): Promise<QuizSummary[]> {
  const rows = must(
    await client()
      .from('quizzes')
      .select('*, classes(code, title, section, class_students(count)), quiz_questions(count), quiz_attempts(*)')
      .order('created_at', { ascending: false }),
  ) as Raw[];
  return rows.map(toQuizSummary);
}

export async function fetchQuizResults(quizId: string) {
  const c = client();
  const quiz = must(
    await c.from('quizzes').select('*, classes(code, title, section, class_students(count)), quiz_questions(count), quiz_attempts(*)').eq('id', quizId).maybeSingle(),
  ) as Raw | null;
  if (!quiz) return null;
  const roster = must(await c.from('class_students').select('*').eq('class_id', quiz.class_id as string).order('full_name')) as Student[];
  return { quiz: toQuizSummary(quiz), roster };
}

export async function fetchQuizForEdit(quizId: string) {
  const c = client();
  const [quiz, questions, keys] = await Promise.all([
    c.from('quizzes').select('*').eq('id', quizId).maybeSingle(),
    c.from('quiz_questions').select('*').eq('quiz_id', quizId).order('position'),
    c.from('quiz_answer_keys').select('question_id, correct_index, answer').eq('quiz_id', quizId),
  ]);
  const keyMap = new Map((must(keys) as { question_id: string; correct_index: number | null; answer: AnswerKey }[]).map((k) => [k.question_id, k]));
  return {
    quiz: must(quiz) as Quiz | null,
    questions: (must(questions) as Question[]).map((q) => ({ ...q, correct_index: keyMap.get(q.id)?.correct_index ?? 0, answer: keyMap.get(q.id)?.answer ?? {} })),
  };
}

export async function fetchSchedules(): Promise<Schedule[]> {
  const rows = must(await client().from('class_schedules').select('*, classes(code, title, section)').order('day_of_week').order('start_time')) as Raw[];
  return rows.map((r) => ({ ...(r as unknown as Schedule), class: (r.classes as ClassRef | null) ?? null }));
}

export async function fetchFeed() {
  const c = client();
  const [assignments, announcements] = await Promise.all([
    c.from('assignments').select('*, classes(code, title, section)').order('created_at', { ascending: false }).limit(50),
    c.from('announcements').select('*, classes(code, title, section)').order('created_at', { ascending: false }).limit(50),
  ]);
  return {
    assignments: (must(assignments) as Raw[]).map((r) => ({ ...(r as unknown as Assignment), class: (r.classes as ClassRef | null) ?? null })),
    announcements: (must(announcements) as Raw[]).map((r) => ({ ...(r as unknown as Announcement), class: (r.classes as ClassRef | null) ?? null })),
  };
}

/* ---------- Student reads ---------- */

export async function fetchQuizToTake(quizId: string) {
  const c = client();
  const [quiz, questions, attempt] = await Promise.all([
    c.from('quizzes').select('*, classes(code, title, section), quiz_questions(count)').eq('id', quizId).maybeSingle(),
    c.from('quiz_questions').select('*').eq('quiz_id', quizId).order('position'),
    c.from('quiz_attempts').select('*').eq('quiz_id', quizId).maybeSingle(),
  ]);
  const q = must(quiz) as Raw | null;
  return {
    quiz: q ? toQuizSummary(q) : null,
    questions: must(questions) as Question[],
    attempt: must(attempt) as Attempt | null,
  };
}

/* ---------- Writes (queued in the outbox, so they work offline) ---------- */

type Op = { op: OutboxOp; label: string };

export function newClassOp(instructorId: string, v: { code: string; title: string; section: string; description: string }): Op & { id: string } {
  const id = randomUUID();
  const row = { id, instructor_id: instructorId, code: v.code.trim(), title: v.title.trim(), section: v.section.trim(), description: v.description.trim(), created_at: new Date().toISOString() };
  return { id, op: { kind: 'insert', table: 'classes', row }, label: `Class ${row.code}` };
}

export function addStudentOp(classId: string, email: string, fullName: string): Op {
  const row = { id: randomUUID(), class_id: classId, email: email.trim().toLowerCase(), full_name: fullName.trim(), created_at: new Date().toISOString() };
  return { op: { kind: 'insert', table: 'class_students', row }, label: `Add ${row.email}` };
}

export const removeStudentOp = (id: string, email: string): Op => ({ op: { kind: 'delete', table: 'class_students', id }, label: `Remove ${email}` });

export function assignmentOp(classId: string, v: { title: string; description: string; due_at: string | null }): Op {
  const row = { id: randomUUID(), class_id: classId, title: v.title.trim(), description: v.description.trim(), due_at: v.due_at, created_at: new Date().toISOString() };
  return { op: { kind: 'insert', table: 'assignments', row }, label: `Assignment “${row.title}”` };
}

export function announcementOp(classId: string, v: { title: string; message: string }): Op {
  const row = { id: randomUUID(), class_id: classId, title: v.title.trim(), message: v.message.trim(), created_at: new Date().toISOString() };
  return { op: { kind: 'insert', table: 'announcements', row }, label: `Announcement “${row.title}”` };
}

export function scheduleOp(classId: string, v: { day_of_week: number; start_time: string; end_time: string; room: string }): Op {
  const row = { id: randomUUID(), class_id: classId, ...v, room: v.room.trim(), created_at: new Date().toISOString() };
  return { op: { kind: 'insert', table: 'class_schedules', row }, label: 'Class schedule' };
}

export const deleteOp = (table: string, id: string, label: string): Op => ({ op: { kind: 'delete', table, id }, label });

/** Answer key for every non-multiple-choice type (see the save_quiz SQL function). */
export type AnswerKey = { value?: boolean; accepted?: string[]; items?: string[][]; guide?: string };
export type DraftQuestion = { type: QuestionType; prompt: string; choices: string[]; points: number; correct_index: number; answer: AnswerKey };

export type QuizDraft = {
  kind: AssessmentKind;
  id: string;
  class_id: string;
  title: string;
  description: string;
  due_at: string | null;
  time_limit_minutes: number;
  passing_score: number;
  status: QuizStatus;
  questions: DraftQuestion[];
};

export function saveQuizOp(d: QuizDraft): Op {
  const { questions, ...quiz } = d;
  return {
    op: {
      kind: 'rpc',
      fn: 'save_quiz',
      args: { _payload: d },
      table: 'quizzes',
      preview: { ...quiz, created_at: new Date().toISOString() },
    },
    label: `Quiz “${d.title}” (${questions.length} questions)`,
  };
}

/** Submits right away when online so the student sees the score; otherwise returns null and the caller queues it. */
export async function submitQuizNow(quizId: string, responses: Response[], startedAt: string): Promise<Attempt | null> {
  const { data, error } = await client().rpc('submit_quiz_v2', { _quiz_id: quizId, _responses: responses, _started_at: startedAt });
  if (error) {
    if (error.code) throw new Error(error.message);
    return null;
  }
  return data as Attempt;
}

export const submitQuizOp = (quizId: string, responses: Response[], startedAt: string, title: string): Op => ({
  op: { kind: 'rpc', fn: 'submit_quiz_v2', args: { _quiz_id: quizId, _responses: responses, _started_at: startedAt } },
  label: `Quiz answers “${title}”`,
});

/* ---------- Official schedule (set by administrators in the web portal) ---------- */

export type OfficialClass = {
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
  instructor_name: string;
  instructor_employee_id: string;
  updated_at: string;
};
export type Term = { current_semester: string; current_academic_year: string; semester_start: string | null; semester_end: string | null };
export type MyTimetable = { term: Term | null; section: { name: string; year_level: number } | null; classes: OfficialClass[] };

/** The signed-in user's official classes this term (instructor: own classes; student: own section). Read-only. */
export async function fetchMyTimetable(): Promise<MyTimetable> {
  const c = client();
  const { data: auth } = await c.auth.getUser();
  const [classes, term, me] = await Promise.all([
    c.rpc('my_schedule'),
    c.from('app_settings').select('current_semester, current_academic_year, semester_start, semester_end').maybeSingle(),
    auth.user ? c.from('profiles').select('sections(name, year_level)').eq('id', auth.user.id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  const sec = (me.data as { sections?: { name: string; year_level: number } | null } | null)?.sections ?? null;
  return { classes: must(classes) as OfficialClass[], term: must(term) as Term | null, section: sec };
}

/* ---------- Instructor application ---------- */

export type ApplicationRow = {
  employee_id: string;
  department: string;
  contact_number: string;
  proof_path: string | null;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason: string;
  submitted_at: string;
  reviewed_at: string | null;
};

export async function fetchMyApplication(): Promise<ApplicationRow | null> {
  const c = client();
  const { data: auth } = await c.auth.getUser();
  if (!auth.user) return null;
  return must(await c.from('instructor_profiles').select('employee_id, department, contact_number, proof_path, status, rejection_reason, submitted_at, reviewed_at').eq('user_id', auth.user.id).maybeSingle()) as ApplicationRow | null;
}

/** Uploads a proof document (PDF or image) to the private instructor-proofs bucket; returns its path. */
export async function uploadProof(file: { uri: string; name: string; mimeType?: string | null }): Promise<string> {
  const c = client();
  const { data: auth } = await c.auth.getUser();
  if (!auth.user) throw new Error('Not signed in');
  const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-80) || 'proof';
  const path = `${auth.user.id}/${Date.now()}-${safe}`;
  const body = await (await fetch(file.uri)).arrayBuffer();
  const { error } = await c.storage.from('instructor-proofs').upload(path, body, { contentType: file.mimeType ?? 'application/octet-stream', upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

export async function submitApplication(v: { full_name: string; employee_id: string; department: string; contact_number: string; proof_path: string | null }) {
  must(
    await client().rpc('submit_instructor_application', {
      _full_name: v.full_name,
      _employee_id: v.employee_id,
      _department: v.department,
      _contact_number: v.contact_number,
      _proof_path: v.proof_path,
    }),
  );
}

/* ---------- Notifications ---------- */

export type Notice = { id: string; kind: string; title: string; body: string; read_at: string | null; created_at: string };

export async function fetchNotifications(): Promise<Notice[]> {
  return must(await client().from('notifications').select('*').order('created_at', { ascending: false }).limit(60)) as Notice[];
}

export async function markAllRead() {
  must(await client().from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null).select('id'));
}

/* ---------- Grading (essays) ---------- */

export type GradingQuestion = Question & { correct_index: number | null; answer: AnswerKey };

/** One student's answers with the questions and answer key, for the instructor. */
export async function fetchAttemptForGrading(attemptId: string) {
  const c = client();
  const attempt = must(await c.from('quiz_attempts').select('*').eq('id', attemptId).maybeSingle()) as Attempt | null;
  if (!attempt) return null;
  const [quiz, questions, keys] = await Promise.all([
    c.from('quizzes').select('id, title, kind, passing_score').eq('id', attempt.quiz_id).maybeSingle(),
    c.from('quiz_questions').select('*').eq('quiz_id', attempt.quiz_id).order('position'),
    c.from('quiz_answer_keys').select('question_id, correct_index, answer').eq('quiz_id', attempt.quiz_id),
  ]);
  const k = new Map((must(keys) as { question_id: string; correct_index: number | null; answer: AnswerKey }[]).map((x) => [x.question_id, x]));
  return {
    attempt,
    quiz: must(quiz) as { id: string; title: string; kind: AssessmentKind; passing_score: number } | null,
    questions: (must(questions) as Question[]).map((q) => ({ ...q, correct_index: k.get(q.id)?.correct_index ?? null, answer: k.get(q.id)?.answer ?? {} })) as GradingQuestion[],
  };
}

/** Saves essay points ({questionId: points}) and feedback; the server recomputes the total. */
export async function gradeAttempt(attemptId: string, scores: Record<string, number>, feedback: string) {
  return must(await client().rpc('grade_attempt', { _attempt_id: attemptId, _scores: scores, _feedback: feedback })) as Attempt;
}

/* ---------- Sections (students choose theirs once) ---------- */

export type SectionOption = { id: string; name: string; year_level: number; program: string };

/** All sections; readable before sign-in so the sign-up form can list them. */
export async function fetchSections(): Promise<SectionOption[]> {
  return must(await client().from('sections').select('id, name, year_level, program').order('year_level').order('name')) as SectionOption[];
}

/** One-time choice for a student without a section (afterwards only an admin can change it). */
export async function chooseMySection(sectionId: string) {
  must(await client().rpc('choose_my_section', { _section_id: sectionId }));
}

/* ---------- Attendance (Present / Absent) ---------- */

export type AttendanceStatus = 'present' | 'absent';
export type AttendanceSession = { id: string; class_id: string; session_date: string };
export type AttendanceRecord = { id: string; session_id: string; class_id: string; student_email: string; student_name: string; status: AttendanceStatus };

/** One class's attendance (instructor: the whole class; row-level security limits students to their own rows). */
export async function fetchClassAttendance(classId: string) {
  const c = client();
  const [sessions, records] = await Promise.all([
    c.from('attendance_sessions').select('id, class_id, session_date').eq('class_id', classId).order('session_date', { ascending: false }),
    c.from('attendance_records').select('id, session_id, class_id, student_email, student_name, status').eq('class_id', classId),
  ]);
  return { sessions: must(sessions) as AttendanceSession[], records: must(records) as AttendanceRecord[] };
}

/** Save (or replace) attendance for one class and date. Works offline: queued and uploaded later. */
export function attendanceOp(classId: string, date: string, marks: { email: string; status: AttendanceStatus }[], label: string): Op {
  return {
    op: { kind: 'rpc', fn: 'save_attendance', args: { _class_id: classId, _date: date, _records: marks } },
    label: `Attendance · ${label}`,
  };
}

export type MyAttendanceRow = { status: AttendanceStatus; session_date: string; class: ClassRef & { id: string } };

/** The signed-in student's own attendance across their classes. */
export async function fetchMyAttendance(): Promise<MyAttendanceRow[]> {
  const rows = must(
    await client().from('attendance_records').select('status, attendance_sessions(session_date), classes(id, code, title, section)'),
  ) as Raw[];
  return rows
    .map((r) => ({
      status: r.status as AttendanceStatus,
      session_date: ((r.attendance_sessions as { session_date: string } | null)?.session_date ?? '') as string,
      class: r.classes as ClassRef & { id: string },
    }))
    .filter((r) => r.class && r.session_date)
    .sort((a, b) => b.session_date.localeCompare(a.session_date));
}
