-- ============================================================================
-- CvSU Classroom Management System — database schema
-- Generated on 2026-11-27 from the live Supabase project (final state, no history).
-- Run once on an empty Supabase project (SQL Editor, or `supabase db push`).
-- Contents: 30 tables, 90 functions, 53 triggers, 71 policies.
-- Data is not included, except the one settings row the app needs.
-- ============================================================================

SET check_function_bodies = false;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;


-- ============================================================================
-- Types
-- ============================================================================
CREATE TYPE public.app_role AS ENUM ('instructor', 'student', 'admin');


-- ============================================================================
-- Range types
-- ============================================================================
CREATE TYPE public.timerange AS RANGE (subtype = time without time zone);


-- ============================================================================
-- Functions (bodies are checked when they run, so order does not matter)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_delete_instructor(_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  _name text;
  _sched int;
  _classes int;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only administrators can delete instructors.'; END IF;
  IF _user_id = auth.uid() THEN RAISE EXCEPTION 'You can''t delete your own account.'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role::text = 'admin') THEN
    RAISE EXCEPTION 'This account is an administrator and can''t be deleted here.';
  END IF;
  SELECT COALESCE(NULLIF(full_name, ''), email) INTO _name FROM public.profiles WHERE id = _user_id;
  IF _name IS NULL THEN RAISE EXCEPTION 'Instructor not found.'; END IF;

  SELECT count(*) INTO _sched FROM public.instructor_schedules s
    JOIN public.semesters t ON t.status = 'active' AND t.semester = s.semester AND t.academic_year = s.academic_year
    WHERE s.instructor_id = _user_id;
  IF _sched > 0 THEN
    RAISE EXCEPTION '% still has % class time(s) on this semester''s schedule. Remove or reassign them in Schedules first.', _name, _sched;
  END IF;

  PERFORM set_config('cms.account_cleanup', 'on', true);  -- this transaction only

  -- Current (live) classes go with the account; archived semesters keep their copies and the name.
  SELECT count(*) INTO _classes FROM public.classes WHERE instructor_id = _user_id AND archived_at IS NULL;
  DELETE FROM public.classes WHERE instructor_id = _user_id AND archived_at IS NULL;

  -- References that would otherwise block deleting the login.
  UPDATE public.announcements SET posted_by = NULL WHERE posted_by = _user_id;
  UPDATE public.attendance_sessions SET taken_by = NULL WHERE taken_by = _user_id;
  UPDATE public.omr_scans SET created_by = NULL WHERE created_by = _user_id;
  UPDATE public.omr_scans SET finalized_by = NULL WHERE finalized_by = _user_id;
  UPDATE public.omr_sheets SET created_by = NULL WHERE created_by = _user_id;
  UPDATE public.instructor_profiles SET reviewed_by = NULL WHERE reviewed_by = _user_id;
  UPDATE public.instructor_verifications SET decided_by = NULL WHERE decided_by = _user_id;
  UPDATE public.app_settings SET updated_by = NULL WHERE updated_by = _user_id;

  -- The login itself (profile, roles, application, notifications and old schedules follow).
  DELETE FROM auth.users WHERE id = _user_id;

  PERFORM public.log_activity('user', 'Instructor deleted', _name, _classes || ' current class(es) removed');
  RETURN jsonb_build_object('name', _name, 'classes_removed', _classes);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_save_instructor(_user_id uuid, _full_name text, _employee_id text, _department text, _contact_number text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only administrators can edit instructors.'; END IF;
  IF trim(coalesce(_full_name, '')) = '' THEN RAISE EXCEPTION 'Enter the instructor''s full name.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id) THEN RAISE EXCEPTION 'Instructor not found.'; END IF;
  IF trim(coalesce(_employee_id, '')) <> '' AND EXISTS (
    SELECT 1 FROM public.instructor_profiles WHERE lower(trim(employee_id)) = lower(trim(_employee_id)) AND user_id <> _user_id
  ) THEN
    RAISE EXCEPTION 'Employee ID % is already used by another instructor.', trim(_employee_id);
  END IF;

  UPDATE public.profiles SET full_name = trim(_full_name), updated_at = now() WHERE id = _user_id;
  INSERT INTO public.instructor_profiles (user_id, employee_id, department, contact_number, status, reviewed_by, reviewed_at)
  VALUES (_user_id, trim(coalesce(_employee_id, '')), trim(coalesce(_department, '')), trim(coalesce(_contact_number, '')), 'approved', auth.uid(), now())
  ON CONFLICT (user_id) DO UPDATE SET employee_id = EXCLUDED.employee_id, department = EXCLUDED.department,
    contact_number = EXCLUDED.contact_number, updated_at = now();
  PERFORM public.log_activity('user', 'Instructor details updated', trim(_full_name));
END;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_set_role(_user_id uuid, _role app_role)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _changed boolean;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only administrators can change roles'; END IF;
  IF _role::text NOT IN ('instructor', 'student') THEN RAISE EXCEPTION 'Choose Instructor or Student'; END IF;
  _changed := NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
  DELETE FROM public.user_roles WHERE user_id = _user_id AND role::text IN ('instructor', 'student') AND role <> _role;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role) ON CONFLICT DO NOTHING;
  IF _role::text = 'instructor' THEN
    INSERT INTO public.instructor_profiles (user_id, status, reviewed_by, reviewed_at)
    VALUES (_user_id, 'approved', auth.uid(), now())
    ON CONFLICT (user_id) DO UPDATE SET status = 'approved', rejection_reason = '', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now();
    IF _changed THEN
      INSERT INTO public.instructor_verifications (user_id, decision, reason, decided_by)
      VALUES (_user_id, 'approved', 'Role set to Instructor by an administrator', auth.uid());
      PERFORM public.notify(_user_id, 'application', 'Instructor access granted', 'An administrator gave your account instructor access.');
    END IF;
  ELSIF _changed THEN
    UPDATE public.instructor_profiles SET status = 'rejected', rejection_reason = 'Role changed to Student by an administrator',
      reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    WHERE user_id = _user_id AND status <> 'rejected';
  END IF;
  IF _changed THEN
    PERFORM public.log_activity('user', 'Role changed to ' || _role::text,
      COALESCE((SELECT NULLIF(full_name, '') FROM public.profiles WHERE id = _user_id), (SELECT email FROM public.profiles WHERE id = _user_id)));
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.answer_matches(_given text, _accepted jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT public.norm_answer(_given) <> '' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(_accepted, '[]'::jsonb)) a WHERE public.norm_answer(a) = public.norm_answer(_given))
$function$
;
CREATE OR REPLACE FUNCTION public.archive_class_snapshot(_class uuid, _sem semesters)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'class', to_jsonb(c),
    'semester', jsonb_build_object('id', _sem.id, 'semester', _sem.semester, 'academic_year', _sem.academic_year, 'starts_on', _sem.starts_on, 'ends_on', _sem.ends_on),
    'subject', (SELECT to_jsonb(s) FROM public.subjects s WHERE s.id = c.subject_id),
    'section', (SELECT to_jsonb(x) FROM public.sections x WHERE x.id = c.section_id),
    'instructor', (SELECT jsonb_build_object('id', p.id, 'full_name', p.full_name, 'email', p.email, 'employee_id', ip.employee_id, 'department', ip.department)
                   FROM public.profiles p LEFT JOIN public.instructor_profiles ip ON ip.user_id = p.id WHERE p.id = c.instructor_id),
    'schedule', COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'day_of_week', x->>'start_time') FROM (
        SELECT jsonb_build_object('day_of_week', s.day_of_week, 'start_time', s.start_time, 'end_time', s.end_time, 'room', COALESCE(r.name, ''), 'extra', false) AS x
        FROM public.instructor_schedules s LEFT JOIN public.rooms r ON r.id = s.room_id
        WHERE s.subject_id = c.subject_id AND s.section_id = c.section_id AND s.instructor_id = c.instructor_id
          AND s.semester = _sem.semester AND s.academic_year = _sem.academic_year
        UNION ALL
        SELECT jsonb_build_object('day_of_week', cs.day_of_week, 'start_time', cs.start_time, 'end_time', cs.end_time, 'room', cs.room, 'extra', true)
        FROM public.class_schedules cs WHERE cs.class_id = c.id
      ) q), '[]'::jsonb),
    'students', COALESCE((SELECT jsonb_agg(jsonb_build_object('email', lower(cs.email), 'full_name', cs.full_name, 'student_number', COALESCE(p.student_number, ''), 'enrolled_at', cs.created_at) ORDER BY cs.full_name)
                          FROM public.class_students cs LEFT JOIN public.profiles p ON lower(p.email) = lower(cs.email) WHERE cs.class_id = c.id), '[]'::jsonb),
    'quizzes', COALESCE((SELECT jsonb_agg(to_jsonb(q) || jsonb_build_object(
                  'questions', COALESCE((SELECT jsonb_agg(to_jsonb(qq) ORDER BY qq.position) FROM public.quiz_questions qq WHERE qq.quiz_id = q.id), '[]'::jsonb),
                  'answer_keys', COALESCE((SELECT jsonb_agg(to_jsonb(k)) FROM public.quiz_answer_keys k WHERE k.quiz_id = q.id), '[]'::jsonb),
                  'attempts', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.student_name) FROM public.quiz_attempts a WHERE a.quiz_id = q.id), '[]'::jsonb)
                ) ORDER BY q.created_at) FROM public.quizzes q WHERE q.class_id = c.id), '[]'::jsonb),
    'assignments', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at) FROM public.assignments a WHERE a.class_id = c.id), '[]'::jsonb),
    'announcements', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC) FROM public.announcements a WHERE a.class_id = c.id), '[]'::jsonb),
    'attendance', COALESCE((SELECT jsonb_agg(to_jsonb(s) || jsonb_build_object(
                  'records', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.student_name) FROM public.attendance_records r WHERE r.session_id = s.id), '[]'::jsonb)
                ) ORDER BY s.session_date) FROM public.attendance_sessions s WHERE s.class_id = c.id), '[]'::jsonb),
    'omr_sheets', COALESCE((SELECT jsonb_agg(to_jsonb(o)) FROM public.omr_sheets o WHERE o.class_id = c.id), '[]'::jsonb),
    'omr_scans', COALESCE((SELECT jsonb_agg(to_jsonb(o)) FROM public.omr_scans o WHERE o.class_id = c.id), '[]'::jsonb)
  )
  FROM public.classes c WHERE c.id = _class
$function$
;
CREATE OR REPLACE FUNCTION public.archive_student_snapshot(_snap jsonb, _email text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT jsonb_build_object(
    'class', jsonb_build_object('code', _snap->'class'->>'code', 'title', _snap->'class'->>'title', 'section', _snap->'class'->>'section', 'description', _snap->'class'->>'description'),
    'semester', _snap->'semester',
    'subject', _snap->'subject',
    'instructor', jsonb_build_object('full_name', _snap->'instructor'->>'full_name', 'email', _snap->'instructor'->>'email', 'department', _snap->'instructor'->>'department'),
    'schedule', _snap->'schedule',
    'announcements', _snap->'announcements',
    'assignments', _snap->'assignments',
    'quizzes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', q->>'id', 'title', q->>'title', 'kind', q->>'kind', 'due_at', q->'due_at', 'passing_score', q->'passing_score',
        'attempt', (SELECT a FROM jsonb_array_elements(q->'attempts') a WHERE lower(a->>'student_email') = _email LIMIT 1)))
      FROM jsonb_array_elements(_snap->'quizzes') q WHERE q->>'status' = 'published'), '[]'::jsonb),
    'attendance', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('date', s->>'session_date', 'status', r->>'status') ORDER BY s->>'session_date')
      FROM jsonb_array_elements(_snap->'attendance') s, jsonb_array_elements(s->'records') r
      WHERE lower(r->>'student_email') = _email), '[]'::jsonb)
  )
$function$
;
CREATE OR REPLACE FUNCTION public.assignment_file_class(_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
BEGIN
  RETURN split_part(_name, '/', 1)::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.can_manage_quiz(_quiz_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.quizzes q JOIN public.classes c ON c.id = q.class_id
                 WHERE q.id = _quiz_id AND c.instructor_id = auth.uid() AND c.archived_at IS NULL)
$function$
;
CREATE OR REPLACE FUNCTION public.can_take_quiz(_quiz_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.quizzes q WHERE q.id = _quiz_id AND q.status = 'published' AND public.is_class_student(q.class_id))
$function$
;
CREATE OR REPLACE FUNCTION public.choose_my_section(_section_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _sec public.sections;
  _p public.profiles;
BEGIN
  SELECT * INTO _sec FROM public.sections WHERE id = _section_id;
  IF _sec.id IS NULL THEN RAISE EXCEPTION 'That section does not exist'; END IF;
  SELECT * INTO _p FROM public.profiles WHERE id = auth.uid();
  PERFORM public.submit_renewal(jsonb_build_object('full_name', COALESCE(NULLIF(_p.full_name, ''), _p.email), 'program', COALESCE(NULLIF(_sec.program, ''), 'Not given'),
                                                   'year_level', _sec.year_level, 'section_id', _sec.id, 'confirmed', true));
END;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_role(_role app_role)
 RETURNS app_role
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _result public.app_role;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;
  IF _role::text NOT IN ('instructor', 'student') THEN
    RAISE EXCEPTION 'Choose Instructor or Student';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(_uid::text));
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role::text IN ('instructor', 'student'))
     AND NOT EXISTS (SELECT 1 FROM public.instructor_profiles WHERE user_id = _uid) THEN
    IF _role::text = 'instructor' THEN
      INSERT INTO public.instructor_profiles (user_id, status) VALUES (_uid, 'pending');
      PERFORM public.log_activity('verification', 'Instructor application started', COALESCE((SELECT email FROM public.profiles WHERE id = _uid), ''), 'Pending');
    ELSE
      INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'student');
    END IF;
  END IF;
  SELECT role INTO _result FROM public.user_roles WHERE user_id = _uid AND role::text IN ('instructor', 'student')
  ORDER BY (role::text = 'instructor') DESC LIMIT 1;
  RETURN _result; -- NULL while an instructor application is pending
END;
$function$
;
CREATE OR REPLACE FUNCTION public.class_label(_class_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT trim(code || CASE WHEN section <> '' THEN ', ' || section ELSE '' END) FROM public.classes WHERE id = _class_id
$function$
;
CREATE OR REPLACE FUNCTION public.classes_from_subject_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.subject_id IS NULL OR NEW.section_id IS NULL THEN
    RAISE EXCEPTION 'Classes are created from Subjects. Add a Schedule for the subject, section and instructor and its class is made automatically.';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.classes_keep_scheduled()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.archived_at IS NULL AND OLD.subject_id IS NOT NULL AND OLD.section_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.instructor_schedules s JOIN public.semesters t ON t.status = 'active' AND t.semester = s.semester AND t.academic_year = s.academic_year
    WHERE s.subject_id = OLD.subject_id AND s.section_id = OLD.section_id AND s.instructor_id = OLD.instructor_id
  ) THEN
    RAISE EXCEPTION 'This class is on the official schedule (% · %). Ask the administrator to remove its schedule first.', OLD.code, OLD.section;
  END IF;
  RETURN OLD;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.classes_no_duplicate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.archived_at IS NULL AND EXISTS (
    SELECT 1 FROM public.classes c
    WHERE c.id <> NEW.id AND c.instructor_id = NEW.instructor_id AND c.archived_at IS NULL
      AND lower(trim(c.code)) = lower(trim(NEW.code)) AND lower(trim(c.section)) = lower(trim(NEW.section))
  ) THEN
    RAISE EXCEPTION 'This class already exists: % · % for this instructor. Open the existing class instead.', NEW.code, NEW.section;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.current_email()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$ SELECT lower(COALESCE(auth.jwt()->>'email', '')) $function$
