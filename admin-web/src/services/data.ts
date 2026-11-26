import { pct } from './format';
import { supabase } from './supabase';

/* ---------- Types ---------- */

export type Role = 'admin' | 'instructor' | 'student';
export type Profile = { id: string; full_name: string; email: string; student_number: string; status: 'active' | 'suspended'; section_id: string | null; created_at: string };
export type AppStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type InstructorProfile = {
  user_id: string;
  employee_id: string;
  department: string;
  contact_number: string;
  proof_path: string | null;
  status: AppStatus;
  rejection_reason: string;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
};
export type Subject = { id: string; code: string; name: string; department: string; units: number; description: string };
export type Section = { id: string; name: string; program: string; year_level: number; department: string };
export type RoomType = 'lecture' | 'laboratory';
export type Room = { id: string; name: string; building: string; capacity: number | null; room_type: RoomType };
export const ROOM_TYPES: { value: RoomType; label: string; plural: string }[] = [
  { value: 'lecture', label: 'Lecture room', plural: 'Lecture rooms' },
  { value: 'laboratory', label: 'Laboratory', plural: 'Laboratories' },
];
export type Settings = { current_semester: string; current_academic_year: string; semester_start: string | null; semester_end: string | null };
export type OfficialSchedule = {
  id: string;
  instructor_id: string;
  subject_id: string;
  section_id: string;
  room_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  semester: string;
  academic_year: string;
  updated_at: string;
};
export const SEMESTERS = ['1st Semester', '2nd Semester', 'Midyear'] as const;
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export type ClassRow = { id: string; instructor_id: string; code: string; title: string; section: string; description: string; created_at: string };
export type Enrollment = { id: string; class_id: string; email: string; full_name: string; created_at: string };
export type Invitation = { email: string; full_name: string; role: Role; class_id: string | null; created_at: string };
export type Quiz = {
  id: string;
  class_id: string;
  title: string;
  description: string;
  due_at: string | null;
  time_limit_minutes: number;
  passing_score: number;
  status: 'draft' | 'published';
  kind: 'quiz' | 'exam';
  created_at: string;
};
export type Attempt = { id: string; quiz_id: string; student_id: string; student_email: string; score: number; total: number; submitted_at: string };
export type Activity = {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_name: string;
  actor_role: string;
  category: string;
  action: string;
  target: string;
  result: string;
};

/** A row in Users & roles: a registered account, or an invitation that hasn't signed up yet. */
export type UserRow = {
  id: string | null;
  name: string;
  email: string;
  role: Role | 'none';
  isAdmin: boolean;
  section: string;
  status: 'Active' | 'Suspended' | 'Invited';
  /** Instructor application not yet approved. */
  application: AppStatus | null;
  student_number: string;
  created_at: string;
};

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

/* ---------- Small hook for loading data ---------- */

// Kept here so existing pages can keep importing it from services/data.
export { useData } from '../hooks/useData';

/* ---------- Workspace snapshot (everything the admin pages read) ---------- */

export type Workspace = {
  profiles: Profile[];
  roles: { user_id: string; role: Role }[];
  invitations: Invitation[];
  classes: ClassRow[];
  enrollments: Enrollment[];
  quizzes: Quiz[];
  attempts: Attempt[];
  assignments: { id: string; class_id: string; created_at: string }[];
  instructorProfiles: InstructorProfile[];
  subjects: Subject[];
  sections: Section[];
  rooms: Room[];
  settings: Settings;
  schedules: OfficialSchedule[];
};

