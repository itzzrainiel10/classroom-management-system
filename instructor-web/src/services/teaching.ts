import { supabase } from './supabase';

/**
 * Instructor teaching tools on the web: quizzes/exams, assignments, announcements and results.
 * Uses the same tables and server functions as the mobile app (save_quiz, grade_attempt), so the
 * database checks every write: an instructor can only touch classes they teach, answer keys are
 * never readable by students, and scoring happens on the server.
 */

export type ClassRef = { id: string; code: string; title: string; section: string };
export type QuestionType = 'multiple_choice' | 'true_false' | 'modified_true_false' | 'identification' | 'enumeration' | 'essay';
export const QUESTION_TYPES: { type: QuestionType; label: string }[] = [
  { type: 'multiple_choice', label: 'Multiple choice' },
  { type: 'true_false', label: 'True or False' },
  { type: 'modified_true_false', label: 'Modified True or False' },
  { type: 'identification', label: 'Identification' },
  { type: 'enumeration', label: 'Enumeration' },
  { type: 'essay', label: 'Essay' },
];
export const typeLabel = (t?: string) => QUESTION_TYPES.find((x) => x.type === (t ?? 'multiple_choice'))?.label ?? 'Multiple choice';

export type AnswerKey = { value?: boolean; accepted?: string[]; items?: string[][]; guide?: string };
export type ItemScore = { question_id: string; points: number; max: number; pending: boolean };
export type Attempt = {
  id: string;
  quiz_id: string;
  student_id: string;
  student_name: string;
  student_email: string;
  responses: unknown[] | null;
  answers: number[] | null;
  item_scores: ItemScore[] | null;
  needs_grading: boolean | null;
  feedback: string | null;
  score: number;
  total: number;
  started_at: string | null;
  submitted_at: string;
};
export type Quiz = {
  id: string;
  class_id: string;
  kind: 'quiz' | 'exam';
  title: string;
  description: string;
  due_at: string | null;
  time_limit_minutes: number;
  passing_score: number;
  status: 'draft' | 'published';
  created_at: string;
};
export type QuizRow = Quiz & { class: ClassRef | null; questions: number; enrolled: number; attempts: Attempt[] };
export type Question = { id: string; quiz_id: string; position: number; prompt: string; choices: string[]; type: QuestionType; points: number; item_count: number };
export type KeyedQuestion = Question & { correct_index: number | null; answer: AnswerKey };
/** A file attached to an assignment (stored in the private "assignment-files" bucket). */
export type Attachment = { path: string; name: string; size: number; type: string };
export type Assignment = { id: string; class_id: string; title: string; description: string; due_at: string | null; created_at: string; attachments?: Attachment[] };
export type Announcement = { id: string; class_id: string; title: string; message: string; created_at: string };
export type Student = { id: string; class_id: string; email: string; full_name: string };