;
CREATE OR REPLACE FUNCTION public.current_semester_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id FROM public.semesters WHERE status = 'active' LIMIT 1
$function$
;
CREATE OR REPLACE FUNCTION public.day_label(_d integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT (ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])[_d]
$function$
;
CREATE OR REPLACE FUNCTION public.end_semester(_semester_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _sem public.semesters;
  _summary jsonb;
  _admin_name text;
  _classes int;
  _archived int;
  _enrollments int;
  _student_rows int;
  _schedules_removed int;
  _sections_removed int;
  _students_renew int;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only administrators can end a semester.'; END IF;

  -- Lock the semester row: a second click waits here and then sees it is already Completed.
  SELECT * INTO _sem FROM public.semesters WHERE id = _semester_id FOR UPDATE;
  IF _sem.id IS NULL THEN RAISE EXCEPTION 'Semester not found.'; END IF;
  IF _sem.status <> 'active' THEN RAISE EXCEPTION '% AY % has already been ended.', _sem.semester, _sem.academic_year; END IF;
  IF EXISTS (SELECT 1 FROM public.semester_archives WHERE semester_id = _sem.id) THEN
    RAISE EXCEPTION 'This semester has already been archived.';
  END IF;

  _summary := public.semester_end_preview();
  SELECT COALESCE(NULLIF(full_name, ''), email) INTO _admin_name FROM public.profiles WHERE id = auth.uid();

  -- 1) Full class snapshots.
  INSERT INTO public.semester_class_archives (semester_id, class_id, instructor_id, code, title, section, instructor_name, student_count, data)
  SELECT _sem.id, c.id, c.instructor_id, c.code, c.title, c.section,
         COALESCE((SELECT COALESCE(NULLIF(p.full_name, ''), p.email) FROM public.profiles p WHERE p.id = c.instructor_id), ''),
         (SELECT count(*) FROM public.class_students cs WHERE cs.class_id = c.id),
         public.archive_class_snapshot(c.id, _sem)
  FROM public.classes c WHERE c.semester_id = _sem.id AND c.archived_at IS NULL;

  -- 2) Each student's own copy.
  INSERT INTO public.semester_student_archives (semester_id, class_id, student_email, student_name, code, title, section, instructor_name, data)
  SELECT _sem.id, a.class_id, lower(st->>'email'), COALESCE(st->>'full_name', ''), a.code, a.title, a.section, a.instructor_name,
         public.archive_student_snapshot(a.data, lower(st->>'email'))
  FROM public.semester_class_archives a, jsonb_array_elements(a.data->'students') st
  WHERE a.semester_id = _sem.id
  ON CONFLICT (semester_id, class_id, student_email) DO NOTHING;

  -- 3) Verify the copy is complete before anything is marked Completed.
  SELECT count(*) INTO _classes FROM public.classes WHERE semester_id = _sem.id AND archived_at IS NULL;
  SELECT count(*) INTO _archived FROM public.semester_class_archives WHERE semester_id = _sem.id;
  SELECT count(DISTINCT (cs.class_id, lower(cs.email))) INTO _enrollments
    FROM public.class_students cs JOIN public.classes c ON c.id = cs.class_id WHERE c.semester_id = _sem.id AND c.archived_at IS NULL;
  SELECT count(*) INTO _student_rows FROM public.semester_student_archives WHERE semester_id = _sem.id;
  IF _archived <> _classes OR _student_rows <> _enrollments THEN
    RAISE EXCEPTION 'Archiving check failed (% of % classes, % of % student records). Nothing was changed.', _archived, _classes, _student_rows, _enrollments;
  END IF;

  -- 4) Lock the original classes (read-only, hidden from the live app) and complete the semester.
  UPDATE public.classes SET archived_at = now() WHERE semester_id = _sem.id AND archived_at IS NULL;
  UPDATE public.semesters SET status = 'completed', ended_at = now(), ended_by = auth.uid(), ended_by_name = COALESCE(_admin_name, '') WHERE id = _sem.id;
  INSERT INTO public.semester_archives (semester_id, summary, archived_by, archived_by_name)
  VALUES (_sem.id, _summary || jsonb_build_object('archived_classes', _archived, 'archived_student_records', _student_rows), auth.uid(), COALESCE(_admin_name, ''));

  -- 5) Fresh start: subjects, sections, rooms and every account carry over.
  --    The ended semester's schedules are removed (the archive keeps a copy), and every student renews
  --    by choosing their section again for the next semester.
  DELETE FROM public.instructor_schedules WHERE semester = _sem.semester AND academic_year = _sem.academic_year;
  GET DIAGNOSTICS _schedules_removed = ROW_COUNT;

  SELECT count(*) INTO _students_renew FROM public.profiles WHERE section_id IS NOT NULL;
  UPDATE public.profiles SET section_id = NULL WHERE section_id IS NOT NULL;

  _sections_removed := 0;  -- sections stay for the next semester

  -- Students and instructors are told by trg_semester_closed (renewal for the next semester opens now).

  UPDATE public.semester_archives
  SET summary = summary || jsonb_build_object('schedules_removed', _schedules_removed, 'sections_removed', _sections_removed, 'students_to_renew', _students_renew)
  WHERE semester_id = _sem.id;

  PERFORM public.log_activity('settings', 'Ended semester', _sem.semester || ', AY ' || _sem.academic_year,
                              _archived || ' classes archived', auth.uid());
  RETURN _summary || jsonb_build_object('archived_classes', _archived, 'archived_student_records', _student_rows,
    'schedules_removed', _schedules_removed, 'sections_removed', _sections_removed, 'students_to_renew', _students_renew);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.ensure_schedule_class(_subject uuid, _section uuid, _instructor uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _cls uuid;
  _sub public.subjects;
  _sec public.sections;
BEGIN
  SELECT * INTO _sub FROM public.subjects WHERE id = _subject;
  SELECT * INTO _sec FROM public.sections WHERE id = _section;
  IF _sub.id IS NULL OR _sec.id IS NULL OR _instructor IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO _cls FROM public.classes
  WHERE subject_id = _subject AND section_id = _section AND instructor_id = _instructor AND archived_at IS NULL;
  IF _cls IS NULL THEN
    SELECT id INTO _cls FROM public.classes
    WHERE instructor_id = _instructor AND archived_at IS NULL
      AND lower(trim(code)) = lower(trim(_sub.code)) AND lower(trim(section)) = lower(trim(_sec.name))
    ORDER BY created_at LIMIT 1;
    IF _cls IS NOT NULL THEN
      UPDATE public.classes SET subject_id = _subject, section_id = _section, title = _sub.name WHERE id = _cls;
    ELSE
      INSERT INTO public.classes (instructor_id, code, title, section, description, subject_id, section_id)
      VALUES (_instructor, _sub.code, _sub.name, _sec.name, COALESCE(_sub.description, ''), _subject, _section)
      RETURNING id INTO _cls;
    END IF;
  END IF;

  INSERT INTO public.class_students (class_id, email, full_name, auto)
  SELECT _cls, lower(p.email), p.full_name, true
  FROM public.profiles p
  WHERE p.section_id = _section AND p.email <> '' AND public.has_role(p.id, 'student')
  ON CONFLICT (class_id, email) DO NOTHING;
  RETURN _cls;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.grade_attempt(_attempt_id uuid, _scores jsonb, _feedback text DEFAULT ''::text)
 RETURNS quiz_attempts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _row public.quiz_attempts;
  _new jsonb := '[]'::jsonb;
  _it jsonb;
  _qid text;
  _given integer;
  _title text;
BEGIN
  SELECT * INTO _row FROM public.quiz_attempts WHERE id = _attempt_id;
  IF NOT FOUND OR NOT public.can_manage_quiz(_row.quiz_id) THEN
    RAISE EXCEPTION 'Only the class instructor can grade this';
  END IF;
  FOR _it IN SELECT * FROM jsonb_array_elements(_row.item_scores) LOOP
    _qid := _it->>'question_id';
    IF (SELECT type FROM public.quiz_questions WHERE id = _qid::uuid) = 'essay' AND _scores ? _qid THEN
      _given := (_scores->>_qid)::int;
      IF _given < 0 OR _given > (_it->>'max')::int THEN
        RAISE EXCEPTION 'Essay points must be between 0 and %', _it->>'max';
      END IF;
      _it := _it || jsonb_build_object('points', _given, 'pending', false);
    END IF;
    _new := _new || _it;
  END LOOP;
  UPDATE public.quiz_attempts SET
    item_scores = _new,
    score = (SELECT COALESCE(sum((x->>'points')::int), 0) FROM jsonb_array_elements(_new) x),
    needs_grading = EXISTS (SELECT 1 FROM jsonb_array_elements(_new) x WHERE (x->>'pending')::boolean),
    graded_at = now(),
    feedback = trim(COALESCE(_feedback, ''))
  WHERE id = _attempt_id
  RETURNING * INTO _row;
  SELECT title INTO _title FROM public.quizzes WHERE id = _row.quiz_id;
  IF NOT _row.needs_grading THEN
    PERFORM public.notify(_row.student_id, 'grade', 'Your answers were graded', _title || ': ' || _row.score || ' / ' || _row.total);
  END IF;
  PERFORM public.log_activity('assessment', 'Essay graded', COALESCE(NULLIF(_row.student_name, ''), _row.student_email) || ' · ' || _title, _row.score || ' / ' || _row.total);
  RETURN _row;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.guard_archived_class()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _row record;
  _cid uuid;
BEGIN
  IF current_setting('cms.account_cleanup', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN _row := OLD; ELSE _row := NEW; END IF;
  IF TG_TABLE_NAME IN ('quiz_questions', 'quiz_answer_keys', 'quiz_attempts') THEN
    SELECT class_id INTO _cid FROM public.quizzes WHERE id = _row.quiz_id;
  ELSE
    _cid := _row.class_id;
  END IF;
  IF _cid IS NOT NULL AND EXISTS (SELECT 1 FROM public.classes WHERE id = _cid AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This class belongs to an ended semester. Its records are read-only.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.guard_archived_class_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.archived_at IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at AND NEW.semester_id IS NOT DISTINCT FROM OLD.semester_id
     AND NEW.instructor_id = OLD.instructor_id AND NEW.code = OLD.code AND NEW.title = OLD.title AND NEW.section = OLD.section
     AND (NEW.subject_id IS NULL OR NEW.subject_id = OLD.subject_id) AND (NEW.section_id IS NULL OR NEW.section_id = OLD.section_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'This class belongs to an ended semester. It is read-only.';
END;
$function$
;
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  _meta_role text := _meta->>'role';
  _email text := lower(COALESCE(NEW.email, ''));
  _inv public.invitations;
  _section public.sections;
  _sem uuid := public.current_semester_id();
BEGIN
  SELECT * INTO _inv FROM public.invitations WHERE email = _email;
  IF COALESCE(_meta->>'section_id', '') ~ '^[0-9a-fA-F-]{36}$' THEN
    SELECT * INTO _section FROM public.sections WHERE id = (_meta->>'section_id')::uuid;
  END IF;

  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NULLIF(_meta->>'full_name', ''), NULLIF(_meta->>'name', ''), _inv.full_name, ''), _email)
  ON CONFLICT (id) DO NOTHING;

  IF _inv.email IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _inv.role) ON CONFLICT DO NOTHING;
    IF _inv.role::text = 'instructor' THEN
      INSERT INTO public.instructor_profiles (user_id, status, reviewed_by, reviewed_at)
      VALUES (NEW.id, 'approved', _inv.invited_by, now())
      ON CONFLICT (user_id) DO UPDATE SET status = 'approved', reviewed_by = EXCLUDED.reviewed_by, reviewed_at = now();
    END IF;
    IF _inv.class_id IS NOT NULL THEN
      INSERT INTO public.class_students (class_id, email, full_name)
      VALUES (_inv.class_id, _email, COALESCE(NULLIF(_inv.full_name, ''), ''))
      ON CONFLICT (class_id, email) DO NOTHING;
    END IF;
    DELETE FROM public.invitations WHERE email = _email;
  ELSIF _meta_role = 'instructor' THEN
    INSERT INTO public.instructor_profiles (user_id, employee_id, department, contact_number, status)
    VALUES (
      NEW.id,
      CASE WHEN EXISTS (SELECT 1 FROM public.instructor_profiles WHERE lower(employee_id) = lower(trim(COALESCE(_meta->>'employee_id', ''))) AND employee_id <> '')
           THEN '' ELSE trim(COALESCE(_meta->>'employee_id', '')) END,
      trim(COALESCE(_meta->>'department', '')), trim(COALESCE(_meta->>'contact_number', '')), 'pending')
    ON CONFLICT (user_id) DO NOTHING;
    PERFORM public.log_activity('verification', 'Instructor application submitted', COALESCE(NULLIF(_meta->>'full_name', ''), _email), 'Pending', NEW.id);
  ELSIF _meta_role IS NOT NULL OR COALESCE(NEW.raw_app_meta_data->>'provider', 'email') = 'email' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'student') ON CONFLICT DO NOTHING;
    -- The section picked at sign-up is a request the administrator approves.
    IF _section.id IS NOT NULL AND public.renewal_open() THEN
      PERFORM set_config('cms.section_pick', 'on', true);
      UPDATE public.profiles SET section_id = _section.id WHERE id = NEW.id;
      PERFORM set_config('cms.section_pick', 'off', true);
      INSERT INTO public.renewals (semester_id, user_id, kind, status, full_name, program, year_level, preferred_section_id, preferred_section_name,
                                   assigned_section_id, assigned_section_name, submitted_at, reviewed_at, reviewed_by_name)
      VALUES (_sem, NEW.id, 'student', 'approved', COALESCE(NULLIF(_meta->>'full_name', ''), _email), COALESCE(_section.program, ''), _section.year_level,
              _section.id, _section.name, _section.id, _section.name, now(), now(), 'Self-renewal');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
    WHERE r.user_id = _user_id AND r.role = _role AND p.status = 'active'
  )
$function$
;
CREATE OR REPLACE FUNCTION public.instructor_not_suspended()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT NOT EXISTS (SELECT 1 FROM public.instructor_profiles WHERE user_id = auth.uid() AND status = 'suspended')
$function$
;
CREATE OR REPLACE FUNCTION public.instructor_schedules_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _label text;
  _old text;
  _st record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _label := public.schedule_label(NEW);
    PERFORM public.notify(NEW.instructor_id, 'schedule', 'New class schedule assigned', _label);
    FOR _st IN SELECT id FROM public.profiles WHERE section_id = NEW.section_id LOOP
      PERFORM public.notify(_st.id, 'schedule', 'New class added to your schedule', _label);
    END LOOP;
    PERFORM public.log_activity('schedule', 'Schedule assigned', _label);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    _label := public.schedule_label(NEW);
    _old := public.schedule_label(OLD);
    PERFORM public.notify(NEW.instructor_id, 'schedule', 'Your schedule was updated', 'Now: ' || _label || E'\nBefore: ' || _old);
    IF OLD.instructor_id <> NEW.instructor_id THEN
      PERFORM public.notify(OLD.instructor_id, 'schedule', 'Class reassigned', 'You no longer teach: ' || _old);
    END IF;
    FOR _st IN SELECT id FROM public.profiles WHERE section_id IN (NEW.section_id, OLD.section_id) LOOP
      PERFORM public.notify(_st.id, 'schedule', 'Your class schedule changed', 'Now: ' || _label || E'\nBefore: ' || _old);
    END LOOP;
    PERFORM public.log_activity('schedule', 'Schedule updated', _label);
    RETURN NEW;
  END IF;
  _old := public.schedule_label(OLD);
  PERFORM public.notify(OLD.instructor_id, 'schedule', 'Class schedule cancelled', _old);
  FOR _st IN SELECT id FROM public.profiles WHERE section_id = OLD.section_id LOOP
    PERFORM public.notify(_st.id, 'schedule', 'A class was removed from your schedule', _old);
  END LOOP;
  PERFORM public.log_activity('schedule', 'Schedule cancelled', _old, 'Cancelled');
  RETURN OLD;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.instructor_schedules_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _c public.instructor_schedules;
  _who text;
BEGIN
  IF NEW.end_time <= NEW.start_time THEN
    RAISE EXCEPTION 'End time must be later than start time';
  END IF;
  IF NOT public.is_approved_instructor(NEW.instructor_id) THEN
    RAISE EXCEPTION 'This instructor is not approved yet. Approve their application in Instructor Verification first.';
  END IF;
  SELECT COALESCE(NULLIF(full_name, ''), email) INTO _who FROM public.profiles WHERE id = NEW.instructor_id;

  SELECT * INTO _c FROM public.instructor_schedules s
  WHERE s.id <> NEW.id AND s.semester = NEW.semester AND s.academic_year = NEW.academic_year AND s.day_of_week = NEW.day_of_week
    AND public.timerange(s.start_time, s.end_time) && public.timerange(NEW.start_time, NEW.end_time)
    AND s.instructor_id = NEW.instructor_id
  LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'Schedule conflict: % already teaches %', _who, public.schedule_label(_c); END IF;

  SELECT * INTO _c FROM public.instructor_schedules s
  WHERE s.id <> NEW.id AND s.semester = NEW.semester AND s.academic_year = NEW.academic_year AND s.day_of_week = NEW.day_of_week
    AND public.timerange(s.start_time, s.end_time) && public.timerange(NEW.start_time, NEW.end_time)
    AND s.room_id = NEW.room_id
  LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'Room conflict: the room is already used for %', public.schedule_label(_c); END IF;

  SELECT * INTO _c FROM public.instructor_schedules s
  WHERE s.id <> NEW.id AND s.semester = NEW.semester AND s.academic_year = NEW.academic_year AND s.day_of_week = NEW.day_of_week
    AND public.timerange(s.start_time, s.end_time) && public.timerange(NEW.start_time, NEW.end_time)
    AND s.section_id = NEW.section_id
  LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'Section conflict: this section already has %', public.schedule_label(_c); END IF;

  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.is_active_user()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT status = 'active' FROM public.profiles WHERE id = auth.uid()), true)