export async function fetchWorkspace(): Promise<Workspace> {
  const [profiles, roles, invitations, classes, enrollments, quizzes, attempts, assignments, ip, subjects, sections, rooms, settings, schedules] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email, student_number, status, section_id, created_at').order('full_name'),
    supabase.from('user_roles').select('user_id, role'),
    supabase.from('invitations').select('*').order('created_at', { ascending: false }),
    supabase.from('classes').select('*').order('code'),
    supabase.from('class_students').select('*').order('full_name'),
    supabase.from('quizzes').select('*').order('created_at', { ascending: false }),
    supabase.from('quiz_attempts').select('id, quiz_id, student_id, student_email, score, total, submitted_at'),
    supabase.from('assignments').select('id, class_id, created_at'),
    supabase.from('instructor_profiles').select('*').order('submitted_at', { ascending: false }),
    supabase.from('subjects').select('*').order('code'),
    supabase.from('sections').select('*').order('year_level').order('name'),
    supabase.from('rooms').select('*').order('name'),
    supabase.from('app_settings').select('current_semester, current_academic_year, semester_start, semester_end').maybeSingle(),
    supabase.from('instructor_schedules').select('*').order('day_of_week').order('start_time'),
  ]);
  return {
    profiles: must(profiles) as Profile[],
    roles: must(roles) as Workspace['roles'],
    invitations: must(invitations) as Invitation[],
    classes: must(classes) as ClassRow[],
    enrollments: must(enrollments) as Enrollment[],
    quizzes: must(quizzes) as Quiz[],
    attempts: must(attempts) as Attempt[],
    assignments: must(assignments) as Workspace['assignments'],
    instructorProfiles: must(ip) as InstructorProfile[],
    subjects: must(subjects) as Subject[],
    sections: must(sections) as Section[],
    rooms: must(rooms) as Room[],
    settings: (must(settings) as Settings | null) ?? { current_semester: SEMESTERS[0], current_academic_year: '', semester_start: null, semester_end: null },
    schedules: must(schedules) as OfficialSchedule[],
  };
}

export const classLabel = (c: Pick<ClassRow, 'code' | 'section'> | undefined | null) =>
  c ? (c.section ? `${c.code} · ${c.section}` : c.code) : '—';

export function nameOf(w: Workspace, id: string | null | undefined) {
  const p = w.profiles.find((x) => x.id === id);
  return p ? p.full_name || p.email : '—';
}

export function rolesOf(w: Workspace, id: string) {
  return w.roles.filter((r) => r.user_id === id).map((r) => r.role);
}

export function userRows(w: Workspace): UserRow[] {
  const rows: UserRow[] = w.profiles.map((p) => {
    const roles = rolesOf(w, p.id);
    const role: UserRow['role'] = roles.includes('instructor') ? 'instructor' : roles.includes('student') ? 'student' : roles.includes('admin') ? 'admin' : 'none';
    const app = w.instructorProfiles.find((x) => x.user_id === p.id);
    const ownSection = w.sections.find((x) => x.id === p.section_id)?.name;
    const section =
      role === 'student' && ownSection
        ? ownSection
        : role === 'instructor'
        ? [...new Set(w.classes.filter((c) => c.instructor_id === p.id).map((c) => c.code))].join(', ')
        : [...new Set(w.enrollments.filter((e) => e.email === p.email).map((e) => w.classes.find((c) => c.id === e.class_id)?.section).filter(Boolean))].join(', ');
    return {
      id: p.id,
      name: p.full_name || p.email,
      email: p.email,
      role,
      isAdmin: roles.includes('admin'),
      section: section || '—',
      status: p.status === 'suspended' ? 'Suspended' : 'Active',
      application: app && (app.status === 'suspended' || (app.status !== 'approved' && role !== 'instructor')) ? app.status : null,
      student_number: p.student_number,
      created_at: p.created_at,
    };
  });
  for (const inv of w.invitations) {
    if (rows.some((r) => r.email === inv.email)) continue;
    const cls = w.classes.find((c) => c.id === inv.class_id);
    rows.push({
      id: null,
      name: inv.full_name || inv.email,
      email: inv.email,
      role: inv.role,
      isAdmin: false,
      section: cls ? (inv.role === 'instructor' ? cls.code : cls.section || cls.code) : '—',
      status: 'Invited',
      application: null,
      student_number: '',
      created_at: inv.created_at,
    });
  }
  return rows;
}

