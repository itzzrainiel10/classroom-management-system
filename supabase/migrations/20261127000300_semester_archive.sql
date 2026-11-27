-- End Semester and semester archiving.
--
-- * public.semesters: one row per semester; exactly one may be Active.
-- * Every class belongs to a semester (classes.semester_id).
-- * end_semester(): in ONE transaction, copies every class of the semester (with its students, quizzes,
--   questions, grades/attempts, feedback, attendance, assignments, announcements, OMR scans and schedule)
--   into read-only archive tables, verifies the copy, locks the original classes (archived_at) and marks
--   the semester Completed. Any error rolls everything back and the semester stays Active.
-- * Nothing is deleted. Archived classes become read-only and disappear from the live app; students and
--   instructors read their history from the archive tables.
-- * start_semester(): opens the next semester. New schedules create fresh classes; old records never carry over.

/* ---------- Semesters ---------- */

CREATE TABLE IF NOT EXISTS public.semesters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  semester text NOT NULL,
  academic_year text NOT NULL,
  starts_on date,
  ends_on date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  ended_at timestamptz,
  ended_by uuid,
  ended_by_name text NOT NULL DEFAULT '',
  UNIQUE (semester, academic_year)
);
CREATE UNIQUE INDEX IF NOT EXISTS semesters_one_active ON public.semesters (status) WHERE status = 'active';
GRANT SELECT ON public.semesters TO authenticated;
GRANT ALL ON public.semesters TO service_role;
ALTER TABLE public.semesters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read semesters" ON public.semesters;
CREATE POLICY "Read semesters" ON public.semesters FOR SELECT TO authenticated USING (true);

-- The current term becomes the first Active semester.
INSERT INTO public.semesters (semester, academic_year, starts_on, ends_on, status)
SELECT current_semester, current_academic_year, semester_start, semester_end, 'active' FROM public.app_settings
WHERE NOT EXISTS (SELECT 1 FROM public.semesters)
LIMIT 1;

CREATE OR REPLACE FUNCTION public.current_semester_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.semesters WHERE status = 'active' LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public.current_semester_id() TO authenticated;

-- Editing the term in admin Settings keeps the Active semester's name and dates in step.
CREATE OR REPLACE FUNCTION public.trg_settings_sync_semester()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.semesters
  SET semester = NEW.current_semester, academic_year = NEW.current_academic_year, starts_on = NEW.semester_start, ends_on = NEW.semester_end
  WHERE status = 'active'
    AND NOT EXISTS (SELECT 1 FROM public.semesters o WHERE o.status = 'completed' AND o.semester = NEW.current_semester AND o.academic_year = NEW.current_academic_year);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS settings_sync_semester ON public.app_settings;
CREATE TRIGGER settings_sync_semester AFTER UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.trg_settings_sync_semester();

/* ---------- Classes belong to a semester ---------- */

ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS semester_id uuid REFERENCES public.semesters(id),
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.classes ALTER COLUMN semester_id SET DEFAULT public.current_semester_id();
UPDATE public.classes SET semester_id = public.current_semester_id() WHERE semester_id IS NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS classes_semester ON public.classes (semester_id);