$function$
;
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role::text = 'admin')
$function$
;
CREATE OR REPLACE FUNCTION public.is_approved_instructor(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.has_role(_user_id, 'instructor')
     AND EXISTS (SELECT 1 FROM public.instructor_profiles WHERE user_id = _user_id AND status = 'approved')
$function$
;
CREATE OR REPLACE FUNCTION public.is_class_instructor(_class_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_active_user() AND public.instructor_not_suspended()
     AND EXISTS (SELECT 1 FROM public.classes WHERE id = _class_id AND instructor_id = auth.uid() AND archived_at IS NULL)
$function$
;
CREATE OR REPLACE FUNCTION public.is_class_student(_class_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_active_user() AND EXISTS (
    SELECT 1 FROM public.class_students cs JOIN public.classes c ON c.id = cs.class_id
    WHERE cs.class_id = _class_id AND c.archived_at IS NULL AND cs.email = public.current_email() AND public.current_email() <> ''
  )
$function$
;
CREATE OR REPLACE FUNCTION public.log_activity(_category text, _action text, _target text, _result text DEFAULT 'Completed'::text, _actor uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _who uuid := COALESCE(_actor, auth.uid());
  _name text;
  _role text;
BEGIN
  SELECT COALESCE(NULLIF(full_name, ''), email) INTO _name FROM public.profiles WHERE id = _who;
  SELECT role::text INTO _role FROM public.user_roles WHERE user_id = _who
  ORDER BY CASE role::text WHEN 'admin' THEN 0 WHEN 'instructor' THEN 1 ELSE 2 END LIMIT 1;
  INSERT INTO public.activity_log (actor_id, actor_name, actor_role, category, action, target, result)
  VALUES (_who, COALESCE(_name, 'System'), COALESCE(_role, 'system'), _category, _action, COALESCE(_target, ''), COALESCE(_result, 'Completed'));
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.lower_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.email := lower(trim(NEW.email)); RETURN NEW; END;
$function$
;
CREATE OR REPLACE FUNCTION public.my_schedule()
 RETURNS TABLE(id uuid, day_of_week integer, start_time time without time zone, end_time time without time zone, semester text, academic_year text, subject_code text, subject_name text, section_name text, year_level integer, room text, instructor_name text, instructor_employee_id text, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH term AS (SELECT semester AS current_semester, academic_year AS current_academic_year FROM public.semesters WHERE status = 'active' LIMIT 1),
  me AS (SELECT p.id, p.section_id, public.is_approved_instructor(p.id) AS teaches FROM public.profiles p WHERE p.id = auth.uid() AND p.status = 'active')
  SELECT s.id, s.day_of_week, s.start_time, s.end_time, s.semester, s.academic_year,
         sub.code, sub.name, sec.name, sec.year_level, r.name,
         COALESCE(NULLIF(ip.full_name, ''), ip.email), COALESCE(ipr.employee_id, ''), s.updated_at
  FROM public.instructor_schedules s
  JOIN term t ON t.current_semester = s.semester AND t.current_academic_year = s.academic_year
  JOIN me ON (me.teaches AND s.instructor_id = me.id) OR (NOT me.teaches AND me.section_id IS NOT NULL AND s.section_id = me.section_id)
  JOIN public.subjects sub ON sub.id = s.subject_id
  JOIN public.sections sec ON sec.id = s.section_id
  JOIN public.rooms r ON r.id = s.room_id
  JOIN public.profiles ip ON ip.id = s.instructor_id
  LEFT JOIN public.instructor_profiles ipr ON ipr.user_id = s.instructor_id
  ORDER BY s.day_of_week, s.start_time
$function$
;
CREATE OR REPLACE FUNCTION public.norm_answer(_t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT lower(regexp_replace(regexp_replace(trim(COALESCE(_t, '')), '\s+', ' ', 'g'), '^[[:punct:]]+|[[:punct:]]+$', '', 'g'))
$function$
;
CREATE OR REPLACE FUNCTION public.notify(_user uuid, _kind text, _title text, _body text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _user IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, kind, title, body) VALUES (_user, _kind, _title, COALESCE(_body, ''));
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL; -- a notification problem never blocks the change itself
END;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_renewal_open(_sem semesters)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.notify(p.id, 'enrollment', 'Enrollment renewal is open',
    _sem.semester || ', AY ' || _sem.academic_year || ' has started. Open the app and tap “Renew Enrollment” to confirm your course, year level and section.')
  FROM public.profiles p
  WHERE p.status = 'active' AND public.has_role(p.id, 'student') AND NOT public.has_role(p.id, 'admin')
    AND NOT EXISTS (SELECT 1 FROM public.renewals r WHERE r.user_id = p.id AND r.semester_id = _sem.id AND r.status = 'approved');
  PERFORM public.notify(p.id, 'enrollment', 'Confirm your teaching status',
    _sem.semester || ', AY ' || _sem.academic_year || ' has started. Open the app and tap “Confirm Status” so the administrator can assign your subjects and sections.')
  FROM public.profiles p
  WHERE p.status = 'active' AND public.is_approved_instructor(p.id)
    AND NOT EXISTS (SELECT 1 FROM public.renewals r WHERE r.user_id = p.id AND r.semester_id = _sem.id AND r.status = 'approved');
END;
$function$
;
CREATE OR REPLACE FUNCTION public.omr_finalize(_scan_id uuid)
 RETURNS omr_scans
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _s public.omr_scans;
  _sheet public.omr_sheets;
  _student uuid;
  _layout jsonb;
  _q record;
  _a jsonb;
  _r jsonb;
  _res jsonb;
  _responses jsonb := '[]'::jsonb;
  _scores jsonb := '[]'::jsonb;
  _legacy integer[] := '{}';
  _score integer := 0;
  _total integer := 0;
  _attempt uuid;
  _i integer := 0;
BEGIN
  SELECT * INTO _s FROM public.omr_scans WHERE id = _scan_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_class_instructor(_s.class_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _s.status = 'finalized' THEN RAISE EXCEPTION 'This answer sheet is already finalized'; END IF;
  IF _s.status <> 'ready' THEN RAISE EXCEPTION 'Resolve every unclear answer and choose the student before finalizing'; END IF;
  SELECT * INTO _sheet FROM public.omr_sheets WHERE id = _s.sheet_id AND quiz_id = _s.quiz_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose which student this answer sheet belongs to'; END IF;
  IF EXISTS (SELECT 1 FROM public.omr_scans WHERE sheet_id = _sheet.id AND status = 'finalized') THEN
    RAISE EXCEPTION 'Duplicate: % already has a finalized answer sheet for this exam', COALESCE(NULLIF(_sheet.student_name, ''), _sheet.student_email);
  END IF;
  SELECT id INTO _student FROM public.profiles WHERE lower(email) = lower(_sheet.student_email);
  IF _student IS NULL THEN RAISE EXCEPTION '% has no CvSU CMS account yet, so the score cannot be recorded. Ask the student to sign up first.', _sheet.student_email; END IF;
  IF EXISTS (SELECT 1 FROM public.quiz_attempts WHERE quiz_id = _s.quiz_id AND student_id = _student) THEN
    RAISE EXCEPTION 'Duplicate: % already has a score for this exam', COALESCE(NULLIF(_sheet.student_name, ''), _sheet.student_email);
  END IF;
  _layout := public.omr_layout(_s.quiz_id);
  IF jsonb_array_length(_s.answers) <> jsonb_array_length(_layout) THEN RAISE EXCEPTION 'Review the answers again before finalizing'; END IF;

  FOR _q IN
    SELECT q.id, q.position, q.type, q.points, k.correct_index, k.answer
    FROM public.quiz_questions q JOIN public.quiz_answer_keys k ON k.question_id = q.id
    WHERE q.quiz_id = _s.quiz_id ORDER BY q.position
  LOOP
    _a := _s.answers->_i;
    IF _a IS NULL OR _a = 'null'::jsonb THEN RAISE EXCEPTION 'Question % is still unresolved', _i + 1; END IF;
    IF (_a::text)::int < 0 THEN
      _r := '{}'::jsonb; -- left blank
    ELSIF _q.type = 'true_false' THEN
      _r := jsonb_build_object('value', (_a::text)::int = 0); -- bubble A = True, B = False
    ELSE
      _r := jsonb_build_object('choice', (_a::text)::int);
    END IF;
    _res := public.score_response(_q.type, _q.points, _q.correct_index, _q.answer, _r);
    _responses := _responses || jsonb_build_array(_r);
    _scores := _scores || jsonb_build_object('question_id', _q.id, 'points', _res->'points', 'max', _res->'max', 'pending', _res->'pending');
    _score := _score + (_res->>'points')::int;
    _total := _total + (_res->>'max')::int;
    _legacy := _legacy || CASE WHEN _q.type = 'multiple_choice' AND (_a::text)::int >= 0 THEN (_a::text)::int ELSE -1 END;
    _i := _i + 1;
  END LOOP;

  INSERT INTO public.quiz_attempts (quiz_id, student_id, student_name, student_email, answers, responses, item_scores, needs_grading, score, total, started_at, submitted_at)
  VALUES (_s.quiz_id, _student, _sheet.student_name, lower(_sheet.student_email), _legacy, _responses, _scores, false, _score, _total, NULL, now())
  RETURNING id INTO _attempt;

  PERFORM set_config('cms.omr_finalize', 'on', true);
  UPDATE public.omr_scans
  SET status = 'finalized', score = _score, total = _total, attempt_id = _attempt, finalized_at = now(), finalized_by = auth.uid(), message = ''
  WHERE id = _scan_id
  RETURNING * INTO _s;
  -- Other unfinished scans of the same sheet are now duplicates.
  UPDATE public.omr_scans SET status = 'duplicate', message = 'This sheet was already graded from another scan.'
  WHERE sheet_id = _sheet.id AND id <> _scan_id AND status NOT IN ('finalized', 'duplicate');
  PERFORM set_config('cms.omr_finalize', 'off', true);

  PERFORM public.log_activity('assessment', 'Paper answer sheet graded',
    COALESCE(NULLIF(_sheet.student_name, ''), _sheet.student_email) || ' · ' || _score || '/' || _total || ' · ' ||
    CASE _s.source WHEN 'mobile_camera' THEN 'phone camera' ELSE 'scanner' END);
  RETURN _s;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.omr_layout(_quiz_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _out jsonb := '[]'::jsonb;
  _q record;
BEGIN
  IF NOT public.can_manage_quiz(_quiz_id) AND NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  FOR _q IN SELECT position, type, cardinality(choices) AS n FROM public.quiz_questions WHERE quiz_id = _quiz_id ORDER BY position LOOP
    IF _q.type NOT IN ('multiple_choice', 'true_false') THEN
      RAISE EXCEPTION 'Question % is %. Paper answer sheets support multiple choice and True/False only.', _q.position, replace(_q.type, '_', ' ');
    END IF;
    IF _q.type = 'multiple_choice' AND (_q.n < 2 OR _q.n > 5) THEN
      RAISE EXCEPTION 'Question % has % choices. Paper answer sheets support 2 to 5 choices (A–E).', _q.position, _q.n;
    END IF;
    _out := _out || jsonb_build_object('position', _q.position, 'type', _q.type, 'choices', CASE WHEN _q.type = 'true_false' THEN 2 ELSE _q.n END);
  END LOOP;
  IF jsonb_array_length(_out) = 0 THEN RAISE EXCEPTION 'This exam has no questions yet'; END IF;
  IF jsonb_array_length(_out) > 50 THEN RAISE EXCEPTION 'Paper answer sheets hold at most 50 questions (this exam has %).', jsonb_array_length(_out); END IF;
  RETURN _out;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.omr_save_review(_scan_id uuid, _answers jsonb, _sheet_id uuid DEFAULT NULL::uuid)
 RETURNS omr_scans
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _s public.omr_scans;
  _layout jsonb;
  _i integer;
  _v jsonb;
  _unresolved boolean := false;
BEGIN
  SELECT * INTO _s FROM public.omr_scans WHERE id = _scan_id;
  IF NOT FOUND OR NOT public.is_class_instructor(_s.class_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _s.status IN ('finalized', 'failed', 'uploaded', 'processing') THEN RAISE EXCEPTION 'This scan cannot be reviewed now (status: %)', _s.status; END IF;
  _layout := public.omr_layout(_s.quiz_id);
  IF jsonb_typeof(_answers) <> 'array' OR jsonb_array_length(_answers) <> jsonb_array_length(_layout) THEN
    RAISE EXCEPTION 'Give one answer per question (% questions)', jsonb_array_length(_layout);
  END IF;
  FOR _i IN 0 .. jsonb_array_length(_answers) - 1 LOOP
    _v := _answers->_i;
    IF _v = 'null'::jsonb THEN _unresolved := true; CONTINUE; END IF;
    IF jsonb_typeof(_v) <> 'number' OR (_v::text)::int < -1 OR (_v::text)::int >= (_layout->_i->>'choices')::int THEN
      RAISE EXCEPTION 'Question %: invalid answer', _i + 1;
    END IF;
  END LOOP;
  IF _sheet_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.omr_sheets WHERE id = _sheet_id AND quiz_id = _s.quiz_id) THEN
    RAISE EXCEPTION 'That student sheet does not belong to this exam';
  END IF;
  UPDATE public.omr_scans
  SET answers = _answers,
      sheet_id = COALESCE(_sheet_id, sheet_id),
      status = CASE WHEN _unresolved OR COALESCE(_sheet_id, sheet_id) IS NULL THEN 'needs_review' ELSE 'ready' END,
      reviewed_at = now()
  WHERE id = _scan_id
  RETURNING * INTO _s;
  RETURN _s;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.omr_scans_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('cms.omr_finalize', true) = 'on' THEN RETURN NEW; END IF;
  IF OLD.status = 'finalized' THEN RAISE EXCEPTION 'This answer sheet is already finalized'; END IF;
  IF NEW.status = 'finalized' THEN RAISE EXCEPTION 'Use Finalize to grade an answer sheet'; END IF;
  NEW.quiz_id := OLD.quiz_id;
  NEW.class_id := OLD.class_id;
  NEW.created_by := OLD.created_by;
  NEW.attempt_id := OLD.attempt_id;
  NEW.score := NULL;
  NEW.total := NULL;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.prepare_omr_sheets(_quiz_id uuid)
 RETURNS SETOF omr_sheets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _class uuid;
BEGIN
  IF NOT public.can_manage_quiz(_quiz_id) THEN RAISE EXCEPTION 'Only the class instructor can print answer sheets'; END IF;
  PERFORM public.omr_layout(_quiz_id); -- validates the exam
  SELECT class_id INTO _class FROM public.quizzes WHERE id = _quiz_id;
  INSERT INTO public.omr_sheets (quiz_id, class_id, student_email, student_name, created_by)
  SELECT _quiz_id, _class, lower(s.email), s.full_name, auth.uid() FROM public.class_students s WHERE s.class_id = _class
  ON CONFLICT (quiz_id, student_email) DO UPDATE SET student_name = EXCLUDED.student_name;
  RETURN QUERY SELECT * FROM public.omr_sheets WHERE quiz_id = _quiz_id ORDER BY student_name, student_email;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.previous_semester_end()
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT max(LEAST(COALESCE(ends_on, (ended_at AT TIME ZONE 'Asia/Manila')::date), COALESCE((ended_at AT TIME ZONE 'Asia/Manila')::date, ends_on)))
  FROM public.semesters WHERE status = 'completed'
$function$
;
CREATE OR REPLACE FUNCTION public.profiles_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN
    NEW.status := OLD.status;
    IF current_setting('cms.renewal', true) IS DISTINCT FROM 'on' THEN
      NEW.student_number := OLD.student_number;
    END IF;
    IF current_setting('cms.section_pick', true) IS DISTINCT FROM 'on' THEN
      NEW.section_id := OLD.section_id;
    END IF;
  END IF;
  NEW.email := OLD.email;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.renewal_approved(_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.renewals r WHERE r.user_id = _user AND r.status = 'approved'
                 AND r.semester_id IS NOT DISTINCT FROM public.current_semester_id())
$function$
;
CREATE OR REPLACE FUNCTION public.renewal_mark_approved(_user uuid, _kind text, _section uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _p public.profiles;
  _sec public.sections;
  _by text;
  _id uuid;
BEGIN
  IF NOT public.renewal_open() THEN RETURN; END IF;
  SELECT * INTO _p FROM public.profiles WHERE id = _user;
  IF _p.id IS NULL THEN RETURN; END IF;
  SELECT * INTO _sec FROM public.sections WHERE id = _section;
  SELECT COALESCE(NULLIF(full_name, ''), email) INTO _by FROM public.profiles WHERE id = auth.uid();
  _id := public.renewal_row(_user, _kind);
  UPDATE public.renewals SET
    status = 'approved', reason = '', kind = _kind,
    full_name = CASE WHEN full_name = '' THEN COALESCE(_p.full_name, '') ELSE full_name END,
    assigned_section_id = COALESCE(_sec.id, assigned_section_id),
    assigned_section_name = CASE WHEN _sec.id IS NOT NULL THEN _sec.name ELSE assigned_section_name END,
    year_level = COALESCE(year_level, _sec.year_level),
    program = CASE WHEN program = '' THEN COALESCE(_sec.program, '') ELSE program END,
    reviewed_at = now(), reviewed_by = auth.uid(), reviewed_by_name = COALESCE(_by, ''), updated_at = now()
  WHERE id = _id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.renewal_open()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.semesters)
$function$
;
CREATE OR REPLACE FUNCTION public.renewal_row(_user uuid, _kind text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _sem uuid := public.current_semester_id();
  _id uuid;
BEGIN
  SELECT id INTO _id FROM public.renewals WHERE user_id = _user AND semester_id IS NOT DISTINCT FROM _sem;
  IF _id IS NULL THEN
    INSERT INTO public.renewals (semester_id, user_id, kind, full_name)
    VALUES (_sem, _user, _kind, COALESCE((SELECT full_name FROM public.profiles WHERE id = _user), ''))
    RETURNING id INTO _id;
  END IF;
  RETURN _id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.review_instructor(_user_id uuid, _approve boolean, _reason text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _name text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only administrators can verify instructors'; END IF;
  IF NOT _approve AND trim(COALESCE(_reason, '')) = '' THEN RAISE EXCEPTION 'Give a reason for the rejection'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.instructor_profiles WHERE user_id = _user_id) THEN
    RAISE EXCEPTION 'No instructor application found for this user';
  END IF;
  SELECT COALESCE(NULLIF(full_name, ''), email) INTO _name FROM public.profiles WHERE id = _user_id;

  UPDATE public.instructor_profiles
  SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
      rejection_reason = CASE WHEN _approve THEN '' ELSE trim(_reason) END,
      reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE user_id = _user_id;
  INSERT INTO public.instructor_verifications (user_id, decision, reason, decided_by)
  VALUES (_user_id, CASE WHEN _approve THEN 'approved' ELSE 'rejected' END, trim(COALESCE(_reason, '')), auth.uid());

  IF _approve THEN
    DELETE FROM public.user_roles WHERE user_id = _user_id AND role::text = 'student';
    INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, 'instructor') ON CONFLICT DO NOTHING;
    PERFORM public.notify(_user_id, 'application', 'Instructor account approved',
      'Your instructor application was approved. You can now use the instructor dashboard.');
    PERFORM public.log_activity('verification', 'Instructor approved', COALESCE(_name, ''), 'Approved');
  ELSE
    DELETE FROM public.user_roles WHERE user_id = _user_id AND role::text = 'instructor';
    PERFORM public.notify(_user_id, 'application', 'Instructor application not approved', 'Reason: ' || trim(_reason));
    PERFORM public.log_activity('verification', 'Instructor rejected', COALESCE(_name, ''), 'Rejected');
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.review_renewal(_user_id uuid, _approve boolean, _reason text DEFAULT ''::text, _section_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _sem public.semesters;
  _r public.renewals;
  _kind text;
  _sec public.sections;
  _name text;
  _term text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only administrators review renewals.'; END IF;
  IF NOT public.renewal_open() THEN RAISE EXCEPTION 'Start a semester first.'; END IF;
  SELECT * INTO _sem FROM public.semesters WHERE status = 'active';
  _term := CASE WHEN _sem.id IS NULL THEN 'the next semester' ELSE _sem.semester || ', AY ' || _sem.academic_year END;
  SELECT * INTO _r FROM public.renewals WHERE user_id = _user_id AND semester_id IS NOT DISTINCT FROM _sem.id;
  _kind := COALESCE(_r.kind, CASE WHEN public.is_approved_instructor(_user_id) THEN 'instructor' WHEN public.has_role(_user_id, 'student') THEN 'student' END);
  IF _kind IS NULL THEN RAISE EXCEPTION 'This account is not a student or an approved instructor.'; END IF;
  SELECT COALESCE(NULLIF(full_name, ''), email) INTO _name FROM public.profiles WHERE id = _user_id;

  IF _approve THEN
    IF _kind = 'student' THEN
      SELECT * INTO _sec FROM public.sections WHERE id = COALESCE(_section_id, _r.preferred_section_id);
      IF _sec.id IS NULL THEN RAISE EXCEPTION 'Choose the section to enroll % in. (Create the new sections first on the Sections page.)', _name; END IF;
      UPDATE public.profiles SET section_id = _sec.id WHERE id = _user_id;
      PERFORM public.renewal_mark_approved(_user_id, 'student', _sec.id);
      PERFORM public.notify(_user_id, 'enrollment', 'Enrollment approved',
        'You are enrolled in ' || _sec.name || ' for ' || _term || '. Your classes appear once its schedule is ready.');
    ELSE
      PERFORM public.renewal_mark_approved(_user_id, 'instructor', NULL);
      PERFORM public.notify(_user_id, 'enrollment', 'Teaching status confirmed',
        'You are confirmed for ' || _term || '. Your subjects and sections appear once they are assigned.');
    END IF;
    PERFORM public.log_activity('enrollment', CASE WHEN _kind = 'student' THEN 'Enrollment renewal approved' ELSE 'Instructor confirmed' END,
                                _name || COALESCE(' · ' || _sec.name, ''));
  ELSE
    IF trim(COALESCE(_reason, '')) = '' THEN RAISE EXCEPTION 'Give a reason. The person will see it.'; END IF;
    IF _r.id IS NULL THEN RAISE EXCEPTION 'There is no renewal request to reject.'; END IF;
    UPDATE public.renewals SET status = 'rejected', reason = trim(_reason), reviewed_at = now(), reviewed_by = auth.uid(),
      reviewed_by_name = COALESCE((SELECT COALESCE(NULLIF(full_name, ''), email) FROM public.profiles WHERE id = auth.uid()), ''), updated_at = now()
    WHERE id = _r.id;
    IF _kind = 'student' THEN UPDATE public.profiles SET section_id = NULL WHERE id = _user_id AND section_id IS NOT NULL; END IF;
    PERFORM public.notify(_user_id, 'enrollment', 'Renewal not approved',
      'Reason: ' || trim(_reason) || '. You can update your details and send it again.');
    PERFORM public.log_activity('enrollment', 'Renewal rejected', _name, trim(_reason));
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl FROM pg_catalog.pg_class c WHERE c.oid = cmd.objid;
        EXECUTE format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.save_attendance(_class_id uuid, _date date, _records jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _session uuid;
  _r jsonb;
  _email text;
  _status text;
  _name text;
  _present integer := 0;
  _total integer := 0;
BEGIN
  IF NOT public.is_class_instructor(_class_id) THEN RAISE EXCEPTION 'Only the class instructor can take attendance'; END IF;
  IF _date IS NULL OR _date > (now() AT TIME ZONE 'Asia/Manila')::date + 1 THEN RAISE EXCEPTION 'Choose a date that is not in the future'; END IF;
  IF jsonb_typeof(_records) <> 'array' OR jsonb_array_length(_records) = 0 THEN RAISE EXCEPTION 'Mark at least one student'; END IF;

  INSERT INTO public.attendance_sessions (class_id, session_date, taken_by)
  VALUES (_class_id, _date, auth.uid())
  ON CONFLICT (class_id, session_date) DO UPDATE SET taken_by = auth.uid(), updated_at = now()
  RETURNING id INTO _session;

  FOR _r IN SELECT * FROM jsonb_array_elements(_records) LOOP
    _email := lower(trim(COALESCE(_r->>'email', '')));
    _status := _r->>'status';
    IF _status NOT IN ('present', 'absent') THEN RAISE EXCEPTION 'Status must be present or absent'; END IF;
    SELECT full_name INTO _name FROM public.class_students WHERE class_id = _class_id AND lower(email) = _email;
    IF NOT FOUND THEN RAISE EXCEPTION '% is not enrolled in this class', _email; END IF;
    INSERT INTO public.attendance_records (session_id, class_id, student_email, student_name, status)
    VALUES (_session, _class_id, _email, COALESCE(_name, ''), _status)
    ON CONFLICT (session_id, student_email) DO UPDATE SET status = EXCLUDED.status, student_name = EXCLUDED.student_name, updated_at = now();
    _total := _total + 1;
    IF _status = 'present' THEN _present := _present + 1; END IF;
  END LOOP;

  PERFORM public.log_activity('attendance', 'Attendance taken',
    COALESCE(public.class_label(_class_id), '') || ' · ' || to_char(_date, 'Mon DD') || ' · ' || _present || '/' || _total || ' present');
  RETURN _session;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.save_quiz(_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid := (_payload->>'id')::uuid;
  _class uuid := (_payload->>'class_id')::uuid;
  _q jsonb;
  _pos integer := 0;
  _qid uuid;
  _type text;
  _answer jsonb;
  _points integer;
  _count integer;
  _kind text := CASE WHEN _payload->>'kind' = 'exam' THEN 'exam' ELSE 'quiz' END;
BEGIN
  IF NOT public.is_class_instructor(_class) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.quizzes WHERE id = _id AND class_id <> _class) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.quiz_attempts WHERE quiz_id = _id) THEN
    -- Questions are locked once students have answered; only details and status change.
    UPDATE public.quizzes SET
      title = _payload->>'title',
      description = COALESCE(_payload->>'description', ''),
      due_at = NULLIF(_payload->>'due_at', '')::timestamptz,
      time_limit_minutes = COALESCE((_payload->>'time_limit_minutes')::int, 30),
      passing_score = COALESCE((_payload->>'passing_score')::int, 70),
      status = COALESCE(_payload->>'status', 'draft'),
      kind = _kind
    WHERE id = _id;
    RETURN _id;
  END IF;

  INSERT INTO public.quizzes (id, class_id, title, description, due_at, time_limit_minutes, passing_score, status, kind)
  VALUES (_id, _class, _payload->>'title', COALESCE(_payload->>'description', ''),
          NULLIF(_payload->>'due_at', '')::timestamptz,
          COALESCE((_payload->>'time_limit_minutes')::int, 30),
          COALESCE((_payload->>'passing_score')::int, 70),
          COALESCE(_payload->>'status', 'draft'), _kind)
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, description = EXCLUDED.description, due_at = EXCLUDED.due_at,
    time_limit_minutes = EXCLUDED.time_limit_minutes, passing_score = EXCLUDED.passing_score,
    status = EXCLUDED.status, kind = EXCLUDED.kind;

  DELETE FROM public.quiz_questions WHERE quiz_id = _id;
  FOR _q IN SELECT * FROM jsonb_array_elements(COALESCE(_payload->'questions', '[]'::jsonb)) LOOP
    _pos := _pos + 1;
    _type := COALESCE(_q->>'type', 'multiple_choice');
    _answer := COALESCE(_q->'answer', '{}'::jsonb);
    _points := GREATEST(1, LEAST(100, COALESCE((_q->>'points')::int, 1)));
    _count := 1;
    IF trim(COALESCE(_q->>'prompt', '')) = '' THEN
      RAISE EXCEPTION 'Question % has no text', _pos;
    END IF;
    IF _type = 'multiple_choice' THEN
      IF jsonb_array_length(COALESCE(_q->'choices', '[]'::jsonb)) < 2 THEN RAISE EXCEPTION 'Question %: add at least two choices', _pos; END IF;
    ELSIF _type IN ('true_false', 'modified_true_false') THEN
      IF jsonb_typeof(_answer->'value') <> 'boolean' THEN RAISE EXCEPTION 'Question %: mark it True or False', _pos; END IF;
      IF _type = 'modified_true_false' AND NOT (_answer->>'value')::boolean AND jsonb_array_length(COALESCE(_answer->'accepted', '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'Question %: give the word that makes the statement true', _pos;
      END IF;
    ELSIF _type = 'identification' THEN
      IF jsonb_array_length(COALESCE(_answer->'accepted', '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'Question %: give the correct answer', _pos; END IF;
    ELSIF _type = 'enumeration' THEN
      _count := jsonb_array_length(COALESCE(_answer->'items', '[]'::jsonb));
      IF _count = 0 THEN RAISE EXCEPTION 'Question %: list the expected items', _pos; END IF;
      _points := _count; -- one point per item
    ELSIF _type <> 'essay' THEN
      RAISE EXCEPTION 'Question %: unknown question type', _pos;
    END IF;

    INSERT INTO public.quiz_questions (quiz_id, position, prompt, choices, type, points, item_count)
    VALUES (_id, _pos, _q->>'prompt',
            CASE WHEN _type = 'multiple_choice' THEN ARRAY(SELECT jsonb_array_elements_text(_q->'choices')) ELSE '{}'::text[] END,
            _type, _points, _count)
    RETURNING id INTO _qid;
    INSERT INTO public.quiz_answer_keys (question_id, quiz_id, correct_index, answer)
    VALUES (_qid, _id, CASE WHEN _type = 'multiple_choice' THEN COALESCE((_q->>'correct_index')::int, 0) END, _answer);
  END LOOP;
  RETURN _id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.schedule_label(_s instructor_schedules)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (SELECT code || ' ' || name FROM public.subjects WHERE id = _s.subject_id)
      || ' · ' || (SELECT name FROM public.sections WHERE id = _s.section_id)
      || ' · ' || public.day_label(_s.day_of_week) || ' ' || public.time_label(_s.start_time) || '–' || public.time_label(_s.end_time)
      || ' · ' || (SELECT name FROM public.rooms WHERE id = _s.room_id)
$function$
;
CREATE OR REPLACE FUNCTION public.score_response(_type text, _points integer, _correct_index integer, _key jsonb, _r jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  _got integer := 0;
  _max integer := _points;
  _given jsonb;
  _used boolean[];
  _item jsonb;
  _i integer;
  _n integer;
BEGIN
  _r := COALESCE(_r, '{}'::jsonb);
  IF _type = 'multiple_choice' THEN
    IF (_r->>'choice') ~ '^-?[0-9]+$' AND (_r->>'choice')::int = _correct_index THEN _got := _points; END IF;
  ELSIF _type = 'true_false' THEN
    IF jsonb_typeof(_r->'value') = 'boolean' AND (_r->'value') = (_key->'value') THEN _got := _points; END IF;
  ELSIF _type = 'modified_true_false' THEN
    IF jsonb_typeof(_r->'value') = 'boolean' AND (_r->'value') = (_key->'value') THEN
      IF (_key->>'value')::boolean OR public.answer_matches(_r->>'correction', _key->'accepted') THEN _got := _points; END IF;
    END IF;
  ELSIF _type = 'identification' THEN
    IF public.answer_matches(_r->>'text', _key->'accepted') THEN _got := _points; END IF;
  ELSIF _type = 'enumeration' THEN
    _given := CASE WHEN jsonb_typeof(_r->'items') = 'array' THEN _r->'items' ELSE '[]'::jsonb END;
    _n := jsonb_array_length(_given);
    _used := array_fill(false, ARRAY[GREATEST(_n, 1)]);
    _max := jsonb_array_length(COALESCE(_key->'items', '[]'::jsonb));
    FOR _item IN SELECT * FROM jsonb_array_elements(COALESCE(_key->'items', '[]'::jsonb)) LOOP
      FOR _i IN 1.._n LOOP
        IF NOT _used[_i] AND public.answer_matches(_given->>(_i - 1), _item) THEN
          _used[_i] := true;
          _got := _got + 1;
          EXIT;
        END IF;
      END LOOP;
    END LOOP;
  ELSIF _type = 'essay' THEN
    RETURN jsonb_build_object('points', 0, 'max', _points, 'pending', trim(COALESCE(_r->>'text', '')) <> '');
  END IF;
  RETURN jsonb_build_object('points', _got, 'max', _max, 'pending', false);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.semester_end_preview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _sem public.semesters;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only administrators can end a semester.'; END IF;
  SELECT * INTO _sem FROM public.semesters WHERE status = 'active';
  IF _sem.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'semester', to_jsonb(_sem),
    'classes', (SELECT count(*) FROM public.classes WHERE semester_id = _sem.id AND archived_at IS NULL),
    'instructors', (SELECT count(DISTINCT instructor_id) FROM public.classes WHERE semester_id = _sem.id AND archived_at IS NULL),
    'subjects', (SELECT count(DISTINCT code) FROM public.classes WHERE semester_id = _sem.id AND archived_at IS NULL),
    'sections', (SELECT count(DISTINCT section) FROM public.classes WHERE semester_id = _sem.id AND archived_at IS NULL),
    'students', (SELECT count(DISTINCT lower(cs.email)) FROM public.class_students cs JOIN public.classes c ON c.id = cs.class_id WHERE c.semester_id = _sem.id AND c.archived_at IS NULL),
    'enrollments', (SELECT count(*) FROM public.class_students cs JOIN public.classes c ON c.id = cs.class_id WHERE c.semester_id = _sem.id AND c.archived_at IS NULL),
    'quizzes', (SELECT count(*) FROM public.quizzes q JOIN public.classes c ON c.id = q.class_id WHERE c.semester_id = _sem.id AND c.archived_at IS NULL),
    'grades', (SELECT count(*) FROM public.quiz_attempts a JOIN public.quizzes q ON q.id = a.quiz_id JOIN public.classes c ON c.id = q.class_id WHERE c.semester_id = _sem.id AND c.archived_at IS NULL),
    'assignments', (SELECT count(*) FROM public.assignments a JOIN public.classes c ON c.id = a.class_id WHERE c.semester_id = _sem.id AND c.archived_at IS NULL),
    'announcements', (SELECT count(*) FROM public.announcements a JOIN public.classes c ON c.id = a.class_id WHERE c.semester_id = _sem.id AND c.archived_at IS NULL),
    'attendance_sessions', (SELECT count(*) FROM public.attendance_sessions s JOIN public.classes c ON c.id = s.class_id WHERE c.semester_id = _sem.id AND c.archived_at IS NULL),
    'attendance_records', (SELECT count(*) FROM public.attendance_records r JOIN public.classes c ON c.id = r.class_id WHERE c.semester_id = _sem.id AND c.archived_at IS NULL),
    'omr_scans', (SELECT count(*) FROM public.omr_scans o JOIN public.classes c ON c.id = o.class_id WHERE c.semester_id = _sem.id AND c.archived_at IS NULL),
    'schedules', (SELECT count(*) FROM public.instructor_schedules s WHERE s.semester = _sem.semester AND s.academic_year = _sem.academic_year)
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_instructor_suspension(_user_id uuid, _suspend boolean, _reason text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _name text;
  _status text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only administrators can suspend or reactivate instructors'; END IF;
  IF _user_id = auth.uid() THEN RAISE EXCEPTION 'You cannot change your own instructor status'; END IF;
  SELECT status INTO _status FROM public.instructor_profiles WHERE user_id = _user_id;
  IF _status IS NULL THEN RAISE EXCEPTION 'No instructor record found for this user'; END IF;
  IF _suspend AND _status <> 'approved' THEN RAISE EXCEPTION 'Only approved instructors can be suspended'; END IF;
  IF NOT _suspend AND _status <> 'suspended' THEN RAISE EXCEPTION 'This instructor is not suspended'; END IF;
  IF _suspend AND trim(COALESCE(_reason, '')) = '' THEN RAISE EXCEPTION 'Give a reason for the suspension'; END IF;

  SELECT COALESCE(NULLIF(full_name, ''), email) INTO _name FROM public.profiles WHERE id = _user_id;
  UPDATE public.instructor_profiles
  SET status = CASE WHEN _suspend THEN 'suspended' ELSE 'approved' END,
      rejection_reason = CASE WHEN _suspend THEN trim(_reason) ELSE '' END,
      reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE user_id = _user_id;
  INSERT INTO public.instructor_verifications (user_id, decision, reason, decided_by)
  VALUES (_user_id, CASE WHEN _suspend THEN 'suspended' ELSE 'reactivated' END, trim(COALESCE(_reason, '')), auth.uid());

  IF _suspend THEN
    PERFORM public.notify(_user_id, 'application', 'Instructor access suspended', 'Reason: ' || trim(_reason));
    PERFORM public.log_activity('verification', 'Instructor suspended', COALESCE(_name, ''), 'Suspended');
  ELSE
    PERFORM public.notify(_user_id, 'application', 'Instructor access restored', 'An administrator reactivated your instructor account.');
    PERFORM public.log_activity('verification', 'Instructor reactivated', COALESCE(_name, ''), 'Reactivated');
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.start_semester(_semester text, _academic_year text, _starts_on date, _ends_on date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid;
  _prev date := public.previous_semester_end();
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only administrators can start a semester.'; END IF;
  IF trim(coalesce(_semester, '')) = '' OR trim(coalesce(_academic_year, '')) = '' THEN RAISE EXCEPTION 'Enter the semester and academic year.'; END IF;
  IF _starts_on IS NULL OR _ends_on IS NULL THEN RAISE EXCEPTION 'Set the first and last day of the semester.'; END IF;
  IF _ends_on <= _starts_on THEN RAISE EXCEPTION 'The end date must be after the start date.'; END IF;
  IF _prev IS NOT NULL AND _starts_on <= _prev THEN
    RAISE EXCEPTION 'The semester must start after the previous one ended (%). Choose % or later.', to_char(_prev, 'Mon DD, YYYY'), to_char(_prev + 1, 'Mon DD, YYYY');
  END IF;
  IF EXISTS (SELECT 1 FROM public.semesters WHERE status = 'active') THEN
    RAISE EXCEPTION 'End the current semester before starting a new one.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.semesters WHERE semester = trim(_semester) AND academic_year = trim(_academic_year)) THEN
    RAISE EXCEPTION '% AY % already exists. Choose a different semester or academic year.', trim(_semester), trim(_academic_year);
  END IF;

  INSERT INTO public.semesters (semester, academic_year, starts_on, ends_on, status, created_by)
  VALUES (trim(_semester), trim(_academic_year), _starts_on, _ends_on, 'active', auth.uid())
  RETURNING id INTO _id;
  UPDATE public.app_settings SET current_semester = trim(_semester), current_academic_year = trim(_academic_year),
         semester_start = _starts_on, semester_end = _ends_on, updated_at = now(), updated_by = auth.uid()
  WHERE id = true;
  UPDATE public.classes SET semester_id = _id WHERE semester_id IS NULL AND archived_at IS NULL;

  PERFORM public.log_activity('settings', 'Started semester', trim(_semester) || ', AY ' || trim(_academic_year), 'Active', auth.uid());
  RETURN _id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.submit_instructor_application(_full_name text, _employee_id text, _department text, _contact_number text, _proof_path text DEFAULT NULL::text)
 RETURNS instructor_profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row public.instructor_profiles;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'This account is suspended'; END IF;
  IF public.is_approved_instructor(_uid) THEN RAISE EXCEPTION 'Your instructor account is already approved'; END IF;
  IF trim(COALESCE(_full_name, '')) = '' THEN RAISE EXCEPTION 'Enter your full name'; END IF;
  IF trim(COALESCE(_employee_id, '')) = '' THEN RAISE EXCEPTION 'Enter your employee / faculty ID'; END IF;
  IF trim(COALESCE(_department, '')) = '' THEN RAISE EXCEPTION 'Enter your department'; END IF;
  -- Contact number is optional; if given it must look like a phone number.
  IF trim(COALESCE(_contact_number, '')) <> '' AND trim(_contact_number) !~ '^\+?[0-9][0-9 -]{6,18}$' THEN RAISE EXCEPTION 'Enter a valid contact number (e.g. 0917 123 4567)'; END IF;
  IF _proof_path IS NOT NULL AND _proof_path <> '' AND split_part(_proof_path, '/', 1) <> _uid::text THEN
    RAISE EXCEPTION 'Invalid proof document';
  END IF;
  IF EXISTS (SELECT 1 FROM public.instructor_profiles WHERE lower(employee_id) = lower(trim(_employee_id)) AND user_id <> _uid) THEN
    RAISE EXCEPTION 'This employee / faculty ID is already registered to another account';
  END IF;

  UPDATE public.profiles SET full_name = trim(_full_name) WHERE id = _uid;
  INSERT INTO public.instructor_profiles (user_id, employee_id, department, contact_number, proof_path, status, submitted_at)
  VALUES (_uid, trim(_employee_id), trim(_department), trim(COALESCE(_contact_number, '')), NULLIF(_proof_path, ''), 'pending', now())
  ON CONFLICT (user_id) DO UPDATE SET
    employee_id = EXCLUDED.employee_id,
    department = EXCLUDED.department,
    contact_number = EXCLUDED.contact_number,
    proof_path = COALESCE(EXCLUDED.proof_path, public.instructor_profiles.proof_path),
    status = 'pending',
    rejection_reason = '',
    reviewed_by = NULL,
    reviewed_at = NULL,
    submitted_at = now(),
    updated_at = now()
  RETURNING * INTO _row;
  PERFORM public.log_activity('verification', 'Instructor application submitted', trim(_full_name) || ' · ' || trim(_department), 'Pending');
  RETURN _row;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.submit_quiz(_quiz_id uuid, _answers integer[], _started_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS quiz_attempts
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT * FROM public.submit_quiz_v2(_quiz_id,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('choice', x) ORDER BY i) FROM unnest(_answers) WITH ORDINALITY u(x, i)), '[]'::jsonb),
    _started_at)
$function$
;
CREATE OR REPLACE FUNCTION public.submit_quiz_v2(_quiz_id uuid, _responses jsonb, _started_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS quiz_attempts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _row public.quiz_attempts;
  _q record;
  _r jsonb;
  _s jsonb;
  _scores jsonb := '[]'::jsonb;
  _score integer := 0;
  _total integer := 0;
  _pending boolean := false;
  _legacy integer[] := '{}';
  _name text;
BEGIN
  IF NOT public.can_take_quiz(_quiz_id) THEN
    RAISE EXCEPTION 'This quiz is not available to you';
  END IF;
  SELECT * INTO _row FROM public.quiz_attempts WHERE quiz_id = _quiz_id AND student_id = auth.uid();
  IF FOUND THEN RETURN _row; END IF;
  IF jsonb_typeof(_responses) <> 'array' THEN _responses := '[]'::jsonb; END IF;

  FOR _q IN
    SELECT q.id, q.position, q.type, q.points, k.correct_index, k.answer
    FROM public.quiz_questions q JOIN public.quiz_answer_keys k ON k.question_id = q.id
    WHERE q.quiz_id = _quiz_id ORDER BY q.position
  LOOP
    _r := _responses->(_q.position - 1);
    IF _r IS NULL OR jsonb_typeof(_r) <> 'object' THEN _r := '{}'::jsonb; END IF;
    _s := public.score_response(_q.type, _q.points, _q.correct_index, _q.answer, _r);
    _scores := _scores || jsonb_build_object('question_id', _q.id, 'points', _s->'points', 'max', _s->'max', 'pending', _s->'pending');
    _score := _score + (_s->>'points')::int;
    _total := _total + (_s->>'max')::int;
    _pending := _pending OR (_s->>'pending')::boolean;
    _legacy := _legacy || CASE WHEN _q.type = 'multiple_choice' AND (_r->>'choice') ~ '^-?[0-9]+$' THEN (_r->>'choice')::int ELSE -1 END;
  END LOOP;

  SELECT full_name INTO _name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.quiz_attempts (quiz_id, student_id, student_name, student_email, answers, responses, item_scores, needs_grading, score, total, started_at)
  VALUES (_quiz_id, auth.uid(), COALESCE(_name, ''), public.current_email(), _legacy, _responses, _scores, _pending, _score, _total, _started_at)
  RETURNING * INTO _row;
  RETURN _row;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.submit_renewal(_details jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _sem public.semesters;
  _kind text;
  _cur public.renewals;
  _name text := trim(COALESCE(_details->>'full_name', ''));
  _sec public.sections;
  _year int;
  _id uuid;
  _term text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'This account is suspended.'; END IF;
  IF NOT public.renewal_open() THEN RAISE EXCEPTION 'Renewal isn''t open yet.'; END IF;
  SELECT * INTO _sem FROM public.semesters WHERE status = 'active';
  _term := CASE WHEN _sem.id IS NULL THEN 'the next semester' ELSE _sem.semester || ', AY ' || _sem.academic_year END;
  _kind := CASE WHEN public.is_approved_instructor(_uid) THEN 'instructor' WHEN public.has_role(_uid, 'student') THEN 'student' END;
  IF _kind IS NULL THEN RAISE EXCEPTION 'Only students and approved instructors renew.'; END IF;
  IF _name = '' THEN RAISE EXCEPTION 'Enter your full name.'; END IF;
  IF COALESCE((_details->>'confirmed')::boolean, false) IS NOT TRUE THEN RAISE EXCEPTION 'Confirm that your details are correct.'; END IF;

  SELECT * INTO _cur FROM public.renewals WHERE user_id = _uid AND semester_id IS NOT DISTINCT FROM _sem.id;
  IF _cur.status = 'approved' THEN RAISE EXCEPTION 'Your renewal for % is already approved.', _term; END IF;

  IF _kind = 'student' THEN
    IF trim(COALESCE(_details->>'program', '')) = '' THEN RAISE EXCEPTION 'Enter your course / program.'; END IF;
    _year := NULLIF(_details->>'year_level', '')::int;
    IF _year IS NULL OR _year < 1 OR _year > 6 THEN RAISE EXCEPTION 'Choose your year level.'; END IF;
    IF NULLIF(_details->>'section_id', '') IS NOT NULL THEN
      SELECT * INTO _sec FROM public.sections WHERE id = (_details->>'section_id')::uuid;
    END IF;
    IF _sec.id IS NULL THEN
      RAISE EXCEPTION 'Choose your section.%', CASE WHEN NOT EXISTS (SELECT 1 FROM public.sections)
        THEN ' (No sections are open yet. Try again once the school adds them.)' ELSE '' END;
    END IF;
    PERFORM set_config('cms.renewal', 'on', true);
    UPDATE public.profiles SET full_name = _name,
      student_number = COALESCE(NULLIF(trim(_details->>'student_number'), ''), student_number)
    WHERE id = _uid;
    PERFORM set_config('cms.renewal', 'off', true);
  ELSE
    UPDATE public.profiles SET full_name = _name WHERE id = _uid;
    UPDATE public.instructor_profiles SET
      employee_id = COALESCE(NULLIF(trim(_details->>'employee_id'), ''), employee_id),
      department = COALESCE(NULLIF(trim(_details->>'department'), ''), department),
      contact_number = COALESCE(NULLIF(trim(_details->>'contact_number'), ''), contact_number),
      updated_at = now()
    WHERE user_id = _uid;
  END IF;

  _id := public.renewal_row(_uid, _kind);
  UPDATE public.renewals SET
    kind = _kind, status = 'pending', reason = '', full_name = _name,
    program = trim(COALESCE(_details->>'program', '')), year_level = _year,
    preferred_section_id = _sec.id, preferred_section_name = COALESCE(_sec.name, ''),
    details = _details - 'confirmed', submitted_at = now(), updated_at = now()
  WHERE id = _id;

  IF _kind = 'student' THEN
    -- Students renew themselves: enrolled in the chosen section right away (no approval step).
    PERFORM set_config('cms.section_pick', 'on', true);
    UPDATE public.profiles SET section_id = _sec.id WHERE id = _uid;
    PERFORM set_config('cms.section_pick', 'off', true);
    UPDATE public.renewals SET status = 'approved', assigned_section_id = _sec.id, assigned_section_name = _sec.name,
      reviewed_at = now(), reviewed_by = NULL, reviewed_by_name = 'Self-renewal', updated_at = now()
    WHERE id = _id;
    PERFORM public.notify(_uid, 'enrollment', 'Enrollment renewed',
      'You are enrolled in ' || _sec.name || ' for ' || _term || '. Your classes appear in Schedule and My Classes once its schedule is ready.');
    PERFORM public.log_activity('enrollment', 'Enrollment renewed', _name || ' · ' || _sec.name || ' · ' || _term, 'Enrolled');
  ELSE
    PERFORM public.log_activity('enrollment', 'Instructor renewal submitted', _name || ' · ' || _term, 'Waiting for approval');
  END IF;
  RETURN _id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_student_section_classes(_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _p public.profiles;
BEGIN
  SELECT * INTO _p FROM public.profiles WHERE id = _user;
  IF _p.id IS NULL OR _p.email = '' THEN RETURN; END IF;
  DELETE FROM public.class_students cs
  USING public.classes c
  WHERE cs.class_id = c.id AND cs.auto AND lower(cs.email) = lower(_p.email) AND c.archived_at IS NULL
    AND c.section_id IS NOT NULL AND c.section_id IS DISTINCT FROM _p.section_id;
  IF _p.section_id IS NOT NULL AND public.has_role(_p.id, 'student') THEN
    INSERT INTO public.class_students (class_id, email, full_name, auto)
    SELECT c.id, lower(_p.email), _p.full_name, true FROM public.classes c
    WHERE c.section_id = _p.section_id AND c.subject_id IS NOT NULL AND c.archived_at IS NULL
    ON CONFLICT (class_id, email) DO NOTHING;
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.time_label(_t time without time zone)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$ SELECT trim(to_char(_t, 'FMHH12:MI AM')) $function$
;
CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_admin_not_student()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.role::text = 'student' AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.user_id AND role::text = 'admin') THEN
    RAISE EXCEPTION 'An administrator account can''t be a student. Use a separate account for the student.';
  END IF;
  IF NEW.role::text = 'admin' THEN
    -- Becoming an administrator ends any student role.
    DELETE FROM public.user_roles WHERE user_id = NEW.user_id AND role::text = 'student';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_announcement_author()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Always the signed-in poster; never a value sent by the app.
    NEW.posted_by := COALESCE(auth.uid(), (SELECT instructor_id FROM public.classes WHERE id = NEW.class_id));
  ELSE
    NEW.posted_by := OLD.posted_by;
  END IF;
  NEW.author_name := COALESCE((SELECT COALESCE(NULLIF(full_name, ''), email) FROM public.profiles WHERE id = NEW.posted_by), '');
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_instructor_approved_renewal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved') THEN
    PERFORM public.renewal_mark_approved(NEW.user_id, 'instructor', NULL);
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_log_attempt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.log_activity('assessment', 'Quiz answered',
    COALESCE((SELECT title FROM public.quizzes WHERE id = NEW.quiz_id), 'Quiz'), NEW.score || ' / ' || NEW.total, NEW.student_id);
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_log_class_content()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'classes' THEN
    PERFORM public.log_activity('class', 'Class created', NEW.code || ' · ' || NEW.title || CASE WHEN NEW.section <> '' THEN ' · ' || NEW.section ELSE '' END);
  ELSIF TG_TABLE_NAME = 'assignments' THEN
    PERFORM public.log_activity('assignment', 'Assignment posted', NEW.title || ' · ' || COALESCE(public.class_label(NEW.class_id), ''));
  ELSIF TG_TABLE_NAME = 'announcements' THEN
    PERFORM public.log_activity('announcement', 'Announcement posted', NEW.title || ' · ' || COALESCE(public.class_label(NEW.class_id), ''));
  ELSIF TG_TABLE_NAME = 'class_schedules' THEN
    PERFORM public.log_activity('schedule', 'Schedule updated', COALESCE(public.class_label(NEW.class_id), ''));
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_log_enrollment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity('enrollment', 'Student enrolled', COALESCE(NULLIF(NEW.full_name, ''), NEW.email) || ' → ' || COALESCE(public.class_label(NEW.class_id), ''));
    RETURN NEW;
  END IF;
  PERFORM public.log_activity('enrollment', 'Student removed', COALESCE(NULLIF(OLD.full_name, ''), OLD.email) || ' · ' || COALESCE(public.class_label(OLD.class_id), ''));
  RETURN OLD;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_log_invitation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.log_activity('user', 'User invited', COALESCE(NULLIF(NEW.full_name, ''), NEW.email) || ' · ' || NEW.role::text, 'Invited');
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_log_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _who text := COALESCE(NULLIF(NEW.full_name, ''), NEW.email);
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.log_activity('user', CASE WHEN NEW.status = 'suspended' THEN 'Account suspended' ELSE 'Account reactivated' END, _who);
  ELSIF (NEW.full_name, NEW.student_number) IS DISTINCT FROM (OLD.full_name, OLD.student_number) AND NEW.id <> auth.uid() THEN
    PERFORM public.log_activity('user', 'User updated', _who);
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_log_quiz_published()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status <> 'published') THEN
    PERFORM public.log_activity('assessment', CASE WHEN NEW.kind = 'exam' THEN 'Exam published' ELSE 'Quiz published' END,
      NEW.title || ' · ' || COALESCE(public.class_label(NEW.class_id), ''), 'Published');
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_log_sign_in()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.last_sign_in_at IS DISTINCT FROM OLD.last_sign_in_at THEN
    PERFORM public.log_activity('sign_in', 'Signed in', COALESCE(NEW.email, ''), 'Success', NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_profile_section_classes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.section_id IS DISTINCT FROM OLD.section_id THEN
    PERFORM public.sync_student_section_classes(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_profile_suspension()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _name text := COALESCE(NULLIF(NEW.full_name, ''), NEW.email);
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.suspension_reason IS NOT DISTINCT FROM OLD.suspension_reason THEN
    RETURN NEW;
  END IF;
  -- Only administrators (or the database itself) may suspend or reactivate an account.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can change an account''s status.';
  END IF;

  IF NEW.status = 'suspended' AND OLD.status IS DISTINCT FROM 'suspended' THEN
    IF trim(NEW.suspension_reason) = '' THEN RAISE EXCEPTION 'Give a reason for the suspension. The person will see it.'; END IF;
    PERFORM public.notify(NEW.id, 'account', 'Your account has been suspended', 'Reason: ' || trim(NEW.suspension_reason) || '. Please contact your administrator.');
    PERFORM public.log_activity('user', 'Account suspended', _name, trim(NEW.suspension_reason));
  ELSIF NEW.status = 'active' AND OLD.status = 'suspended' THEN
    NEW.suspension_reason := '';
    PERFORM public.notify(NEW.id, 'account', 'Your account is active again', 'An administrator reactivated your account. You can sign in again.');
    PERFORM public.log_activity('user', 'Account reactivated', _name);
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_role_section_classes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.sync_student_section_classes(COALESCE(NEW.user_id, OLD.user_id));
  RETURN COALESCE(NEW, OLD);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_schedule_class()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.ensure_schedule_class(NEW.subject_id, NEW.section_id, NEW.instructor_id);
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_schedule_needs_renewal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _sem public.semesters;
BEGIN
  SELECT * INTO _sem FROM public.semesters WHERE status = 'active';
  IF _sem.id IS NOT NULL AND NEW.semester = _sem.semester AND NEW.academic_year = _sem.academic_year
     AND NOT EXISTS (SELECT 1 FROM public.renewals r WHERE r.user_id = NEW.instructor_id AND r.semester_id = _sem.id AND r.status = 'approved') THEN
    RAISE EXCEPTION '% hasn''t been confirmed for % AY % yet. Confirm their renewal on the Renewals page first.',
      COALESCE((SELECT NULLIF(full_name, '') FROM public.profiles WHERE id = NEW.instructor_id), 'This instructor'), _sem.semester, _sem.academic_year;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_section_assigned()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.section_id IS DISTINCT FROM OLD.section_id AND NEW.section_id IS NOT NULL THEN
    PERFORM public.notify(NEW.id, 'schedule', 'Section assigned',
      'You are now in ' || (SELECT name FROM public.sections WHERE id = NEW.section_id) || '. Open Schedule to see your classes.');
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_section_rename_classes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.classes SET section = NEW.name WHERE section_id = NEW.id AND archived_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_section_renewal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.section_id IS NOT NULL AND NEW.section_id IS DISTINCT FROM OLD.section_id
     AND public.is_admin() AND public.has_role(NEW.id, 'student') THEN
    PERFORM public.renewal_mark_approved(NEW.id, 'student', NEW.section_id);
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_semester_closed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _was text := NEW.semester || ', AY ' || NEW.academic_year;
BEGIN
  IF NEW.status = 'completed' AND OLD.status = 'active' THEN
    PERFORM public.notify(p.id, 'enrollment', _was || ' has ended · renew now',
      'Your records are saved in My Semesters. Renewal for the next semester is open: open the app and tap “Renew Enrollment”.')
    FROM public.profiles p WHERE p.status = 'active' AND public.has_role(p.id, 'student') AND NOT public.has_role(p.id, 'admin');
    PERFORM public.notify(p.id, 'enrollment', _was || ' has ended · confirm your status',
      'Your classes are saved in Previous Semesters. Open the app and tap “Confirm Status” for the next semester.')
    FROM public.profiles p WHERE p.status = 'active' AND public.is_approved_instructor(p.id);
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_semester_opened()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'active' THEN
    UPDATE public.renewals SET semester_id = NEW.id, updated_at = now() WHERE semester_id IS NULL;
    PERFORM public.notify_renewal_open(NEW);
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_settings_check_dates()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _prev date := public.previous_semester_end();
BEGIN
  IF NEW.semester_start IS NOT NULL AND NEW.semester_end IS NOT NULL AND NEW.semester_end <= NEW.semester_start THEN
    RAISE EXCEPTION 'The last day must be after the first day.';
  END IF;
  IF NEW.semester_start IS DISTINCT FROM OLD.semester_start AND NEW.semester_start IS NOT NULL AND _prev IS NOT NULL AND NEW.semester_start <= _prev THEN
    RAISE EXCEPTION 'The semester must start after the previous one ended (%). Choose % or later.', to_char(_prev, 'Mon DD, YYYY'), to_char(_prev + 1, 'Mon DD, YYYY');
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_settings_sync_semester()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.semesters
  SET semester = NEW.current_semester, academic_year = NEW.current_academic_year, starts_on = NEW.semester_start, ends_on = NEW.semester_end
  WHERE status = 'active'
    AND NOT EXISTS (SELECT 1 FROM public.semesters o WHERE o.status = 'completed' AND o.semester = NEW.current_semester AND o.academic_year = NEW.current_academic_year);
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_subject_rename_classes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code OR NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.classes SET code = NEW.code, title = NEW.name WHERE subject_id = NEW.id AND archived_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$
;


-- ============================================================================
-- Tables
-- ============================================================================
CREATE TABLE public.activity_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  actor_id uuid,
  actor_name text DEFAULT ''::text NOT NULL,
  actor_role text DEFAULT ''::text NOT NULL,
  category text NOT NULL,
  action text NOT NULL,
  target text DEFAULT ''::text NOT NULL,
  result text DEFAULT 'Completed'::text NOT NULL
);
CREATE TABLE public.announcements (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  class_id uuid NOT NULL,
  title text NOT NULL,
  message text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  posted_by uuid,
  author_name text DEFAULT ''::text NOT NULL
);
CREATE TABLE public.app_settings (
  id boolean DEFAULT true NOT NULL,
  current_semester text DEFAULT '1st Semester'::text NOT NULL,
  current_academic_year text DEFAULT '2026-2027'::text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid,
  semester_start date,
  semester_end date
);
CREATE TABLE public.assignments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  class_id uuid NOT NULL,
  title text NOT NULL,
  description text DEFAULT ''::text NOT NULL,
  due_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  attachments jsonb DEFAULT '[]'::jsonb NOT NULL
);
CREATE TABLE public.attendance_records (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  session_id uuid NOT NULL,
  class_id uuid NOT NULL,
  student_email text NOT NULL,
  student_name text DEFAULT ''::text NOT NULL,
  status text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.attendance_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  class_id uuid NOT NULL,
  session_date date NOT NULL,
  taken_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.class_schedules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  class_id uuid NOT NULL,
  day_of_week integer NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  room text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.class_students (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  class_id uuid NOT NULL,
  email text NOT NULL,
  full_name text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  auto boolean DEFAULT false NOT NULL
);
CREATE TABLE public.classes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  instructor_id uuid DEFAULT auth.uid() NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  section text DEFAULT ''::text NOT NULL,
  description text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  subject_id uuid,
  section_id uuid,
  semester_id uuid DEFAULT current_semester_id(),
  archived_at timestamp with time zone
);
CREATE TABLE public.instructor_profiles (
  user_id uuid NOT NULL,
  employee_id text DEFAULT ''::text NOT NULL,
  department text DEFAULT ''::text NOT NULL,
  contact_number text DEFAULT ''::text NOT NULL,
  proof_path text,
  status text DEFAULT 'pending'::text NOT NULL,
  rejection_reason text DEFAULT ''::text NOT NULL,
  submitted_at timestamp with time zone DEFAULT now() NOT NULL,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.instructor_schedules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  instructor_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  section_id uuid NOT NULL,
  room_id uuid NOT NULL,
  day_of_week integer NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  semester text NOT NULL,
  academic_year text NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  updated_by uuid DEFAULT auth.uid(),
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.instructor_verifications (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  decision text NOT NULL,
  reason text DEFAULT ''::text NOT NULL,
  decided_by uuid,
  decided_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.invitations (
  email text NOT NULL,
  full_name text DEFAULT ''::text NOT NULL,
  role app_role NOT NULL,
  class_id uuid,
  invited_by uuid DEFAULT auth.uid(),
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.notifications (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text DEFAULT ''::text NOT NULL,
  read_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
CREATE TABLE public.omr_scans (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  quiz_id uuid NOT NULL,
  class_id uuid NOT NULL,
  sheet_id uuid,
  source text NOT NULL,
  original_name text DEFAULT ''::text NOT NULL,
  image_path text NOT NULL,
  processed_path text,
  status text DEFAULT 'uploaded'::text NOT NULL,
  message text DEFAULT ''::text NOT NULL,
  issues jsonb DEFAULT '[]'::jsonb NOT NULL,
  metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
  detected jsonb DEFAULT '[]'::jsonb NOT NULL,
  answers jsonb DEFAULT '[]'::jsonb NOT NULL,
  confidence numeric,
  score integer,
  total integer,
  attempt_id uuid,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  processed_at timestamp with time zone,
  reviewed_at timestamp with time zone,
  finalized_at timestamp with time zone,
  finalized_by uuid
);
CREATE TABLE public.omr_sheets (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  quiz_id uuid NOT NULL,
  class_id uuid NOT NULL,
  student_email text NOT NULL,
  student_name text DEFAULT ''::text NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  full_name text DEFAULT ''::text NOT NULL,
  email text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  student_number text DEFAULT ''::text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  section_id uuid,
  suspension_reason text DEFAULT ''::text NOT NULL
);
CREATE TABLE public.quiz_answer_keys (
  question_id uuid NOT NULL,
  quiz_id uuid NOT NULL,
  correct_index integer,
  answer jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE public.quiz_attempts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  quiz_id uuid NOT NULL,
  student_id uuid NOT NULL,
  student_name text DEFAULT ''::text NOT NULL,
  student_email text DEFAULT ''::text NOT NULL,
  answers integer[] DEFAULT '{}'::integer[] NOT NULL,
  score integer NOT NULL,
  total integer NOT NULL,
  started_at timestamp with time zone,
  submitted_at timestamp with time zone DEFAULT now() NOT NULL,
  responses jsonb DEFAULT '[]'::jsonb NOT NULL,
  item_scores jsonb DEFAULT '[]'::jsonb NOT NULL,
  needs_grading boolean DEFAULT false NOT NULL,
  graded_at timestamp with time zone,
  feedback text DEFAULT ''::text NOT NULL
);
CREATE TABLE public.quiz_questions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  quiz_id uuid NOT NULL,
  "position" integer NOT NULL,
  prompt text NOT NULL,
  choices text[] NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  type text DEFAULT 'multiple_choice'::text NOT NULL,
  points integer DEFAULT 1 NOT NULL,
  item_count integer DEFAULT 1 NOT NULL
);
CREATE TABLE public.quizzes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  class_id uuid NOT NULL,
  title text NOT NULL,
  description text DEFAULT ''::text NOT NULL,
  due_at timestamp with time zone,
  time_limit_minutes integer DEFAULT 30 NOT NULL,
  passing_score integer DEFAULT 70 NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  kind text DEFAULT 'quiz'::text NOT NULL
);
CREATE TABLE public.renewals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  semester_id uuid,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  full_name text DEFAULT ''::text NOT NULL,
  program text DEFAULT ''::text NOT NULL,
  year_level integer,
  preferred_section_id uuid,
  preferred_section_name text DEFAULT ''::text NOT NULL,
  assigned_section_id uuid,
  assigned_section_name text DEFAULT ''::text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb NOT NULL,
  reason text DEFAULT ''::text NOT NULL,
  submitted_at timestamp with time zone,
  reviewed_at timestamp with time zone,
  reviewed_by uuid,
  reviewed_by_name text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.rooms (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  building text DEFAULT ''::text NOT NULL,
  capacity integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  room_type text DEFAULT 'lecture'::text NOT NULL
);
CREATE TABLE public.sections (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  program text DEFAULT ''::text NOT NULL,
  year_level integer NOT NULL,
  department text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.semester_archives (
  semester_id uuid NOT NULL,
  summary jsonb NOT NULL,
  archived_at timestamp with time zone DEFAULT now() NOT NULL,
  archived_by uuid,
  archived_by_name text DEFAULT ''::text NOT NULL
);
CREATE TABLE public.semester_class_archives (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  semester_id uuid NOT NULL,
  class_id uuid NOT NULL,
  instructor_id uuid,
  code text NOT NULL,
  title text NOT NULL,
  section text NOT NULL,
  instructor_name text DEFAULT ''::text NOT NULL,
  student_count integer DEFAULT 0 NOT NULL,
  data jsonb NOT NULL,
  archived_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.semester_student_archives (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  semester_id uuid NOT NULL,
  class_id uuid NOT NULL,
  student_email text NOT NULL,
  student_name text DEFAULT ''::text NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  section text NOT NULL,
  instructor_name text DEFAULT ''::text NOT NULL,
  data jsonb NOT NULL,
  archived_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.semesters (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  semester text NOT NULL,
  academic_year text NOT NULL,
  starts_on date,
  ends_on date,
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid,
  ended_at timestamp with time zone,
  ended_by uuid,
  ended_by_name text DEFAULT ''::text NOT NULL
);
CREATE TABLE public.subjects (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  department text DEFAULT ''::text NOT NULL,
  units integer DEFAULT 3 NOT NULL,
  description text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.user_roles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  role app_role NOT NULL
);


-- ============================================================================
-- Primary keys, unique and check constraints
-- ============================================================================
ALTER TABLE public.activity_log ADD CONSTRAINT activity_log_pkey PRIMARY KEY (id);
ALTER TABLE public.announcements ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);
ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_current_academic_year_check CHECK ((current_academic_year ~ '^[0-9]{4}-[0-9]{4}$'::text));
ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_current_semester_check CHECK ((current_semester = ANY (ARRAY['1st Semester'::text, '2nd Semester'::text, 'Midyear'::text])));
ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_id_check CHECK (id);
ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_pkey PRIMARY KEY (id);
ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_semester_dates CHECK ((((semester_start IS NULL) AND (semester_end IS NULL)) OR ((semester_start IS NOT NULL) AND (semester_end IS NOT NULL) AND (semester_end > semester_start))));
ALTER TABLE public.assignments ADD CONSTRAINT assignments_attachments_array CHECK ((jsonb_typeof(attachments) = 'array'::text));
ALTER TABLE public.assignments ADD CONSTRAINT assignments_pkey PRIMARY KEY (id);
ALTER TABLE public.attendance_records ADD CONSTRAINT attendance_records_pkey PRIMARY KEY (id);
ALTER TABLE public.attendance_records ADD CONSTRAINT attendance_records_session_id_student_email_key UNIQUE (session_id, student_email);
ALTER TABLE public.attendance_records ADD CONSTRAINT attendance_records_status_check CHECK ((status = ANY (ARRAY['present'::text, 'absent'::text])));
ALTER TABLE public.attendance_sessions ADD CONSTRAINT attendance_sessions_class_id_session_date_key UNIQUE (class_id, session_date);
ALTER TABLE public.attendance_sessions ADD CONSTRAINT attendance_sessions_pkey PRIMARY KEY (id);
ALTER TABLE public.class_schedules ADD CONSTRAINT class_schedules_day_of_week_check CHECK (((day_of_week >= 1) AND (day_of_week <= 7)));
ALTER TABLE public.class_schedules ADD CONSTRAINT class_schedules_pkey PRIMARY KEY (id);
ALTER TABLE public.class_students ADD CONSTRAINT class_students_class_id_email_key UNIQUE (class_id, email);
ALTER TABLE public.class_students ADD CONSTRAINT class_students_pkey PRIMARY KEY (id);
ALTER TABLE public.classes ADD CONSTRAINT classes_pkey PRIMARY KEY (id);
ALTER TABLE public.instructor_profiles ADD CONSTRAINT instructor_profiles_pkey PRIMARY KEY (user_id);
ALTER TABLE public.instructor_profiles ADD CONSTRAINT instructor_profiles_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'suspended'::text])));
ALTER TABLE public.instructor_schedules ADD CONSTRAINT instructor_schedules_academic_year_check CHECK ((academic_year ~ '^[0-9]{4}-[0-9]{4}$'::text));
ALTER TABLE public.instructor_schedules ADD CONSTRAINT instructor_schedules_day_of_week_check CHECK (((day_of_week >= 1) AND (day_of_week <= 7)));
ALTER TABLE public.instructor_schedules ADD CONSTRAINT instructor_schedules_no_instructor_overlap EXCLUDE USING gist (instructor_id WITH =, semester WITH =, academic_year WITH =, day_of_week WITH =, timerange(start_time, end_time) WITH &&);
ALTER TABLE public.instructor_schedules ADD CONSTRAINT instructor_schedules_no_room_overlap EXCLUDE USING gist (room_id WITH =, semester WITH =, academic_year WITH =, day_of_week WITH =, timerange(start_time, end_time) WITH &&);
ALTER TABLE public.instructor_schedules ADD CONSTRAINT instructor_schedules_no_section_overlap EXCLUDE USING gist (section_id WITH =, semester WITH =, academic_year WITH =, day_of_week WITH =, timerange(start_time, end_time) WITH &&);
ALTER TABLE public.instructor_schedules ADD CONSTRAINT instructor_schedules_pkey PRIMARY KEY (id);
ALTER TABLE public.instructor_schedules ADD CONSTRAINT instructor_schedules_semester_check CHECK ((semester = ANY (ARRAY['1st Semester'::text, '2nd Semester'::text, 'Midyear'::text])));
ALTER TABLE public.instructor_schedules ADD CONSTRAINT instructor_schedules_time_order CHECK ((end_time > start_time));
ALTER TABLE public.instructor_verifications ADD CONSTRAINT instructor_verifications_decision_check CHECK ((decision = ANY (ARRAY['approved'::text, 'rejected'::text, 'suspended'::text, 'reactivated'::text])));
ALTER TABLE public.instructor_verifications ADD CONSTRAINT instructor_verifications_pkey PRIMARY KEY (id);
ALTER TABLE public.invitations ADD CONSTRAINT invitations_pkey PRIMARY KEY (email);
ALTER TABLE public.invitations ADD CONSTRAINT invitations_role_check CHECK (((role)::text = ANY (ARRAY['instructor'::text, 'student'::text])));
ALTER TABLE public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE public.omr_scans ADD CONSTRAINT omr_scans_pkey PRIMARY KEY (id);
ALTER TABLE public.omr_scans ADD CONSTRAINT omr_scans_source_check CHECK ((source = ANY (ARRAY['physical_scanner'::text, 'mobile_camera'::text])));
ALTER TABLE public.omr_scans ADD CONSTRAINT omr_scans_status_check CHECK ((status = ANY (ARRAY['uploaded'::text, 'processing'::text, 'failed'::text, 'needs_review'::text, 'ready'::text, 'finalized'::text, 'duplicate'::text])));
ALTER TABLE public.omr_sheets ADD CONSTRAINT omr_sheets_pkey PRIMARY KEY (id);
ALTER TABLE public.omr_sheets ADD CONSTRAINT omr_sheets_quiz_id_student_email_key UNIQUE (quiz_id, student_email);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text])));
ALTER TABLE public.quiz_answer_keys ADD CONSTRAINT quiz_answer_keys_correct_index_check CHECK ((correct_index >= 0));
ALTER TABLE public.quiz_answer_keys ADD CONSTRAINT quiz_answer_keys_pkey PRIMARY KEY (question_id);
ALTER TABLE public.quiz_attempts ADD CONSTRAINT quiz_attempts_pkey PRIMARY KEY (id);
ALTER TABLE public.quiz_attempts ADD CONSTRAINT quiz_attempts_quiz_id_student_id_key UNIQUE (quiz_id, student_id);
ALTER TABLE public.quiz_questions ADD CONSTRAINT quiz_questions_pkey PRIMARY KEY (id);
ALTER TABLE public.quiz_questions ADD CONSTRAINT quiz_questions_points_check CHECK ((((points >= 1) AND (points <= 100)) AND ((item_count >= 1) AND (item_count <= 50))));
ALTER TABLE public.quiz_questions ADD CONSTRAINT quiz_questions_type_check CHECK ((type = ANY (ARRAY['multiple_choice'::text, 'true_false'::text, 'modified_true_false'::text, 'identification'::text, 'enumeration'::text, 'essay'::text])));
ALTER TABLE public.quizzes ADD CONSTRAINT quizzes_kind_check CHECK ((kind = ANY (ARRAY['quiz'::text, 'exam'::text])));
ALTER TABLE public.quizzes ADD CONSTRAINT quizzes_passing_score_check CHECK (((passing_score >= 0) AND (passing_score <= 100)));
ALTER TABLE public.quizzes ADD CONSTRAINT quizzes_pkey PRIMARY KEY (id);
ALTER TABLE public.quizzes ADD CONSTRAINT quizzes_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text])));
ALTER TABLE public.quizzes ADD CONSTRAINT quizzes_time_limit_minutes_check CHECK (((time_limit_minutes >= 1) AND (time_limit_minutes <= 600)));
ALTER TABLE public.renewals ADD CONSTRAINT renewals_kind_check CHECK ((kind = ANY (ARRAY['student'::text, 'instructor'::text])));
ALTER TABLE public.renewals ADD CONSTRAINT renewals_pkey PRIMARY KEY (id);
ALTER TABLE public.renewals ADD CONSTRAINT renewals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
ALTER TABLE public.rooms ADD CONSTRAINT rooms_capacity_check CHECK (((capacity IS NULL) OR (capacity > 0)));
ALTER TABLE public.rooms ADD CONSTRAINT rooms_name_check CHECK ((TRIM(BOTH FROM name) <> ''::text));
ALTER TABLE public.rooms ADD CONSTRAINT rooms_pkey PRIMARY KEY (id);
ALTER TABLE public.rooms ADD CONSTRAINT rooms_room_type_check CHECK ((room_type = ANY (ARRAY['lecture'::text, 'laboratory'::text])));
ALTER TABLE public.sections ADD CONSTRAINT sections_name_check CHECK ((TRIM(BOTH FROM name) <> ''::text));
ALTER TABLE public.sections ADD CONSTRAINT sections_pkey PRIMARY KEY (id);
ALTER TABLE public.sections ADD CONSTRAINT sections_year_level_check CHECK (((year_level >= 1) AND (year_level <= 6)));
ALTER TABLE public.semester_archives ADD CONSTRAINT semester_archives_pkey PRIMARY KEY (semester_id);
ALTER TABLE public.semester_class_archives ADD CONSTRAINT semester_class_archives_pkey PRIMARY KEY (id);
ALTER TABLE public.semester_class_archives ADD CONSTRAINT semester_class_archives_semester_id_class_id_key UNIQUE (semester_id, class_id);
ALTER TABLE public.semester_student_archives ADD CONSTRAINT semester_student_archives_pkey PRIMARY KEY (id);
ALTER TABLE public.semester_student_archives ADD CONSTRAINT semester_student_archives_semester_id_class_id_student_emai_key UNIQUE (semester_id, class_id, student_email);
ALTER TABLE public.semesters ADD CONSTRAINT semesters_pkey PRIMARY KEY (id);
ALTER TABLE public.semesters ADD CONSTRAINT semesters_semester_academic_year_key UNIQUE (semester, academic_year);
ALTER TABLE public.semesters ADD CONSTRAINT semesters_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text])));
ALTER TABLE public.subjects ADD CONSTRAINT subjects_code_check CHECK ((TRIM(BOTH FROM code) <> ''::text));
ALTER TABLE public.subjects ADD CONSTRAINT subjects_name_check CHECK ((TRIM(BOTH FROM name) <> ''::text));
ALTER TABLE public.subjects ADD CONSTRAINT subjects_pkey PRIMARY KEY (id);
ALTER TABLE public.subjects ADD CONSTRAINT subjects_units_check CHECK (((units >= 0) AND (units <= 12)));
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


-- ============================================================================
-- Foreign keys
-- ============================================================================
ALTER TABLE public.announcements ADD CONSTRAINT announcements_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE;
ALTER TABLE public.announcements ADD CONSTRAINT announcements_posted_by_fkey FOREIGN KEY (posted_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.assignments ADD CONSTRAINT assignments_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE;
ALTER TABLE public.attendance_records ADD CONSTRAINT attendance_records_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE;
ALTER TABLE public.attendance_records ADD CONSTRAINT attendance_records_session_id_fkey FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE;
ALTER TABLE public.attendance_sessions ADD CONSTRAINT attendance_sessions_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE;
ALTER TABLE public.attendance_sessions ADD CONSTRAINT attendance_sessions_taken_by_fkey FOREIGN KEY (taken_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.class_schedules ADD CONSTRAINT class_schedules_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE;
ALTER TABLE public.class_students ADD CONSTRAINT class_students_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE;
ALTER TABLE public.classes ADD CONSTRAINT classes_section_id_fkey FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE SET NULL;
ALTER TABLE public.classes ADD CONSTRAINT classes_semester_id_fkey FOREIGN KEY (semester_id) REFERENCES semesters(id);
ALTER TABLE public.classes ADD CONSTRAINT classes_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL;
ALTER TABLE public.instructor_profiles ADD CONSTRAINT instructor_profiles_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.instructor_profiles ADD CONSTRAINT instructor_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.instructor_schedules ADD CONSTRAINT instructor_schedules_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.instructor_schedules ADD CONSTRAINT instructor_schedules_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE RESTRICT;
ALTER TABLE public.instructor_schedules ADD CONSTRAINT instructor_schedules_section_id_fkey FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE RESTRICT;
ALTER TABLE public.instructor_schedules ADD CONSTRAINT instructor_schedules_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE RESTRICT;
ALTER TABLE public.instructor_verifications ADD CONSTRAINT instructor_verifications_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.instructor_verifications ADD CONSTRAINT instructor_verifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.invitations ADD CONSTRAINT invitations_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.omr_scans ADD CONSTRAINT omr_scans_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES quiz_attempts(id) ON DELETE SET NULL;
ALTER TABLE public.omr_scans ADD CONSTRAINT omr_scans_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE;
ALTER TABLE public.omr_scans ADD CONSTRAINT omr_scans_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.omr_scans ADD CONSTRAINT omr_scans_finalized_by_fkey FOREIGN KEY (finalized_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.omr_scans ADD CONSTRAINT omr_scans_quiz_id_fkey FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE;
ALTER TABLE public.omr_scans ADD CONSTRAINT omr_scans_sheet_id_fkey FOREIGN KEY (sheet_id) REFERENCES omr_sheets(id) ON DELETE SET NULL;
ALTER TABLE public.omr_sheets ADD CONSTRAINT omr_sheets_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE;
ALTER TABLE public.omr_sheets ADD CONSTRAINT omr_sheets_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.omr_sheets ADD CONSTRAINT omr_sheets_quiz_id_fkey FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_section_id_fkey FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE SET NULL;
ALTER TABLE public.quiz_answer_keys ADD CONSTRAINT quiz_answer_keys_question_id_fkey FOREIGN KEY (question_id) REFERENCES quiz_questions(id) ON DELETE CASCADE;
ALTER TABLE public.quiz_answer_keys ADD CONSTRAINT quiz_answer_keys_quiz_id_fkey FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE;
ALTER TABLE public.quiz_attempts ADD CONSTRAINT quiz_attempts_quiz_id_fkey FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE;
ALTER TABLE public.quiz_questions ADD CONSTRAINT quiz_questions_quiz_id_fkey FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE;
ALTER TABLE public.quizzes ADD CONSTRAINT quizzes_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE;
ALTER TABLE public.renewals ADD CONSTRAINT renewals_assigned_section_id_fkey FOREIGN KEY (assigned_section_id) REFERENCES sections(id) ON DELETE SET NULL;
ALTER TABLE public.renewals ADD CONSTRAINT renewals_preferred_section_id_fkey FOREIGN KEY (preferred_section_id) REFERENCES sections(id) ON DELETE SET NULL;
ALTER TABLE public.renewals ADD CONSTRAINT renewals_semester_id_fkey FOREIGN KEY (semester_id) REFERENCES semesters(id);
ALTER TABLE public.renewals ADD CONSTRAINT renewals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.semester_archives ADD CONSTRAINT semester_archives_semester_id_fkey FOREIGN KEY (semester_id) REFERENCES semesters(id);
ALTER TABLE public.semester_class_archives ADD CONSTRAINT semester_class_archives_semester_id_fkey FOREIGN KEY (semester_id) REFERENCES semesters(id);
ALTER TABLE public.semester_student_archives ADD CONSTRAINT semester_student_archives_semester_id_fkey FOREIGN KEY (semester_id) REFERENCES semesters(id);
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- ============================================================================
-- Indexes
-- ============================================================================
CREATE INDEX activity_log_created ON public.activity_log USING btree (created_at DESC);
CREATE INDEX announcements_class ON public.announcements USING btree (class_id);
CREATE INDEX assignments_class ON public.assignments USING btree (class_id);
CREATE INDEX attendance_records_student ON public.attendance_records USING btree (student_email, class_id);
CREATE INDEX attendance_sessions_class ON public.attendance_sessions USING btree (class_id, session_date DESC);
CREATE INDEX class_schedules_class ON public.class_schedules USING btree (class_id);
CREATE INDEX class_students_email ON public.class_students USING btree (email);
CREATE INDEX classes_section ON public.classes USING btree (section_id);
CREATE INDEX classes_semester ON public.classes USING btree (semester_id);
CREATE UNIQUE INDEX classes_subject_section_instructor ON public.classes USING btree (subject_id, section_id, instructor_id) WHERE ((subject_id IS NOT NULL) AND (section_id IS NOT NULL) AND (archived_at IS NULL));
CREATE UNIQUE INDEX instructor_profiles_employee_id ON public.instructor_profiles USING btree (lower(employee_id)) WHERE (employee_id <> ''::text);
CREATE INDEX instructor_profiles_status ON public.instructor_profiles USING btree (status, submitted_at DESC);
CREATE INDEX instructor_schedules_instructor ON public.instructor_schedules USING btree (instructor_id, academic_year, semester);
CREATE INDEX instructor_schedules_room ON public.instructor_schedules USING btree (room_id);
CREATE INDEX instructor_schedules_section ON public.instructor_schedules USING btree (section_id, academic_year, semester);
CREATE INDEX instructor_schedules_subject ON public.instructor_schedules USING btree (subject_id);
CREATE INDEX instructor_verifications_user ON public.instructor_verifications USING btree (user_id, decided_at DESC);
CREATE INDEX notifications_user ON public.notifications USING btree (user_id, created_at DESC);
CREATE UNIQUE INDEX omr_scans_one_final ON public.omr_scans USING btree (sheet_id) WHERE (status = 'finalized'::text);
CREATE INDEX omr_scans_quiz ON public.omr_scans USING btree (quiz_id, created_at DESC);
CREATE INDEX omr_scans_sheet ON public.omr_scans USING btree (sheet_id);
CREATE INDEX profiles_section ON public.profiles USING btree (section_id);
CREATE INDEX quiz_questions_quiz ON public.quiz_questions USING btree (quiz_id, "position");
CREATE INDEX quizzes_class ON public.quizzes USING btree (class_id);
CREATE UNIQUE INDEX renewals_one_per_semester ON public.renewals USING btree (semester_id, user_id) WHERE (semester_id IS NOT NULL);
CREATE UNIQUE INDEX renewals_one_upcoming ON public.renewals USING btree (user_id) WHERE (semester_id IS NULL);
CREATE INDEX renewals_semester_status ON public.renewals USING btree (semester_id, kind, status);
CREATE UNIQUE INDEX rooms_name ON public.rooms USING btree (lower(name));
CREATE UNIQUE INDEX sections_name ON public.sections USING btree (lower(name));
CREATE INDEX semester_class_archives_instructor ON public.semester_class_archives USING btree (instructor_id, semester_id);
CREATE INDEX semester_student_archives_email ON public.semester_student_archives USING btree (student_email, semester_id);
CREATE UNIQUE INDEX semesters_one_active ON public.semesters USING btree (status) WHERE (status = 'active'::text);
CREATE UNIQUE INDEX subjects_code ON public.subjects USING btree (lower(code));


-- ============================================================================
-- Triggers
-- ============================================================================
CREATE TRIGGER announcements_author BEFORE INSERT OR UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION trg_announcement_author();
CREATE TRIGGER guard_archived BEFORE INSERT OR DELETE OR UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION guard_archived_class();
CREATE TRIGGER log_announcements AFTER INSERT ON public.announcements FOR EACH ROW EXECUTE FUNCTION trg_log_class_content();
CREATE TRIGGER app_settings_touch BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER settings_check_dates BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION trg_settings_check_dates();
CREATE TRIGGER settings_sync_semester AFTER UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION trg_settings_sync_semester();
CREATE TRIGGER guard_archived BEFORE INSERT OR DELETE OR UPDATE ON public.assignments FOR EACH ROW EXECUTE FUNCTION guard_archived_class();
CREATE TRIGGER log_assignments AFTER INSERT ON public.assignments FOR EACH ROW EXECUTE FUNCTION trg_log_class_content();
CREATE TRIGGER guard_archived BEFORE INSERT OR DELETE OR UPDATE ON public.attendance_records FOR EACH ROW EXECUTE FUNCTION guard_archived_class();
CREATE TRIGGER guard_archived BEFORE INSERT OR DELETE OR UPDATE ON public.attendance_sessions FOR EACH ROW EXECUTE FUNCTION guard_archived_class();
CREATE TRIGGER guard_archived BEFORE INSERT OR DELETE OR UPDATE ON public.class_schedules FOR EACH ROW EXECUTE FUNCTION guard_archived_class();
CREATE TRIGGER log_schedules AFTER INSERT ON public.class_schedules FOR EACH ROW EXECUTE FUNCTION trg_log_class_content();
CREATE TRIGGER class_students_lower BEFORE INSERT OR UPDATE ON public.class_students FOR EACH ROW EXECUTE FUNCTION lower_email();
CREATE TRIGGER guard_archived BEFORE INSERT OR DELETE OR UPDATE ON public.class_students FOR EACH ROW EXECUTE FUNCTION guard_archived_class();
CREATE TRIGGER log_enrollment AFTER INSERT OR DELETE ON public.class_students FOR EACH ROW EXECUTE FUNCTION trg_log_enrollment();
CREATE TRIGGER classes_from_subject_only BEFORE INSERT ON public.classes FOR EACH ROW EXECUTE FUNCTION classes_from_subject_only();
CREATE TRIGGER classes_keep_scheduled BEFORE DELETE ON public.classes FOR EACH ROW EXECUTE FUNCTION classes_keep_scheduled();
CREATE TRIGGER classes_no_duplicate BEFORE INSERT OR UPDATE OF code, section, instructor_id ON public.classes FOR EACH ROW EXECUTE FUNCTION classes_no_duplicate();
CREATE TRIGGER classes_touch BEFORE UPDATE ON public.classes FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER guard_archived_row BEFORE DELETE OR UPDATE ON public.classes FOR EACH ROW EXECUTE FUNCTION guard_archived_class_row();
CREATE TRIGGER log_classes AFTER INSERT ON public.classes FOR EACH ROW EXECUTE FUNCTION trg_log_class_content();
CREATE TRIGGER instructor_approved_renewal AFTER INSERT OR UPDATE OF status ON public.instructor_profiles FOR EACH ROW EXECUTE FUNCTION trg_instructor_approved_renewal();
CREATE TRIGGER instructor_schedules_notify AFTER INSERT OR DELETE OR UPDATE ON public.instructor_schedules FOR EACH ROW EXECUTE FUNCTION instructor_schedules_notify();
CREATE TRIGGER instructor_schedules_validate BEFORE INSERT OR UPDATE ON public.instructor_schedules FOR EACH ROW EXECUTE FUNCTION instructor_schedules_validate();
CREATE TRIGGER schedule_class AFTER INSERT OR UPDATE OF subject_id, section_id, instructor_id ON public.instructor_schedules FOR EACH ROW EXECUTE FUNCTION trg_schedule_class();
CREATE TRIGGER schedule_needs_renewal BEFORE INSERT OR UPDATE OF instructor_id, semester, academic_year ON public.instructor_schedules FOR EACH ROW EXECUTE FUNCTION trg_schedule_needs_renewal();
CREATE TRIGGER invitations_lower BEFORE INSERT OR UPDATE ON public.invitations FOR EACH ROW EXECUTE FUNCTION lower_email();
CREATE TRIGGER log_invitations AFTER INSERT ON public.invitations FOR EACH ROW EXECUTE FUNCTION trg_log_invitation();
CREATE TRIGGER guard_archived BEFORE INSERT OR DELETE OR UPDATE ON public.omr_scans FOR EACH ROW EXECUTE FUNCTION guard_archived_class();
CREATE TRIGGER omr_scans_guard BEFORE UPDATE ON public.omr_scans FOR EACH ROW EXECUTE FUNCTION omr_scans_guard();
CREATE TRIGGER guard_archived BEFORE INSERT OR DELETE OR UPDATE ON public.omr_sheets FOR EACH ROW EXECUTE FUNCTION guard_archived_class();
CREATE TRIGGER log_profiles AFTER UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION trg_log_profile();
CREATE TRIGGER profile_section_classes AFTER INSERT OR UPDATE OF section_id ON public.profiles FOR EACH ROW EXECUTE FUNCTION trg_profile_section_classes();
CREATE TRIGGER profile_section_renewal AFTER UPDATE OF section_id ON public.profiles FOR EACH ROW EXECUTE FUNCTION trg_section_renewal();
CREATE TRIGGER profile_suspension BEFORE UPDATE OF status, suspension_reason ON public.profiles FOR EACH ROW EXECUTE FUNCTION trg_profile_suspension();
CREATE TRIGGER profiles_guard BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION profiles_guard();
CREATE TRIGGER profiles_section_assigned AFTER UPDATE OF section_id ON public.profiles FOR EACH ROW EXECUTE FUNCTION trg_section_assigned();
CREATE TRIGGER guard_archived BEFORE INSERT OR DELETE OR UPDATE ON public.quiz_answer_keys FOR EACH ROW EXECUTE FUNCTION guard_archived_class();
CREATE TRIGGER guard_archived BEFORE INSERT OR DELETE OR UPDATE ON public.quiz_attempts FOR EACH ROW EXECUTE FUNCTION guard_archived_class();
CREATE TRIGGER log_attempts AFTER INSERT ON public.quiz_attempts FOR EACH ROW EXECUTE FUNCTION trg_log_attempt();
CREATE TRIGGER guard_archived BEFORE INSERT OR DELETE OR UPDATE ON public.quiz_questions FOR EACH ROW EXECUTE FUNCTION guard_archived_class();
CREATE TRIGGER guard_archived BEFORE INSERT OR DELETE OR UPDATE ON public.quizzes FOR EACH ROW EXECUTE FUNCTION guard_archived_class();
CREATE TRIGGER log_quiz_published AFTER INSERT OR UPDATE OF status ON public.quizzes FOR EACH ROW EXECUTE FUNCTION trg_log_quiz_published();
CREATE TRIGGER quizzes_touch BEFORE UPDATE ON public.quizzes FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER section_rename_classes AFTER UPDATE ON public.sections FOR EACH ROW EXECUTE FUNCTION trg_section_rename_classes();
CREATE TRIGGER sections_touch BEFORE UPDATE ON public.sections FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER semester_closed AFTER UPDATE OF status ON public.semesters FOR EACH ROW EXECUTE FUNCTION trg_semester_closed();
CREATE TRIGGER semester_opened AFTER INSERT ON public.semesters FOR EACH ROW EXECUTE FUNCTION trg_semester_opened();
CREATE TRIGGER subject_rename_classes AFTER UPDATE ON public.subjects FOR EACH ROW EXECUTE FUNCTION trg_subject_rename_classes();
CREATE TRIGGER subjects_touch BEFORE UPDATE ON public.subjects FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER admin_not_student BEFORE INSERT OR UPDATE OF role ON public.user_roles FOR EACH ROW EXECUTE FUNCTION trg_admin_not_student();
CREATE TRIGGER role_section_classes AFTER INSERT OR DELETE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION trg_role_section_classes();
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ============================================================================
-- Row-level security
-- ============================================================================
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instructor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instructor_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instructor_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omr_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omr_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_answer_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.semester_archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.semester_class_archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.semester_student_archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.semesters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- Policies (who may read / write what)
-- ============================================================================
CREATE POLICY "Admins read activity" ON public.activity_log AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_admin());
CREATE POLICY "Admins read announcements" ON public.announcements AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_admin());
CREATE POLICY "Instructors write announcements" ON public.announcements AS PERMISSIVE FOR ALL TO authenticated
  USING (is_class_instructor(class_id))
  WITH CHECK (is_class_instructor(class_id));
CREATE POLICY "Read announcements" ON public.announcements AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_class_instructor(class_id) OR is_class_student(class_id)));
CREATE POLICY "Admins manage app_settings" ON public.app_settings AS PERMISSIVE FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
CREATE POLICY "Signed-in users read app_settings" ON public.app_settings AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Admins read assignments" ON public.assignments AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_admin());
CREATE POLICY "Instructors write assignments" ON public.assignments AS PERMISSIVE FOR ALL TO authenticated
  USING (is_class_instructor(class_id))
  WITH CHECK (is_class_instructor(class_id));
CREATE POLICY "Read assignments" ON public.assignments AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_class_instructor(class_id) OR is_class_student(class_id)));
CREATE POLICY "Read attendance records" ON public.attendance_records AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_class_instructor(class_id) OR is_admin() OR (is_class_student(class_id) AND (student_email = current_email()))));
CREATE POLICY "Instructors delete attendance sessions" ON public.attendance_sessions AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_class_instructor(class_id));
CREATE POLICY "Instructors read attendance sessions" ON public.attendance_sessions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_class_instructor(class_id) OR is_admin() OR is_class_student(class_id)));
CREATE POLICY "Admins manage schedules" ON public.class_schedules AS PERMISSIVE FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
CREATE POLICY "Instructors write schedules" ON public.class_schedules AS PERMISSIVE FOR ALL TO authenticated
  USING (is_class_instructor(class_id))
  WITH CHECK (is_class_instructor(class_id));