type Raw = Record<string, unknown>;
const must = <T>(r: { data: T; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
const count = (v: unknown) => (Array.isArray(v) && v[0] && typeof (v[0] as Raw).count === 'number' ? ((v[0] as Raw).count as number) : 0);

/** Classes this instructor teaches (row-level security returns only their own). */
export async function fetchMyClasses(): Promise<ClassRef[]> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Not signed in');
  return must(await supabase.from('classes').select('id, code, title, section').eq('instructor_id', auth.user.id).order('code')) as ClassRef[];
}

export async function fetchQuizzes(): Promise<QuizRow[]> {
  const classes = await fetchMyClasses();
  if (!classes.length) return [];
  const rows = must(
    await supabase
      .from('quizzes')
      .select('*, classes(id, code, title, section, class_students(count)), quiz_questions(count), quiz_attempts(*)')
      .in(
        'class_id',
        classes.map((c) => c.id),
      )
      .order('created_at', { ascending: false }),
  ) as Raw[];
  return rows.map((r) => {
    const cls = r.classes as (ClassRef & { class_students: unknown }) | null;
    return {
      ...(r as unknown as Quiz),
      kind: (r.kind as 'quiz' | 'exam') ?? 'quiz',
      class: cls ? { id: cls.id, code: cls.code, title: cls.title, section: cls.section } : null,
      enrolled: cls ? count(cls.class_students) : 0,
      questions: count(r.quiz_questions),
      attempts: ((r.quiz_attempts as Attempt[]) ?? []).sort((a, b) => a.student_name.localeCompare(b.student_name)),
    };
  });
}

export async function fetchQuizForEdit(id: string) {
  const [quiz, questions, keys, attempts] = await Promise.all([
    supabase.from('quizzes').select('*').eq('id', id).maybeSingle(),
    supabase.from('quiz_questions').select('*').eq('quiz_id', id).order('position'),
    supabase.from('quiz_answer_keys').select('question_id, correct_index, answer').eq('quiz_id', id),
    supabase.from('quiz_attempts').select('id', { count: 'exact', head: true }).eq('quiz_id', id),
  ]);
  const k = new Map((must(keys) as { question_id: string; correct_index: number | null; answer: AnswerKey }[]).map((x) => [x.question_id, x]));
  return {
    quiz: must(quiz) as Quiz | null,
    questions: (must(questions) as Question[]).map((q) => ({ ...q, correct_index: k.get(q.id)?.correct_index ?? null, answer: k.get(q.id)?.answer ?? {} })) as KeyedQuestion[],
    answered: (attempts.count ?? 0) > 0,
  };
}

export type QuestionDraft = { type: QuestionType; prompt: string; choices: string[]; points: number; correct_index: number; answer: AnswerKey };
export type QuizDraft = Omit<Quiz, 'created_at'> & { questions: QuestionDraft[] };

/** Creates or updates a quiz/exam with its questions and answer keys (server validates everything). */
export async function saveQuiz(d: QuizDraft) {
  must(await supabase.rpc('save_quiz', { _payload: d }));
}

export async function deleteQuiz(id: string) {
  must(await supabase.from('quizzes').delete().eq('id', id).select('id'));
}

export async function fetchRoster(classId: string): Promise<Student[]> {
  return must(await supabase.from('class_students').select('id, class_id, email, full_name').eq('class_id', classId).order('full_name')) as Student[];
}

/** One student's answers with questions and keys, for grading essays. */
export async function fetchAttempt(attemptId: string) {
  const attempt = must(await supabase.from('quiz_attempts').select('*').eq('id', attemptId).maybeSingle()) as Attempt | null;
  if (!attempt) return null;
  const { questions } = await fetchQuizForEdit(attempt.quiz_id);
  return { attempt, questions };
}

export async function gradeAttempt(attemptId: string, scores: Record<string, number>, feedback: string) {
  must(await supabase.rpc('grade_attempt', { _attempt_id: attemptId, _scores: scores, _feedback: feedback }));
}

/* ---------- Assignments (tasks) & announcements ---------- */

export async function fetchPosts(classIds: string[]) {
  if (!classIds.length) return { assignments: [] as Assignment[], announcements: [] as Announcement[] };
  const [a, n] = await Promise.all([
    supabase.from('assignments').select('*').in('class_id', classIds).order('created_at', { ascending: false }),
    supabase.from('announcements').select('*').in('class_id', classIds).order('created_at', { ascending: false }),
  ]);
  return { assignments: must(a) as Assignment[], announcements: must(n) as Announcement[] };
}

export const MAX_FILE_MB = 25;
export const ACCEPT_FILES = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.jpg,.jpeg,.png,.webp,.heic,.gif,.zip';

/**
 * Posts an assignment with optional files. Files are uploaded first to <class>/<assignment>/…;
 * if saving the assignment then fails, the uploaded files are removed again.
 */
export async function postAssignment(v: { class_id: string; title: string; description: string; due_at: string | null }, files: File[] = []) {
  const id = crypto.randomUUID();
  const attachments: Attachment[] = [];
  try {
    for (const f of files) {
      const safe = f.name.replace(/[^\w.-]+/g, '_').slice(-80) || 'file';
      const p = `${v.class_id}/${id}/${Date.now()}-${safe}`;
      const { error } = await supabase.storage.from('assignment-files').upload(p, f, { contentType: f.type || 'application/octet-stream', upsert: false });
      if (error) throw new Error(`“${f.name}” didn’t upload: ${error.message}`);
      attachments.push({ path: p, name: f.name, size: f.size, type: f.type });
    }
    must(await supabase.from('assignments').insert({ id, ...v, title: v.title.trim(), description: v.description.trim(), attachments }).select('id'));
  } catch (e) {
    if (attachments.length) await supabase.storage.from('assignment-files').remove(attachments.map((a) => a.path));
    throw e;
  }
}

/** A short-lived download link for an attachment (the bucket is private). */
export async function attachmentUrl(a: Attachment) {
  const { data, error } = await supabase.storage.from('assignment-files').createSignedUrl(a.path, 60 * 10, { download: a.name });
  if (error || !data) throw new Error(error?.message ?? 'Could not open the file');
  return data.signedUrl;
}

export const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export async function postAnnouncement(v: { class_id: string; title: string; message: string }) {
  must(await supabase.from('announcements').insert({ ...v, title: v.title.trim(), message: v.message.trim() }).select('id'));
}
export async function deletePost(table: 'assignments' | 'announcements', id: string, attachments: Attachment[] = []) {
  must(await supabase.from(table).delete().eq('id', id).select('id'));
  if (attachments.length) await supabase.storage.from('assignment-files').remove(attachments.map((a) => a.path));
}

/** "a / b / c" → ["a","b","c"] (alternative accepted answers). */
export const alternatives = (s: string) =>
  s
    .split('/')
    .map((x) => x.trim())
    .filter(Boolean);

/* ---------- Class roster (students) ---------- */

export type ClassWithCount = ClassRef & { description: string; students: number };

/** The instructor's classes with how many students each has. */
export async function fetchMyClassesWithCounts(): Promise<ClassWithCount[]> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Not signed in');
  const rows = must(
    await supabase.from('classes').select('id, code, title, section, description, class_students(count)').eq('instructor_id', auth.user.id).order('code'),
  ) as Raw[];
  return rows.map((r) => ({ ...(r as unknown as ClassRef & { description: string }), students: count(r.class_students) }));
}

/**
 * Adds students by email (the database lower-cases emails and only allows the class's own instructor).
 * Emails already in the class are skipped. Returns how many were added and which were skipped.
 */
export async function addStudents(classId: string, list: { email: string; full_name: string }[]) {
  const existing = new Set((await fetchRoster(classId)).map((s) => s.email.toLowerCase()));
  const seen = new Set<string>();
  const fresh = list
    .map((s) => ({ email: s.email.trim().toLowerCase(), full_name: s.full_name.trim() }))
    .filter((s) => {
      if (existing.has(s.email) || seen.has(s.email)) return false;
      seen.add(s.email);
      return true;
    });
  if (fresh.length) must(await supabase.from('class_students').insert(fresh.map((s) => ({ ...s, class_id: classId }))).select('id'));
  return { added: fresh.length, skipped: list.length - fresh.length };
}

export async function renameStudent(id: string, fullName: string) {
  must(await supabase.from('class_students').update({ full_name: fullName.trim() }).eq('id', id).select('id'));
}

export async function removeStudent(id: string) {
  must(await supabase.from('class_students').delete().eq('id', id).select('id'));
}

/** Basic email check used by the forms. */
export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