-- One live class per subject · section · instructor (archived ones don't count).
DROP INDEX IF EXISTS public.classes_subject_section_instructor;
CREATE UNIQUE INDEX classes_subject_section_instructor
  ON public.classes (subject_id, section_id, instructor_id) WHERE subject_id IS NOT NULL AND section_id IS NOT NULL AND archived_at IS NULL;

-- Archived classes are invisible to the live app (admins still see them) and can't be written to.
CREATE OR REPLACE FUNCTION public.is_class_instructor(_class_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_user() AND public.instructor_not_suspended()
     AND EXISTS (SELECT 1 FROM public.classes WHERE id = _class_id AND instructor_id = auth.uid() AND archived_at IS NULL)
$$;

CREATE OR REPLACE FUNCTION public.is_class_student(_class_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_user() AND EXISTS (
    SELECT 1 FROM public.class_students cs JOIN public.classes c ON c.id = cs.class_id
    WHERE cs.class_id = _class_id AND c.archived_at IS NULL AND cs.email = public.current_email() AND public.current_email() <> ''
  )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_quiz(_quiz_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.quizzes q JOIN public.classes c ON c.id = q.class_id
                 WHERE q.id = _quiz_id AND c.instructor_id = auth.uid() AND c.archived_at IS NULL)
$$;

DROP POLICY IF EXISTS "Instructors read own classes" ON public.classes;
CREATE POLICY "Instructors read own classes" ON public.classes FOR SELECT TO authenticated
  USING ((instructor_id = auth.uid() AND archived_at IS NULL AND public.is_active_user() AND public.instructor_not_suspended()) OR public.is_class_student(id));

-- Schedules, sections and renames only touch live classes.
CREATE OR REPLACE FUNCTION public.ensure_schedule_class(_subject uuid, _section uuid, _instructor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.ensure_schedule_class(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_student_section_classes(_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.sync_student_section_classes(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_subject_rename_classes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code OR NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.classes SET code = NEW.code, title = NEW.name WHERE subject_id = NEW.id AND archived_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_section_rename_classes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.classes SET section = NEW.name WHERE section_id = NEW.id AND archived_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.classes_no_duplicate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

/* ---------- Read-only lock on archived classes ---------- */

CREATE OR REPLACE FUNCTION public.guard_archived_class()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row record;
  _cid uuid;
BEGIN
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
$$;
REVOKE EXECUTE ON FUNCTION public.guard_archived_class() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['class_students', 'quizzes', 'quiz_questions', 'quiz_answer_keys', 'quiz_attempts', 'assignments',
                           'announcements', 'class_schedules', 'attendance_sessions', 'attendance_records', 'omr_sheets', 'omr_scans']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS guard_archived ON public.%I', t);
    EXECUTE format('CREATE TRIGGER guard_archived BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_archived_class()', t);
  END LOOP;
END $$;

-- The archived class row itself: only "subject/section deleted" (ON DELETE SET NULL) may change it.
CREATE OR REPLACE FUNCTION public.guard_archived_class_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.guard_archived_class_row() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_archived_row ON public.classes;
CREATE TRIGGER guard_archived_row BEFORE UPDATE OR DELETE ON public.classes FOR EACH ROW EXECUTE FUNCTION public.guard_archived_class_row();

/* ---------- Archive tables (read-only, no links to live rows so they survive any later change) ---------- */

CREATE TABLE IF NOT EXISTS public.semester_archives (
  semester_id uuid PRIMARY KEY REFERENCES public.semesters(id),
  summary jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  archived_by uuid,
  archived_by_name text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public.semester_class_archives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  semester_id uuid NOT NULL REFERENCES public.semesters(id),
  class_id uuid NOT NULL,            -- original class id (reference only)
  instructor_id uuid,
  code text NOT NULL,
  title text NOT NULL,
  section text NOT NULL,
  instructor_name text NOT NULL DEFAULT '',
  student_count integer NOT NULL DEFAULT 0,
  data jsonb NOT NULL,               -- full snapshot (instructor / admin view)
  archived_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (semester_id, class_id)
);
CREATE INDEX IF NOT EXISTS semester_class_archives_instructor ON public.semester_class_archives (instructor_id, semester_id);

CREATE TABLE IF NOT EXISTS public.semester_student_archives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  semester_id uuid NOT NULL REFERENCES public.semesters(id),
  class_id uuid NOT NULL,
  student_email text NOT NULL,       -- lower-case
  student_name text NOT NULL DEFAULT '',
  code text NOT NULL,
  title text NOT NULL,
  section text NOT NULL,
  instructor_name text NOT NULL DEFAULT '',
  data jsonb NOT NULL,               -- only this student's own records
  archived_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (semester_id, class_id, student_email)
);
CREATE INDEX IF NOT EXISTS semester_student_archives_email ON public.semester_student_archives (student_email, semester_id);

GRANT SELECT ON public.semester_archives, public.semester_class_archives, public.semester_student_archives TO authenticated;
GRANT ALL ON public.semester_archives, public.semester_class_archives, public.semester_student_archives TO service_role;
ALTER TABLE public.semester_archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.semester_class_archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.semester_student_archives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read semester archives" ON public.semester_archives;
CREATE POLICY "Admins read semester archives" ON public.semester_archives FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS "Read own archived classes" ON public.semester_class_archives;
CREATE POLICY "Read own archived classes" ON public.semester_class_archives FOR SELECT TO authenticated
  USING (instructor_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS "Read own archived records" ON public.semester_student_archives;
CREATE POLICY "Read own archived records" ON public.semester_student_archives FOR SELECT TO authenticated
  USING ((student_email = public.current_email() AND public.current_email() <> '') OR public.is_admin());
-- No INSERT / UPDATE / DELETE policies: archives can only be written by end_semester().

/* ---------- Snapshots ---------- */

CREATE OR REPLACE FUNCTION public.archive_class_snapshot(_class uuid, _sem public.semesters)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.archive_class_snapshot(uuid, public.semesters) FROM PUBLIC, anon, authenticated;

-- One student's own view of a class: no other students' grades or attendance.
CREATE OR REPLACE FUNCTION public.archive_student_snapshot(_snap jsonb, _email text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.archive_student_snapshot(jsonb, text) FROM PUBLIC, anon, authenticated;

/* ---------- Admin: preview, end, start ---------- */

CREATE OR REPLACE FUNCTION public.semester_end_preview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.semester_end_preview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.semester_end_preview() TO authenticated;

CREATE OR REPLACE FUNCTION public.end_semester(_semester_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _sem public.semesters;
  _summary jsonb;
  _admin_name text;
  _classes int;
  _archived int;
  _enrollments int;
  _student_rows int;
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

  PERFORM public.log_activity('settings', 'Ended semester', _sem.semester || ', AY ' || _sem.academic_year,
                              _archived || ' classes archived', auth.uid());
  RETURN _summary || jsonb_build_object('archived_classes', _archived, 'archived_student_records', _student_rows);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.end_semester(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_semester(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.start_semester(_semester text, _academic_year text, _starts_on date, _ends_on date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _id uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only administrators can start a semester.'; END IF;
  IF trim(coalesce(_semester, '')) = '' OR trim(coalesce(_academic_year, '')) = '' THEN RAISE EXCEPTION 'Enter the semester and academic year.'; END IF;
  IF _starts_on IS NOT NULL AND _ends_on IS NOT NULL AND _ends_on <= _starts_on THEN RAISE EXCEPTION 'The end date must be after the start date.'; END IF;
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
  WHERE id = true;  -- app_settings has one row; Supabase refuses UPDATE without WHERE
  -- Classes created while no semester was active join the new one.
  UPDATE public.classes SET semester_id = _id WHERE semester_id IS NULL AND archived_at IS NULL;

  PERFORM public.log_activity('settings', 'Started semester', trim(_semester) || ', AY ' || trim(_academic_year), 'Active', auth.uid());
  RETURN _id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.start_semester(text, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_semester(text, text, date, date) TO authenticated;

/* ---------- Timetables show the ACTIVE semester only (nothing between "End" and "Start") ---------- */
CREATE OR REPLACE FUNCTION public.my_schedule()
RETURNS TABLE (
  id uuid, day_of_week integer, start_time time, end_time time, semester text, academic_year text,
  subject_code text, subject_name text, section_name text, year_level integer, room text,
  instructor_name text, instructor_employee_id text, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.my_schedule() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_schedule() TO authenticated;