CREATE POLICY "Read schedules" ON public.class_schedules AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_class_instructor(class_id) OR is_class_student(class_id)));
CREATE POLICY "Admins manage enrollment" ON public.class_students AS PERMISSIVE FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
CREATE POLICY "Instructors add students" ON public.class_students AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_class_instructor(class_id));
CREATE POLICY "Instructors edit students" ON public.class_students AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_class_instructor(class_id))
  WITH CHECK (is_class_instructor(class_id));
CREATE POLICY "Instructors remove students" ON public.class_students AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_class_instructor(class_id));
CREATE POLICY "Read class roster" ON public.class_students AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_class_instructor(class_id) OR (email = current_email())));
CREATE POLICY "Admins manage classes" ON public.classes AS PERMISSIVE FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
CREATE POLICY "Instructors create classes" ON public.classes AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((instructor_id = auth.uid()) AND is_approved_instructor(auth.uid())));
CREATE POLICY "Instructors delete own classes" ON public.classes AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_class_instructor(id));
CREATE POLICY "Instructors read own classes" ON public.classes AS PERMISSIVE FOR SELECT TO authenticated
  USING ((((instructor_id = auth.uid()) AND (archived_at IS NULL) AND is_active_user() AND instructor_not_suspended()) OR is_class_student(id)));