/** Published quizzes in a class and how the enrolled students did. */
export function classStats(w: Workspace, classId: string) {
  const students = w.enrollments.filter((e) => e.class_id === classId);
  const quizzes = w.quizzes.filter((q) => q.class_id === classId && q.status === 'published');
  const quizIds = new Set(quizzes.map((q) => q.id));
  const attempts = w.attempts.filter((a) => quizIds.has(a.quiz_id));
  const avgScore = attempts.length ? attempts.reduce((s, a) => s + pct(a.score, a.total), 0) / attempts.length : null;
  const expected = students.length * quizzes.length;
  const completion = expected ? (attempts.length / expected) * 100 : null;
  return { students, quizzes, attempts, avgScore, completion };
}

/** Average score of one student (by email) across a class's approved quizzes. */
export function studentScore(w: Workspace, classId: string, email: string) {
  const ids = new Set(w.quizzes.filter((q) => q.class_id === classId).map((q) => q.id));
  const mine = w.attempts.filter((a) => ids.has(a.quiz_id) && a.student_email === email);
  return mine.length ? mine.reduce((s, a) => s + pct(a.score, a.total), 0) / mine.length : null;
}

/* ---------- Writes ---------- */

export async function updateUser(id: string, patch: { full_name: string; student_number: string; status: 'active' | 'suspended' }) {
  must(await supabase.from('profiles').update(patch).eq('id', id).select('id'));
}

export async function setRole(id: string, role: 'instructor' | 'student') {
  must(await supabase.rpc('admin_set_role', { _user_id: id, _role: role }));
}

export async function inviteUser(v: { email: string; full_name: string; role: 'instructor' | 'student'; class_id: string | null }) {
  const email = v.email.trim().toLowerCase();
  const existing = must(await supabase.from('profiles').select('id').eq('email', email).maybeSingle());
  if (existing) throw new Error('This email already has an account. Open it from the list to change its role.');
  must(await supabase.from('invitations').upsert({ ...v, email, full_name: v.full_name.trim() }).select('email'));
  if (v.role === 'student' && v.class_id) {
    must(await supabase.from('class_students').upsert({ class_id: v.class_id, email, full_name: v.full_name.trim() }, { onConflict: 'class_id,email' }).select('id'));
  }
}

export async function cancelInvitation(email: string) {
  must(await supabase.from('invitations').delete().eq('email', email).select('email'));
}

export async function updateClass(id: string, patch: Partial<Pick<ClassRow, 'section' | 'instructor_id' | 'title' | 'code'>>) {
  must(await supabase.from('classes').update(patch).eq('id', id).select('id'));
}

export async function setClassRoom(classId: string, room: string) {
  must(await supabase.from('class_schedules').update({ room: room.trim() }).eq('class_id', classId).select('id'));
}

/** Enrolls by university email or student number. */
export async function enrollStudent(w: Workspace, classId: string, who: string) {
  const q = who.trim().toLowerCase();
  const p = w.profiles.find((x) => x.email === q || (x.student_number && x.student_number.toLowerCase() === q));
  const email = p?.email ?? (q.includes('@') ? q : null);
  if (!email) throw new Error('No student has that student number. Enter their university email instead.');
  if (p && rolesOf(w, p.id).includes('instructor')) throw new Error('That account is an instructor, not a student.');
  must(
    await supabase
      .from('class_students')
      .insert({ class_id: classId, email, full_name: p?.full_name ?? '' })
      .select('id'),
  );
  return p?.full_name || email;
}

export async function removeEnrollment(id: string) {
  must(await supabase.from('class_students').delete().eq('id', id).select('id'));
}


export async function fetchActivity(sinceIso: string): Promise<Activity[]> {
  return must(await supabase.from('activity_log').select('*').gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(1000)) as Activity[];
}

/* ---------- Instructor verification ---------- */

export async function reviewInstructor(userId: string, approve: boolean, reason: string) {
  must(await supabase.rpc('review_instructor', { _user_id: userId, _approve: approve, _reason: reason }));
}