CREATE POLICY "Instructors update own classes" ON public.classes AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_class_instructor(id))
  WITH CHECK ((instructor_id = auth.uid()));
CREATE POLICY "Admins read applications" ON public.instructor_profiles AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_admin());
CREATE POLICY "Read own application" ON public.instructor_profiles AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));
CREATE POLICY "Admins manage schedules" ON public.instructor_schedules AS PERMISSIVE FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
CREATE POLICY "Instructors read own schedule" ON public.instructor_schedules AS PERMISSIVE FOR SELECT TO authenticated
  USING (((instructor_id = auth.uid()) AND is_approved_instructor(auth.uid())));
CREATE POLICY "Students read own section schedule" ON public.instructor_schedules AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_active_user() AND (section_id = ( SELECT profiles.section_id
   FROM profiles
  WHERE (profiles.id = auth.uid())))));
CREATE POLICY "Admins read decisions" ON public.instructor_verifications AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_admin());
CREATE POLICY "Read own decisions" ON public.instructor_verifications AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));
CREATE POLICY "Admins manage invitations" ON public.invitations AS PERMISSIVE FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
CREATE POLICY "Delete own notifications" ON public.notifications AS PERMISSIVE FOR DELETE TO authenticated
  USING ((user_id = auth.uid()));
CREATE POLICY "Mark own notifications read" ON public.notifications AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "Read own notifications" ON public.notifications AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));
CREATE POLICY "Instructors add scans" ON public.omr_scans AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_class_instructor(class_id) AND (created_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM quizzes q
  WHERE ((q.id = omr_scans.quiz_id) AND (q.class_id = omr_scans.class_id))))));
CREATE POLICY "Instructors and admins read scans" ON public.omr_scans AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_class_instructor(class_id) OR is_admin()));
CREATE POLICY "Instructors delete unfinalized scans" ON public.omr_scans AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_class_instructor(class_id) AND (status <> 'finalized'::text)));
CREATE POLICY "Instructors update scans" ON public.omr_scans AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_class_instructor(class_id))
  WITH CHECK (is_class_instructor(class_id));
CREATE POLICY "Instructors and admins read sheets" ON public.omr_sheets AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_class_instructor(class_id) OR is_admin()));
CREATE POLICY "Admins read profiles" ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_admin());
CREATE POLICY "Admins update profiles" ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
CREATE POLICY "Read own profile" ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated
  USING ((id = auth.uid()));
CREATE POLICY "Update own profile" ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((id = auth.uid()))
  WITH CHECK ((id = auth.uid()));
CREATE POLICY "Admins read answer keys" ON public.quiz_answer_keys AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_admin());
CREATE POLICY "Instructors read answer keys" ON public.quiz_answer_keys AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_manage_quiz(quiz_id));
CREATE POLICY "Admins read attempts" ON public.quiz_attempts AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_admin());
CREATE POLICY "Read attempts" ON public.quiz_attempts AS PERMISSIVE FOR SELECT TO authenticated
  USING (((student_id = auth.uid()) OR can_manage_quiz(quiz_id)));