/** Suspend (reason required) or reactivate an approved instructor. Admin-only; checked and recorded by the database. */
export async function setInstructorSuspension(userId: string, suspend: boolean, reason: string) {
  must(await supabase.rpc('set_instructor_suspension', { _user_id: userId, _suspend: suspend, _reason: reason }));
}

/** Short-lived link to a private proof document (admins only, enforced by storage rules). */
export async function proofUrl(path: string) {
  const { data, error } = await supabase.storage.from('instructor-proofs').createSignedUrl(path, 300);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function fetchVerificationHistory(userId: string) {
  return must(
    await supabase.from('instructor_verifications').select('decision, reason, decided_by, decided_at').eq('user_id', userId).order('decided_at', { ascending: false }),
  ) as { decision: string; reason: string; decided_by: string | null; decided_at: string }[];
}

export const isApprovedInstructor = (w: Workspace, id: string) =>
  rolesOf(w, id).includes('instructor') &&
  w.instructorProfiles.some((p) => p.user_id === id && p.status === 'approved') &&
  w.profiles.find((p) => p.id === id)?.status === 'active';

/* ---------- Subjects, sections, rooms, settings ---------- */

const friendly = (m: string) =>
  /duplicate key/.test(m)
    ? 'That code or name is already used.'
    : /foreign key|violates.*restrict/i.test(m)
      ? 'It is still used by a schedule. Remove or reassign those schedules first.'
      : m;

async function write<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>) {
  const r = await p;
  if (r.error) throw new Error(friendly(r.error.message));
  return r.data as T;
}

export const saveSubject = (v: Omit<Subject, 'id'> & { id?: string }) =>
  v.id ? write(supabase.from('subjects').update(v).eq('id', v.id).select('id')) : write(supabase.from('subjects').insert(v).select('id'));
export const deleteSubject = (id: string) => write(supabase.from('subjects').delete().eq('id', id).select('id'));

export const saveSection = (v: Omit<Section, 'id'> & { id?: string }) =>
  v.id ? write(supabase.from('sections').update(v).eq('id', v.id).select('id')) : write(supabase.from('sections').insert(v).select('id'));
export const deleteSection = (id: string) => write(supabase.from('sections').delete().eq('id', id).select('id'));

export const saveRoom = (v: Omit<Room, 'id'> & { id?: string }) =>
  v.id ? write(supabase.from('rooms').update(v).eq('id', v.id).select('id')) : write(supabase.from('rooms').insert(v).select('id'));
export const deleteRoom = (id: string) => write(supabase.from('rooms').delete().eq('id', id).select('id'));

export const saveSettings = (v: Settings) => write(supabase.from('app_settings').update(v).eq('id', true).select('id'));

/** Puts a student in a section (or removes them with null). */
export const setStudentSection = (profileId: string, sectionId: string | null) =>
  write(supabase.from('profiles').update({ section_id: sectionId }).eq('id', profileId).select('id'));

/* ---------- Official schedules ---------- */

export type ScheduleInput = Omit<OfficialSchedule, 'id' | 'updated_at'> & { id?: string };

/** Creates or updates one schedule; the database rejects conflicts with a readable message. */
export async function saveSchedule(v: ScheduleInput) {
  const row = { ...v, start_time: v.start_time.slice(0, 5), end_time: v.end_time.slice(0, 5) };
  const r = v.id
    ? await supabase.from('instructor_schedules').update(row).eq('id', v.id).select('id')
    : await supabase.from('instructor_schedules').insert(row).select('id');
  if (r.error) {
    const m = r.error.message;
    throw new Error(
      /no_instructor_overlap/.test(m)
        ? 'Schedule conflict: this instructor already has a class at that time.'
        : /no_room_overlap/.test(m)
          ? 'Room conflict: the room is already used at that time.'
          : /no_section_overlap/.test(m)
            ? 'Section conflict: this section already has a class at that time.'
            : /time_order/.test(m)
              ? 'End time must be later than start time.'
              : m,
    );
  }
}

export const deleteSchedule = (id: string) => write(supabase.from('instructor_schedules').delete().eq('id', id).select('id'));