CREATE POLICY "Admins read questions" ON public.quiz_questions AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_admin());
CREATE POLICY "Instructors read own questions" ON public.quiz_questions AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_manage_quiz(quiz_id));
CREATE POLICY "Read questions" ON public.quiz_questions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((can_manage_quiz(quiz_id) OR can_take_quiz(quiz_id)));
CREATE POLICY "Admins read quizzes" ON public.quizzes AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_admin());
CREATE POLICY "Instructors create quizzes" ON public.quizzes AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_class_instructor(class_id));
CREATE POLICY "Instructors delete quizzes" ON public.quizzes AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_class_instructor(class_id));
CREATE POLICY "Instructors update quizzes" ON public.quizzes AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_class_instructor(class_id))
  WITH CHECK (is_class_instructor(class_id));
CREATE POLICY "Read quizzes" ON public.quizzes AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_class_instructor(class_id) OR ((status = 'published'::text) AND is_class_student(class_id))));
CREATE POLICY "Read own or admin renewals" ON public.renewals AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = auth.uid()) OR is_admin()));
CREATE POLICY "Admins manage rooms" ON public.rooms AS PERMISSIVE FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
CREATE POLICY "Signed-in users read rooms" ON public.rooms AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Admins manage sections" ON public.sections AS PERMISSIVE FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
CREATE POLICY "Anyone reads sections" ON public.sections AS PERMISSIVE FOR SELECT TO anon
  USING (true);
CREATE POLICY "Signed-in users read sections" ON public.sections AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Admins read semester archives" ON public.semester_archives AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_admin());
CREATE POLICY "Read own archived classes" ON public.semester_class_archives AS PERMISSIVE FOR SELECT TO authenticated
  USING (((instructor_id = auth.uid()) OR is_admin()));
CREATE POLICY "Read own archived records" ON public.semester_student_archives AS PERMISSIVE FOR SELECT TO authenticated
  USING ((((student_email = current_email()) AND (current_email() <> ''::text)) OR is_admin()));
CREATE POLICY "Read semesters" ON public.semesters AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Admins manage subjects" ON public.subjects AS PERMISSIVE FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
CREATE POLICY "Signed-in users read subjects" ON public.subjects AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Admins read roles" ON public.user_roles AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_admin());
CREATE POLICY "Read own roles" ON public.user_roles AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));


-- ============================================================================
-- Table permissions
-- ============================================================================
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.activity_log TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.activity_log TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.announcements TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.announcements TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.app_settings TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.app_settings TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.assignments TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.assignments TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.attendance_records TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.attendance_records TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.attendance_sessions TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.attendance_sessions TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.class_schedules TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.class_schedules TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.class_students TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.class_students TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.classes TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.classes TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.instructor_profiles TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.instructor_profiles TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.instructor_schedules TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.instructor_schedules TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.instructor_verifications TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.instructor_verifications TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.invitations TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.invitations TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.notifications TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.notifications TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.omr_scans TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.omr_scans TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.omr_sheets TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.omr_sheets TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.profiles TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.profiles TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.quiz_answer_keys TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.quiz_answer_keys TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.quiz_attempts TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.quiz_attempts TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.quiz_questions TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.quiz_questions TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.quizzes TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.quizzes TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.renewals TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.renewals TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rooms TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rooms TO service_role;
GRANT SELECT ON public.sections TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sections TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sections TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.semester_archives TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.semester_archives TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.semester_class_archives TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.semester_class_archives TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.semester_student_archives TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.semester_student_archives TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.semesters TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.semesters TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.subjects TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.subjects TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.user_roles TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.user_roles TO service_role;


-- ============================================================================
-- Function permissions
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.admin_delete_instructor(_user_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_instructor(_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_instructor(_user_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.admin_save_instructor(_user_id uuid, _full_name text, _employee_id text, _department text, _contact_number text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_instructor(_user_id uuid, _full_name text, _employee_id text, _department text, _contact_number text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_instructor(_user_id uuid, _full_name text, _employee_id text, _department text, _contact_number text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.admin_set_role(_user_id uuid, _role app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_role(_user_id uuid, _role app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_role(_user_id uuid, _role app_role) TO service_role;
REVOKE EXECUTE ON FUNCTION public.answer_matches(_given text, _accepted jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.answer_matches(_given text, _accepted jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.answer_matches(_given text, _accepted jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.archive_class_snapshot(_class uuid, _sem semesters) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_class_snapshot(_class uuid, _sem semesters) TO service_role;
REVOKE EXECUTE ON FUNCTION public.archive_student_snapshot(_snap jsonb, _email text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_student_snapshot(_snap jsonb, _email text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.assignment_file_class(_name text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assignment_file_class(_name text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assignment_file_class(_name text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.can_manage_quiz(_quiz_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_quiz(_quiz_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_quiz(_quiz_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.can_take_quiz(_quiz_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_take_quiz(_quiz_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_take_quiz(_quiz_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.choose_my_section(_section_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.choose_my_section(_section_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.choose_my_section(_section_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.claim_role(_role app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_role(_role app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_role(_role app_role) TO service_role;
REVOKE EXECUTE ON FUNCTION public.class_label(_class_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.class_label(_class_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.class_label(_class_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.classes_from_subject_only() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classes_from_subject_only() TO authenticated;
GRANT EXECUTE ON FUNCTION public.classes_from_subject_only() TO service_role;
REVOKE EXECUTE ON FUNCTION public.classes_keep_scheduled() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classes_keep_scheduled() TO service_role;
REVOKE EXECUTE ON FUNCTION public.classes_no_duplicate() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classes_no_duplicate() TO authenticated;
GRANT EXECUTE ON FUNCTION public.classes_no_duplicate() TO service_role;
REVOKE EXECUTE ON FUNCTION public.current_email() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_email() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_email() TO service_role;
REVOKE EXECUTE ON FUNCTION public.current_semester_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_semester_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_semester_id() TO service_role;
REVOKE EXECUTE ON FUNCTION public.day_label(_d integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.day_label(_d integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.day_label(_d integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.end_semester(_semester_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_semester(_semester_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_semester(_semester_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.ensure_schedule_class(_subject uuid, _section uuid, _instructor uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_schedule_class(_subject uuid, _section uuid, _instructor uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.grade_attempt(_attempt_id uuid, _scores jsonb, _feedback text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grade_attempt(_attempt_id uuid, _scores jsonb, _feedback text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grade_attempt(_attempt_id uuid, _scores jsonb, _feedback text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.guard_archived_class() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_archived_class() TO service_role;
REVOKE EXECUTE ON FUNCTION public.guard_archived_class_row() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_archived_class_row() TO service_role;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
REVOKE EXECUTE ON FUNCTION public.has_role(_user_id uuid, _role app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(_user_id uuid, _role app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(_user_id uuid, _role app_role) TO service_role;
REVOKE EXECUTE ON FUNCTION public.instructor_not_suspended() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instructor_not_suspended() TO authenticated;
GRANT EXECUTE ON FUNCTION public.instructor_not_suspended() TO service_role;
REVOKE EXECUTE ON FUNCTION public.instructor_schedules_notify() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instructor_schedules_notify() TO authenticated;
GRANT EXECUTE ON FUNCTION public.instructor_schedules_notify() TO service_role;
REVOKE EXECUTE ON FUNCTION public.instructor_schedules_validate() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instructor_schedules_validate() TO authenticated;
GRANT EXECUTE ON FUNCTION public.instructor_schedules_validate() TO service_role;
REVOKE EXECUTE ON FUNCTION public.is_active_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO service_role;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO service_role;
REVOKE EXECUTE ON FUNCTION public.is_approved_instructor(_user_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_approved_instructor(_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_approved_instructor(_user_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.is_class_instructor(_class_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_class_instructor(_class_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_class_instructor(_class_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.is_class_student(_class_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_class_student(_class_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_class_student(_class_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.log_activity(_category text, _action text, _target text, _result text, _actor uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_activity(_category text, _action text, _target text, _result text, _actor uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.lower_email() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lower_email() TO authenticated;
GRANT EXECUTE ON FUNCTION public.lower_email() TO service_role;
REVOKE EXECUTE ON FUNCTION public.my_schedule() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_schedule() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_schedule() TO service_role;
REVOKE EXECUTE ON FUNCTION public.norm_answer(_t text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.norm_answer(_t text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.norm_answer(_t text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.notify(_user uuid, _kind text, _title text, _body text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify(_user uuid, _kind text, _title text, _body text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.notify_renewal_open(_sem semesters) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_renewal_open(_sem semesters) TO service_role;
REVOKE EXECUTE ON FUNCTION public.omr_finalize(_scan_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omr_finalize(_scan_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omr_finalize(_scan_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.omr_layout(_quiz_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omr_layout(_quiz_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omr_layout(_quiz_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.omr_save_review(_scan_id uuid, _answers jsonb, _sheet_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omr_save_review(_scan_id uuid, _answers jsonb, _sheet_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omr_save_review(_scan_id uuid, _answers jsonb, _sheet_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.omr_scans_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omr_scans_guard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.omr_scans_guard() TO service_role;
REVOKE EXECUTE ON FUNCTION public.prepare_omr_sheets(_quiz_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_omr_sheets(_quiz_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_omr_sheets(_quiz_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.previous_semester_end() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.previous_semester_end() TO authenticated;
GRANT EXECUTE ON FUNCTION public.previous_semester_end() TO service_role;
REVOKE EXECUTE ON FUNCTION public.profiles_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profiles_guard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.profiles_guard() TO service_role;
REVOKE EXECUTE ON FUNCTION public.renewal_approved(_user uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renewal_approved(_user uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.renewal_approved(_user uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.renewal_mark_approved(_user uuid, _kind text, _section uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renewal_mark_approved(_user uuid, _kind text, _section uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.renewal_open() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renewal_open() TO authenticated;
GRANT EXECUTE ON FUNCTION public.renewal_open() TO service_role;
REVOKE EXECUTE ON FUNCTION public.renewal_row(_user uuid, _kind text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renewal_row(_user uuid, _kind text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.review_instructor(_user_id uuid, _approve boolean, _reason text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_instructor(_user_id uuid, _approve boolean, _reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_instructor(_user_id uuid, _approve boolean, _reason text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.review_renewal(_user_id uuid, _approve boolean, _reason text, _section_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_renewal(_user_id uuid, _approve boolean, _reason text, _section_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_renewal(_user_id uuid, _approve boolean, _reason text, _section_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role;
REVOKE EXECUTE ON FUNCTION public.save_attendance(_class_id uuid, _date date, _records jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_attendance(_class_id uuid, _date date, _records jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_attendance(_class_id uuid, _date date, _records jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.save_quiz(_payload jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_quiz(_payload jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_quiz(_payload jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.schedule_label(_s instructor_schedules) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_label(_s instructor_schedules) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_label(_s instructor_schedules) TO service_role;
REVOKE EXECUTE ON FUNCTION public.score_response(_type text, _points integer, _correct_index integer, _key jsonb, _r jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.score_response(_type text, _points integer, _correct_index integer, _key jsonb, _r jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.score_response(_type text, _points integer, _correct_index integer, _key jsonb, _r jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.semester_end_preview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.semester_end_preview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.semester_end_preview() TO service_role;
REVOKE EXECUTE ON FUNCTION public.set_instructor_suspension(_user_id uuid, _suspend boolean, _reason text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_instructor_suspension(_user_id uuid, _suspend boolean, _reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_instructor_suspension(_user_id uuid, _suspend boolean, _reason text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.start_semester(_semester text, _academic_year text, _starts_on date, _ends_on date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_semester(_semester text, _academic_year text, _starts_on date, _ends_on date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_semester(_semester text, _academic_year text, _starts_on date, _ends_on date) TO service_role;
REVOKE EXECUTE ON FUNCTION public.submit_instructor_application(_full_name text, _employee_id text, _department text, _contact_number text, _proof_path text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_instructor_application(_full_name text, _employee_id text, _department text, _contact_number text, _proof_path text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_instructor_application(_full_name text, _employee_id text, _department text, _contact_number text, _proof_path text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.submit_quiz(_quiz_id uuid, _answers integer[], _started_at timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_quiz(_quiz_id uuid, _answers integer[], _started_at timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_quiz(_quiz_id uuid, _answers integer[], _started_at timestamp with time zone) TO service_role;
REVOKE EXECUTE ON FUNCTION public.submit_quiz_v2(_quiz_id uuid, _responses jsonb, _started_at timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_quiz_v2(_quiz_id uuid, _responses jsonb, _started_at timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_quiz_v2(_quiz_id uuid, _responses jsonb, _started_at timestamp with time zone) TO service_role;
REVOKE EXECUTE ON FUNCTION public.submit_renewal(_details jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_renewal(_details jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_renewal(_details jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.sync_student_section_classes(_user uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_student_section_classes(_user uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.time_label(_t time without time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.time_label(_t time without time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.time_label(_t time without time zone) TO service_role;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_updated_at() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_admin_not_student() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_admin_not_student() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_announcement_author() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_announcement_author() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_instructor_approved_renewal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_instructor_approved_renewal() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_log_attempt() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_log_attempt() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_log_attempt() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_log_class_content() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_log_class_content() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_log_class_content() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_log_enrollment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_log_enrollment() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_log_enrollment() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_log_invitation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_log_invitation() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_log_invitation() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_log_profile() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_log_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_log_profile() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_log_quiz_published() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_log_quiz_published() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_log_quiz_published() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_log_sign_in() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_log_sign_in() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_log_sign_in() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_profile_section_classes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_profile_section_classes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_profile_section_classes() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_profile_suspension() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_profile_suspension() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_role_section_classes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_role_section_classes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_role_section_classes() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_schedule_class() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_schedule_class() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_schedule_class() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_schedule_needs_renewal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_schedule_needs_renewal() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_section_assigned() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_section_assigned() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_section_assigned() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_section_rename_classes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_section_rename_classes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_section_rename_classes() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_section_renewal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_section_renewal() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_semester_closed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_semester_closed() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_semester_opened() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_semester_opened() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_settings_check_dates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_settings_check_dates() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_settings_sync_semester() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_settings_sync_semester() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_settings_sync_semester() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_subject_rename_classes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_subject_rename_classes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_subject_rename_classes() TO service_role;


-- ============================================================================
-- Storage buckets
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('assignment-files', 'assignment-files', false, 26214400, '{application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv,image/jpeg,image/png,image/webp,image/heic,image/gif,application/zip,application/x-zip-compressed}'::text[]) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('instructor-proofs', 'instructor-proofs', false, 10485760, '{application/pdf,image/jpeg,image/png,image/heic,image/webp}'::text[]) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('omr-scans', 'omr-scans', false, 15728640, '{image/jpeg,image/png}'::text[]) ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- Storage policies
-- ============================================================================
DROP POLICY IF EXISTS "Applicants and admins read proofs" ON storage.objects;
CREATE POLICY "Applicants and admins read proofs" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (((bucket_id = 'instructor-proofs'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR is_admin())));
DROP POLICY IF EXISTS "Applicants delete own proof" ON storage.objects;
CREATE POLICY "Applicants delete own proof" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (((bucket_id = 'instructor-proofs'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
DROP POLICY IF EXISTS "Applicants replace own proof" ON storage.objects;
CREATE POLICY "Applicants replace own proof" ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((bucket_id = 'instructor-proofs'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
DROP POLICY IF EXISTS "Applicants upload own proof" ON storage.objects;
CREATE POLICY "Applicants upload own proof" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'instructor-proofs'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
DROP POLICY IF EXISTS "Class members read assignment files" ON storage.objects;
CREATE POLICY "Class members read assignment files" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (((bucket_id = 'assignment-files'::text) AND (is_class_instructor(assignment_file_class(name)) OR is_class_student(assignment_file_class(name)) OR is_admin())));
DROP POLICY IF EXISTS "Instructors and admins read OMR scans" ON storage.objects;
CREATE POLICY "Instructors and admins read OMR scans" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (((bucket_id = 'omr-scans'::text) AND (is_class_instructor(assignment_file_class(name)) OR is_admin())));
DROP POLICY IF EXISTS "Instructors delete OMR scans" ON storage.objects;
CREATE POLICY "Instructors delete OMR scans" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (((bucket_id = 'omr-scans'::text) AND is_class_instructor(assignment_file_class(name))));
DROP POLICY IF EXISTS "Instructors delete assignment files" ON storage.objects;
CREATE POLICY "Instructors delete assignment files" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (((bucket_id = 'assignment-files'::text) AND is_class_instructor(assignment_file_class(name))));
DROP POLICY IF EXISTS "Instructors replace OMR scans" ON storage.objects;
CREATE POLICY "Instructors replace OMR scans" ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((bucket_id = 'omr-scans'::text) AND is_class_instructor(assignment_file_class(name))));
DROP POLICY IF EXISTS "Instructors upload OMR scans" ON storage.objects;
CREATE POLICY "Instructors upload OMR scans" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'omr-scans'::text) AND is_class_instructor(assignment_file_class(name))));
DROP POLICY IF EXISTS "Instructors upload assignment files" ON storage.objects;
CREATE POLICY "Instructors upload assignment files" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'assignment-files'::text) AND is_class_instructor(assignment_file_class(name))));


-- ============================================================================
-- Live updates (Supabase Realtime)
-- ============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN CREATE PUBLICATION supabase_realtime; END IF;
END $$;
ALTER PUBLICATION supabase_realtime ADD TABLE public.announcements;
ALTER PUBLICATION supabase_realtime ADD TABLE public.assignments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_records;
ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.class_schedules;
ALTER PUBLICATION supabase_realtime ADD TABLE public.class_students;
ALTER PUBLICATION supabase_realtime ADD TABLE public.classes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.instructor_profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.instructor_schedules;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.quiz_attempts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.quizzes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.renewals;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sections;
ALTER PUBLICATION supabase_realtime ADD TABLE public.semesters;


-- ============================================================================
-- Required data: the single settings row (current term)
-- ============================================================================
INSERT INTO public.app_settings DEFAULT VALUES ON CONFLICT (id) DO NOTHING;

SET check_function_bodies = true;


-- ============================================================================
-- Roles: who is admin / instructor / student
-- ============================================================================
-- The roles themselves are defined above (type app_role: instructor, student, admin; table user_roles).
-- They are given automatically:
--   * student    — when someone signs up in the app as a student
--   * instructor — when an administrator approves their application (or adds them on the Instructors page)
--   * admin      — only by hand, for the FIRST administrator of a new project:
--       1. Sign up once (app or admin website) with the administrator's email.
--       2. Run in the SQL Editor (replace the email):
--            INSERT INTO public.user_roles (user_id, role)
--            SELECT id, 'admin' FROM auth.users WHERE email = 'admin@example.com'
--            ON CONFLICT DO NOTHING;
--       3. Sign in to the admin website.
--   An administrator can never also be a student (enforced by the trigger admin_not_student).
