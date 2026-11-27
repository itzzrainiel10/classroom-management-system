-- ============================================================================
-- CvSU Classroom Management System — complete database schema (one file).
-- Squashed on 2026-11-27 from 32 migrations (originals kept in supabase/_old_migrations/).
-- Runs top to bottom on an empty Supabase project; one-time data fixes inside it do
-- nothing on an empty database.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- From 20261124000000_initial_schema.sql
-- ----------------------------------------------------------------------------
-- Roles
CREATE TYPE public.app_role AS ENUM ('instructor', 'student');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own profile" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- New account: profile + the role picked on the sign-up screen (instructor or student only).
-- Accounts made through Google (no role in metadata) get their role from claim_role().
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _meta_role text := NEW.raw_user_meta_data->>'role';
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    lower(COALESCE(NEW.email, ''))
  )
  ON CONFLICT (id) DO NOTHING;
  IF _meta_role IS NOT NULL OR COALESCE(NEW.raw_app_meta_data->>'provider', 'email') = 'email' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, CASE WHEN _meta_role = 'instructor' THEN 'instructor'::public.app_role ELSE 'student'::public.app_role END)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Sets the caller's role only if they have none yet (first Google sign-in). Returns the role they end up with.
CREATE OR REPLACE FUNCTION public.claim_role(_role public.app_role)
RETURNS public.app_role LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _result public.app_role;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(_uid::text));
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, _role);
  END IF;
  SELECT role INTO _result FROM public.user_roles WHERE user_id = _uid
  ORDER BY (role = 'instructor') DESC LIMIT 1;
  RETURN _result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_role(public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_role(public.app_role) TO authenticated;

CREATE OR REPLACE FUNCTION public.current_email()
RETURNS text LANGUAGE sql STABLE AS $$ SELECT lower(COALESCE(auth.jwt()->>'email', '')) $$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

-- Classes
CREATE TABLE public.classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id uuid NOT NULL DEFAULT auth.uid(),
  code text NOT NULL,
  title text NOT NULL,
  section text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.classes TO authenticated;
GRANT ALL ON public.classes TO service_role;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER classes_touch BEFORE UPDATE ON public.classes FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.class_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, email)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_students TO authenticated;
GRANT ALL ON public.class_students TO service_role;
ALTER TABLE public.class_students ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.lower_email()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.email := lower(trim(NEW.email)); RETURN NEW; END;
$$;
CREATE TRIGGER class_students_lower BEFORE INSERT OR UPDATE ON public.class_students FOR EACH ROW EXECUTE FUNCTION public.lower_email();

CREATE OR REPLACE FUNCTION public.is_class_instructor(_class_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.classes WHERE id = _class_id AND instructor_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.is_class_student(_class_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.class_students WHERE class_id = _class_id AND email = public.current_email() AND public.current_email() <> '')
$$;

CREATE POLICY "Instructors read own classes" ON public.classes FOR SELECT TO authenticated
  USING (instructor_id = auth.uid() OR public.is_class_student(id));
CREATE POLICY "Instructors create classes" ON public.classes FOR INSERT TO authenticated
  WITH CHECK (instructor_id = auth.uid() AND public.has_role(auth.uid(), 'instructor'));
CREATE POLICY "Instructors update own classes" ON public.classes FOR UPDATE TO authenticated
  USING (instructor_id = auth.uid()) WITH CHECK (instructor_id = auth.uid());
CREATE POLICY "Instructors delete own classes" ON public.classes FOR DELETE TO authenticated
  USING (instructor_id = auth.uid());

CREATE POLICY "Read class roster" ON public.class_students FOR SELECT TO authenticated
  USING (public.is_class_instructor(class_id) OR email = public.current_email());
CREATE POLICY "Instructors add students" ON public.class_students FOR INSERT TO authenticated
  WITH CHECK (public.is_class_instructor(class_id));
CREATE POLICY "Instructors edit students" ON public.class_students FOR UPDATE TO authenticated
  USING (public.is_class_instructor(class_id)) WITH CHECK (public.is_class_instructor(class_id));
CREATE POLICY "Instructors remove students" ON public.class_students FOR DELETE TO authenticated
  USING (public.is_class_instructor(class_id));

-- Quizzes
CREATE TABLE public.quizzes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  due_at timestamptz,
  time_limit_minutes integer NOT NULL DEFAULT 30 CHECK (time_limit_minutes BETWEEN 1 AND 600),
  passing_score integer NOT NULL DEFAULT 70 CHECK (passing_score BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quizzes TO authenticated;
GRANT ALL ON public.quizzes TO service_role;
ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER quizzes_touch BEFORE UPDATE ON public.quizzes FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE POLICY "Read quizzes" ON public.quizzes FOR SELECT TO authenticated
  USING (public.is_class_instructor(class_id) OR (status = 'published' AND public.is_class_student(class_id)));
CREATE POLICY "Instructors create quizzes" ON public.quizzes FOR INSERT TO authenticated
  WITH CHECK (public.is_class_instructor(class_id));
CREATE POLICY "Instructors update quizzes" ON public.quizzes FOR UPDATE TO authenticated
  USING (public.is_class_instructor(class_id)) WITH CHECK (public.is_class_instructor(class_id));
CREATE POLICY "Instructors delete quizzes" ON public.quizzes FOR DELETE TO authenticated
  USING (public.is_class_instructor(class_id));

CREATE OR REPLACE FUNCTION public.can_manage_quiz(_quiz_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.quizzes q JOIN public.classes c ON c.id = q.class_id WHERE q.id = _quiz_id AND c.instructor_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.can_take_quiz(_quiz_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.quizzes q WHERE q.id = _quiz_id AND q.status = 'published' AND public.is_class_student(q.class_id))
$$;

CREATE TABLE public.quiz_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  position integer NOT NULL,
  prompt text NOT NULL,
  choices text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quiz_questions TO authenticated;
GRANT ALL ON public.quiz_questions TO service_role;
ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;
CREATE INDEX quiz_questions_quiz ON public.quiz_questions (quiz_id, position);
CREATE POLICY "Read questions" ON public.quiz_questions FOR SELECT TO authenticated
  USING (public.can_manage_quiz(quiz_id) OR public.can_take_quiz(quiz_id));
CREATE POLICY "Instructors write questions" ON public.quiz_questions FOR ALL TO authenticated
  USING (public.can_manage_quiz(quiz_id)) WITH CHECK (public.can_manage_quiz(quiz_id));

-- Correct answers: instructors only, never readable by students.
CREATE TABLE public.quiz_answer_keys (
  question_id uuid PRIMARY KEY REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
  quiz_id uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  correct_index integer NOT NULL CHECK (correct_index >= 0)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quiz_answer_keys TO authenticated;
GRANT ALL ON public.quiz_answer_keys TO service_role;
ALTER TABLE public.quiz_answer_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Instructors manage answer keys" ON public.quiz_answer_keys FOR ALL TO authenticated
  USING (public.can_manage_quiz(quiz_id)) WITH CHECK (public.can_manage_quiz(quiz_id));

CREATE TABLE public.quiz_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  student_name text NOT NULL DEFAULT '',
  student_email text NOT NULL DEFAULT '',
  answers integer[] NOT NULL DEFAULT '{}',
  score integer NOT NULL,
  total integer NOT NULL,
  started_at timestamptz,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quiz_id, student_id)
);
GRANT SELECT ON public.quiz_attempts TO authenticated;
GRANT ALL ON public.quiz_attempts TO service_role;
ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read attempts" ON public.quiz_attempts FOR SELECT TO authenticated
  USING (student_id = auth.uid() OR public.can_manage_quiz(quiz_id));

-- Instructor saves a whole quiz (details, questions, correct answers) in one call.
-- _payload: {id, class_id, title, description, due_at, time_limit_minutes, passing_score, status,
--            questions: [{prompt, choices: [..], correct_index}]}
CREATE OR REPLACE FUNCTION public.save_quiz(_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _id uuid := (_payload->>'id')::uuid;
  _class uuid := (_payload->>'class_id')::uuid;
  _q jsonb;
  _pos integer := 0;
  _qid uuid;
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
      status = COALESCE(_payload->>'status', 'draft')
    WHERE id = _id;
    RETURN _id;
  END IF;

  INSERT INTO public.quizzes (id, class_id, title, description, due_at, time_limit_minutes, passing_score, status)
  VALUES (_id, _class, _payload->>'title', COALESCE(_payload->>'description', ''),
          NULLIF(_payload->>'due_at', '')::timestamptz,
          COALESCE((_payload->>'time_limit_minutes')::int, 30),
          COALESCE((_payload->>'passing_score')::int, 70),
          COALESCE(_payload->>'status', 'draft'))
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, description = EXCLUDED.description, due_at = EXCLUDED.due_at,
    time_limit_minutes = EXCLUDED.time_limit_minutes, passing_score = EXCLUDED.passing_score,
    status = EXCLUDED.status;

  DELETE FROM public.quiz_questions WHERE quiz_id = _id;
  FOR _q IN SELECT * FROM jsonb_array_elements(COALESCE(_payload->'questions', '[]'::jsonb)) LOOP
    _pos := _pos + 1;
    INSERT INTO public.quiz_questions (quiz_id, position, prompt, choices)
    VALUES (_id, _pos, _q->>'prompt', ARRAY(SELECT jsonb_array_elements_text(_q->'choices')))
    RETURNING id INTO _qid;
    INSERT INTO public.quiz_answer_keys (question_id, quiz_id, correct_index)
    VALUES (_qid, _id, COALESCE((_q->>'correct_index')::int, 0));
  END LOOP;
  RETURN _id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.save_quiz(jsonb) TO authenticated;

-- Student submits answers (index per question in order; -1 = skipped). Scored here, one try per quiz.
CREATE OR REPLACE FUNCTION public.submit_quiz(_quiz_id uuid, _answers integer[], _started_at timestamptz DEFAULT NULL)
RETURNS public.quiz_attempts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row public.quiz_attempts;
  _score integer;
  _total integer;
  _name text;
BEGIN
  IF NOT public.can_take_quiz(_quiz_id) THEN
    RAISE EXCEPTION 'This quiz is not available to you';
  END IF;
  SELECT * INTO _row FROM public.quiz_attempts WHERE quiz_id = _quiz_id AND student_id = auth.uid();
  IF FOUND THEN RETURN _row; END IF;

  SELECT count(*), count(*) FILTER (WHERE _answers[q.position] = k.correct_index)
    INTO _total, _score
  FROM public.quiz_questions q JOIN public.quiz_answer_keys k ON k.question_id = q.id
  WHERE q.quiz_id = _quiz_id;

  SELECT full_name INTO _name FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.quiz_attempts (quiz_id, student_id, student_name, student_email, answers, score, total, started_at)
  VALUES (_quiz_id, auth.uid(), COALESCE(_name, ''), public.current_email(), _answers, _score, _total, _started_at)
  RETURNING * INTO _row;
  RETURN _row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_quiz(uuid, integer[], timestamptz) TO authenticated;

-- Assignments, announcements, schedule
CREATE TABLE public.assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assignments TO authenticated;
GRANT ALL ON public.assignments TO service_role;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read assignments" ON public.assignments FOR SELECT TO authenticated
  USING (public.is_class_instructor(class_id) OR public.is_class_student(class_id));
CREATE POLICY "Instructors write assignments" ON public.assignments FOR ALL TO authenticated
  USING (public.is_class_instructor(class_id)) WITH CHECK (public.is_class_instructor(class_id));

CREATE TABLE public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcements TO authenticated;
GRANT ALL ON public.announcements TO service_role;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read announcements" ON public.announcements FOR SELECT TO authenticated
  USING (public.is_class_instructor(class_id) OR public.is_class_student(class_id));
CREATE POLICY "Instructors write announcements" ON public.announcements FOR ALL TO authenticated
  USING (public.is_class_instructor(class_id)) WITH CHECK (public.is_class_instructor(class_id));

CREATE TABLE public.class_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_time time NOT NULL,
  end_time time NOT NULL,
  room text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_schedules TO authenticated;
GRANT ALL ON public.class_schedules TO service_role;
ALTER TABLE public.class_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read schedules" ON public.class_schedules FOR SELECT TO authenticated
  USING (public.is_class_instructor(class_id) OR public.is_class_student(class_id));
CREATE POLICY "Instructors write schedules" ON public.class_schedules FOR ALL TO authenticated
  USING (public.is_class_instructor(class_id)) WITH CHECK (public.is_class_instructor(class_id));

CREATE INDEX class_students_email ON public.class_students (email);
CREATE INDEX quizzes_class ON public.quizzes (class_id);
CREATE INDEX assignments_class ON public.assignments (class_id);
CREATE INDEX announcements_class ON public.announcements (class_id);
CREATE INDEX class_schedules_class ON public.class_schedules (class_id);

-- ----------------------------------------------------------------------------
-- From 20261125000000_admin_role.sql
-- ----------------------------------------------------------------------------
-- Administrators (web admin portal). Granted by hand, never through sign-up:
--   INSERT INTO public.user_roles (user_id, role)
--   SELECT id, 'admin' FROM auth.users WHERE email = 'someone@cvsu.edu.ph';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'admin';


-- ----------------------------------------------------------------------------
-- From 20261125000100_admin_portal.sql
-- ----------------------------------------------------------------------------
-- Admin portal (web/) shared with the mobile app:
--   * administrators can read everything and manage users, classes and enrollment
--   * accounts have a student number and can be suspended
--   * invitations pre-assign a role (and optionally a class) to an email before it signs up
--   * quizzes go through admin review before students can see them
--   * an activity log records what happens across the system
-- Role checks compare role::text so this file never depends on the enum value added just before it.
-- Administrators (web admin portal). Granted by hand, never through sign-up:
--   INSERT INTO public.user_roles (user_id, role)
--   SELECT id, 'admin' FROM auth.users WHERE email = 'someone@cvsu.edu.ph';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'admin';

/* ---------- Helpers ---------- */

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role::text = 'admin')
$$;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

/* ---------- Profiles: student number + account status ---------- */

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS student_number text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_status_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_status_check CHECK (status IN ('active', 'suspended'));

-- True unless the signed-in account is suspended.
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT status = 'active' FROM public.profiles WHERE id = auth.uid()), true)
$$;

-- Users may edit their own name, but only an administrator changes status or student number.
CREATE OR REPLACE FUNCTION public.profiles_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    NEW.status := OLD.status;
    NEW.student_number := OLD.student_number;
  END IF;
  NEW.email := OLD.email;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_guard ON public.profiles;
CREATE TRIGGER profiles_guard BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.profiles_guard();

CREATE POLICY "Admins read profiles" ON public.profiles FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins update profiles" ON public.profiles FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins read roles" ON public.user_roles FOR SELECT TO authenticated USING (public.is_admin());

-- Suspended accounts lose access to class data.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
    WHERE r.user_id = _user_id AND r.role = _role AND p.status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION public.is_class_instructor(_class_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_user() AND EXISTS (SELECT 1 FROM public.classes WHERE id = _class_id AND instructor_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.is_class_student(_class_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_user() AND EXISTS (
    SELECT 1 FROM public.class_students WHERE class_id = _class_id AND email = public.current_email() AND public.current_email() <> ''
  )
$$;

DROP POLICY IF EXISTS "Instructors read own classes" ON public.classes;
CREATE POLICY "Instructors read own classes" ON public.classes FOR SELECT TO authenticated
  USING ((instructor_id = auth.uid() AND public.is_active_user()) OR public.is_class_student(id));

-- First Google sign-in may only claim instructor or student.
CREATE OR REPLACE FUNCTION public.claim_role(_role public.app_role)
RETURNS public.app_role LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role::text IN ('instructor', 'student')) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, _role);
  END IF;
  SELECT role INTO _result FROM public.user_roles WHERE user_id = _uid AND role::text IN ('instructor', 'student')
  ORDER BY (role::text = 'instructor') DESC LIMIT 1;
  RETURN _result;
END;
$$;

/* ---------- Admin access to class data ---------- */

CREATE POLICY "Admins manage classes" ON public.classes FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins manage enrollment" ON public.class_students FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins read quizzes" ON public.quizzes FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins read questions" ON public.quiz_questions FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins read answer keys" ON public.quiz_answer_keys FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins read attempts" ON public.quiz_attempts FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins read assignments" ON public.assignments FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins read announcements" ON public.announcements FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins manage schedules" ON public.class_schedules FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Switch a user between instructor and student (admin role is never touched here).
CREATE OR REPLACE FUNCTION public.admin_set_role(_user_id uuid, _role public.app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _changed boolean;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can change roles';
  END IF;
  IF _role::text NOT IN ('instructor', 'student') THEN
    RAISE EXCEPTION 'Choose Instructor or Student';
  END IF;
  _changed := NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
  DELETE FROM public.user_roles WHERE user_id = _user_id AND role::text IN ('instructor', 'student') AND role <> _role;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role) ON CONFLICT DO NOTHING;
  IF _changed THEN
    PERFORM public.log_activity('user', 'Role changed to ' || _role::text,
      COALESCE((SELECT NULLIF(full_name, '') FROM public.profiles WHERE id = _user_id), (SELECT email FROM public.profiles WHERE id = _user_id)));
  END IF;
END;
$$;

/* ---------- Invitations ---------- */

CREATE TABLE IF NOT EXISTS public.invitations (
  email text PRIMARY KEY,
  full_name text NOT NULL DEFAULT '',
  role public.app_role NOT NULL,
  class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  invited_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitations_role_check CHECK (role::text IN ('instructor', 'student'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invitations TO authenticated;
GRANT ALL ON public.invitations TO service_role;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage invitations" ON public.invitations FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP TRIGGER IF EXISTS invitations_lower ON public.invitations;
CREATE TRIGGER invitations_lower BEFORE INSERT OR UPDATE ON public.invitations FOR EACH ROW EXECUTE FUNCTION public.lower_email();

-- New account: profile + role. An invitation for the email wins over the role picked in the app.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _meta_role text := NEW.raw_user_meta_data->>'role';
  _email text := lower(COALESCE(NEW.email, ''));
  _inv public.invitations;
BEGIN
  SELECT * INTO _inv FROM public.invitations WHERE email = _email;

  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), NULLIF(NEW.raw_user_meta_data->>'name', ''), _inv.full_name, ''),
    _email
  )
  ON CONFLICT (id) DO NOTHING;

  IF _inv.email IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _inv.role) ON CONFLICT DO NOTHING;
    IF _inv.class_id IS NOT NULL THEN
      INSERT INTO public.class_students (class_id, email, full_name)
      VALUES (_inv.class_id, _email, COALESCE(NULLIF(_inv.full_name, ''), ''))
      ON CONFLICT (class_id, email) DO NOTHING;
    END IF;
    DELETE FROM public.invitations WHERE email = _email;
  ELSIF _meta_role IS NOT NULL OR COALESCE(NEW.raw_app_meta_data->>'provider', 'email') = 'email' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, CASE WHEN _meta_role = 'instructor' THEN 'instructor'::public.app_role ELSE 'student'::public.app_role END)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

/* ---------- Activity log ---------- */

CREATE TABLE IF NOT EXISTS public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  actor_name text NOT NULL DEFAULT '',
  actor_role text NOT NULL DEFAULT '',
  category text NOT NULL,
  action text NOT NULL,
  target text NOT NULL DEFAULT '',
  result text NOT NULL DEFAULT 'Completed'
);
GRANT SELECT ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read activity" ON public.activity_log FOR SELECT TO authenticated USING (public.is_admin());
CREATE INDEX IF NOT EXISTS activity_log_created ON public.activity_log (created_at DESC);

-- Never lets a logging problem break the action being logged.
CREATE OR REPLACE FUNCTION public.log_activity(_category text, _action text, _target text, _result text DEFAULT 'Completed', _actor uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.log_activity(text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.class_label(_class_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT trim(code || CASE WHEN section <> '' THEN ', ' || section ELSE '' END) FROM public.classes WHERE id = _class_id
$$;

CREATE OR REPLACE FUNCTION public.trg_log_class_content()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
DROP TRIGGER IF EXISTS log_classes ON public.classes;
CREATE TRIGGER log_classes AFTER INSERT ON public.classes FOR EACH ROW EXECUTE FUNCTION public.trg_log_class_content();
DROP TRIGGER IF EXISTS log_assignments ON public.assignments;
CREATE TRIGGER log_assignments AFTER INSERT ON public.assignments FOR EACH ROW EXECUTE FUNCTION public.trg_log_class_content();
DROP TRIGGER IF EXISTS log_announcements ON public.announcements;
CREATE TRIGGER log_announcements AFTER INSERT ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.trg_log_class_content();
DROP TRIGGER IF EXISTS log_schedules ON public.class_schedules;
CREATE TRIGGER log_schedules AFTER INSERT ON public.class_schedules FOR EACH ROW EXECUTE FUNCTION public.trg_log_class_content();

CREATE OR REPLACE FUNCTION public.trg_log_enrollment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity('enrollment', 'Student enrolled', COALESCE(NULLIF(NEW.full_name, ''), NEW.email) || ' → ' || COALESCE(public.class_label(NEW.class_id), ''));
    RETURN NEW;
  END IF;
  PERFORM public.log_activity('enrollment', 'Student removed', COALESCE(NULLIF(OLD.full_name, ''), OLD.email) || ' · ' || COALESCE(public.class_label(OLD.class_id), ''));
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS log_enrollment ON public.class_students;
CREATE TRIGGER log_enrollment AFTER INSERT OR DELETE ON public.class_students FOR EACH ROW EXECUTE FUNCTION public.trg_log_enrollment();

CREATE OR REPLACE FUNCTION public.trg_log_attempt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.log_activity('assessment', 'Quiz answered',
    COALESCE((SELECT title FROM public.quizzes WHERE id = NEW.quiz_id), 'Quiz'), NEW.score || ' / ' || NEW.total, NEW.student_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS log_attempts ON public.quiz_attempts;
CREATE TRIGGER log_attempts AFTER INSERT ON public.quiz_attempts FOR EACH ROW EXECUTE FUNCTION public.trg_log_attempt();

CREATE OR REPLACE FUNCTION public.trg_log_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
DROP TRIGGER IF EXISTS log_profiles ON public.profiles;
CREATE TRIGGER log_profiles AFTER UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.trg_log_profile();

CREATE OR REPLACE FUNCTION public.trg_log_invitation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.log_activity('user', 'User invited', COALESCE(NULLIF(NEW.full_name, ''), NEW.email) || ' · ' || NEW.role::text, 'Invited');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS log_invitations ON public.invitations;
CREATE TRIGGER log_invitations AFTER INSERT ON public.invitations FOR EACH ROW EXECUTE FUNCTION public.trg_log_invitation();

-- Sign-ins (one row per login). Wrapped so a logging problem can never block a login.
CREATE OR REPLACE FUNCTION public.trg_log_sign_in()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.last_sign_in_at IS DISTINCT FROM OLD.last_sign_in_at THEN
    PERFORM public.log_activity('sign_in', 'Signed in', COALESCE(NEW.email, ''), 'Success', NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_signed_in ON auth.users;
CREATE TRIGGER on_auth_user_signed_in AFTER UPDATE OF last_sign_in_at ON auth.users FOR EACH ROW EXECUTE FUNCTION public.trg_log_sign_in();

/* ---------- Assessment review ---------- */

ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'not_submitted',
  ADD COLUMN IF NOT EXISTS review_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.quizzes DROP CONSTRAINT IF EXISTS quizzes_review_status_check;
ALTER TABLE public.quizzes ADD CONSTRAINT quizzes_review_status_check
  CHECK (review_status IN ('not_submitted', 'pending', 'approved', 'changes_requested'));

-- Quizzes students can already see stay visible.
UPDATE public.quizzes SET review_status = 'approved', reviewed_at = now(), submitted_at = COALESCE(submitted_at, updated_at)
WHERE status = 'published' AND review_status = 'not_submitted';

-- Instructors never set review fields themselves: publishing (re)submits the quiz for review.
CREATE OR REPLACE FUNCTION public.quiz_review_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_setting('cms.reviewing', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.review_note := OLD.review_note;
    NEW.reviewed_by := OLD.reviewed_by;
    NEW.reviewed_at := OLD.reviewed_at;
    NEW.submitted_at := OLD.submitted_at;
  ELSE
    NEW.review_note := '';
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    NEW.submitted_at := NULL;
  END IF;

  IF NEW.status = 'draft' THEN
    NEW.review_status := CASE WHEN TG_OP = 'UPDATE' AND OLD.review_status = 'changes_requested' THEN 'changes_requested' ELSE 'not_submitted' END;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'published' AND OLD.review_status = 'approved'
        AND EXISTS (SELECT 1 FROM public.quiz_attempts WHERE quiz_id = NEW.id) THEN
    NEW.review_status := 'approved'; -- students already answered; its questions are locked
  ELSE
    IF TG_OP = 'INSERT' OR OLD.review_status <> 'pending' OR OLD.status <> 'published' THEN
      NEW.submitted_at := now();
    END IF;
    NEW.review_status := 'pending';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS quizzes_review_guard ON public.quizzes;
CREATE TRIGGER quizzes_review_guard BEFORE INSERT OR UPDATE ON public.quizzes FOR EACH ROW EXECUTE FUNCTION public.quiz_review_guard();

CREATE OR REPLACE FUNCTION public.trg_log_quiz_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _target text := NEW.title || ' · ' || COALESCE(public.class_label(NEW.class_id), '');
BEGIN
  IF NEW.review_status = 'pending' AND (TG_OP = 'INSERT' OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at) THEN
    PERFORM public.log_activity('assessment', 'Assessment submitted', _target, 'Pending review');
  ELSIF TG_OP = 'UPDATE' AND NEW.review_status IS DISTINCT FROM OLD.review_status THEN
    IF NEW.review_status = 'approved' THEN
      PERFORM public.log_activity('assessment', 'Assessment approved', _target, 'Published');
    ELSIF NEW.review_status = 'changes_requested' THEN
      PERFORM public.log_activity('assessment', 'Changes requested', _target, 'Returned');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS log_quiz_review ON public.quizzes;
CREATE TRIGGER log_quiz_review AFTER INSERT OR UPDATE ON public.quizzes FOR EACH ROW EXECUTE FUNCTION public.trg_log_quiz_review();

-- Students only see quizzes an administrator approved.
DROP POLICY IF EXISTS "Read quizzes" ON public.quizzes;
CREATE POLICY "Read quizzes" ON public.quizzes FOR SELECT TO authenticated
  USING (public.is_class_instructor(class_id) OR (status = 'published' AND review_status = 'approved' AND public.is_class_student(class_id)));

CREATE OR REPLACE FUNCTION public.can_take_quiz(_quiz_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.quizzes q
    WHERE q.id = _quiz_id AND q.status = 'published' AND q.review_status = 'approved' AND public.is_class_student(q.class_id)
  )
$$;

-- Questions and answer keys change only through save_quiz(), which re-submits the quiz for review.
DROP POLICY IF EXISTS "Instructors write questions" ON public.quiz_questions;
CREATE POLICY "Instructors read own questions" ON public.quiz_questions FOR SELECT TO authenticated USING (public.can_manage_quiz(quiz_id));
DROP POLICY IF EXISTS "Instructors manage answer keys" ON public.quiz_answer_keys;
CREATE POLICY "Instructors read answer keys" ON public.quiz_answer_keys FOR SELECT TO authenticated USING (public.can_manage_quiz(quiz_id));

-- Admin decision on a submitted quiz.
CREATE OR REPLACE FUNCTION public.review_quiz(_quiz_id uuid, _approve boolean, _note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can review assessments';
  END IF;
  IF NOT _approve AND trim(COALESCE(_note, '')) = '' THEN
    RAISE EXCEPTION 'Add a note so the instructor knows what to change';
  END IF;
  PERFORM set_config('cms.reviewing', 'on', true);
  UPDATE public.quizzes
  SET review_status = CASE WHEN _approve THEN 'approved' ELSE 'changes_requested' END,
      review_note = trim(COALESCE(_note, '')),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = _quiz_id AND status = 'published';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This assessment is not waiting for review';
  END IF;
  PERFORM set_config('cms.reviewing', 'off', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.review_quiz(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_quiz(uuid, boolean, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_set_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_role(uuid, public.app_role) TO authenticated;


-- ----------------------------------------------------------------------------
-- From 20261125000300_verification_scheduling.sql
-- ----------------------------------------------------------------------------
-- Instructor verification + section-based official schedules (admin portal, mobile app).
--   * Signing up as an instructor creates a PENDING application; the instructor role is granted only
--     when an administrator approves it (review_instructor). Nobody can give themselves the role.
--   * Admin-managed subjects, sections (with year level), rooms and the current academic term.
--   * instructor_schedules: official timetable per section. The database rejects overlapping times for
--     the same instructor, room or section, and unapproved instructors.
--   * Students belong to a section (profiles.section_id, set by an admin) and see only its schedule.
--   * notifications: in-app messages for approvals, rejections and schedule changes.
-- Existing tables, data and features are kept.

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

DO $$ BEGIN
  CREATE TYPE public.timerange AS RANGE (subtype = time);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

/* ---------- Instructor applications ---------- */

CREATE TABLE IF NOT EXISTS public.instructor_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_id text NOT NULL DEFAULT '',
  department text NOT NULL DEFAULT '',
  contact_number text NOT NULL DEFAULT '',
  proof_path text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason text NOT NULL DEFAULT '',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS instructor_profiles_employee_id ON public.instructor_profiles (lower(employee_id)) WHERE employee_id <> '';
CREATE INDEX IF NOT EXISTS instructor_profiles_status ON public.instructor_profiles (status, submitted_at DESC);
GRANT SELECT ON public.instructor_profiles TO authenticated;
GRANT ALL ON public.instructor_profiles TO service_role;
ALTER TABLE public.instructor_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own application" ON public.instructor_profiles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins read applications" ON public.instructor_profiles FOR SELECT TO authenticated USING (public.is_admin());

-- Every approve / reject decision, with who made it and when.
CREATE TABLE IF NOT EXISTS public.instructor_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reason text NOT NULL DEFAULT '',
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS instructor_verifications_user ON public.instructor_verifications (user_id, decided_at DESC);
GRANT SELECT ON public.instructor_verifications TO authenticated;
GRANT ALL ON public.instructor_verifications TO service_role;
ALTER TABLE public.instructor_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own decisions" ON public.instructor_verifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins read decisions" ON public.instructor_verifications FOR SELECT TO authenticated USING (public.is_admin());

-- Instructors who already existed keep their access (recorded as approved).
INSERT INTO public.instructor_profiles (user_id, status, reviewed_at, rejection_reason)
SELECT r.user_id, 'approved', now(), ''
FROM public.user_roles r
WHERE r.role::text = 'instructor'
ON CONFLICT (user_id) DO NOTHING;

/* ---------- Subjects, sections, rooms, academic term ---------- */

CREATE TABLE IF NOT EXISTS public.subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (trim(code) <> ''),
  name text NOT NULL CHECK (trim(name) <> ''),
  department text NOT NULL DEFAULT '',
  units integer NOT NULL DEFAULT 3 CHECK (units BETWEEN 0 AND 12),
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS subjects_code ON public.subjects (lower(code));

CREATE TABLE IF NOT EXISTS public.sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (trim(name) <> ''),
  program text NOT NULL DEFAULT '',
  year_level integer NOT NULL CHECK (year_level BETWEEN 1 AND 6),
  department text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sections_name ON public.sections (lower(name));

CREATE TABLE IF NOT EXISTS public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (trim(name) <> ''),
  building text NOT NULL DEFAULT '',
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rooms_name ON public.rooms (lower(name));

-- One row: the term new schedules default to and that dashboards show.
CREATE TABLE IF NOT EXISTS public.app_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  current_semester text NOT NULL DEFAULT '1st Semester' CHECK (current_semester IN ('1st Semester', '2nd Semester', 'Midyear')),
  current_academic_year text NOT NULL DEFAULT '2026-2027' CHECK (current_academic_year ~ '^[0-9]{4}-[0-9]{4}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
INSERT INTO public.app_settings (id, current_semester, current_academic_year)
VALUES (
  true,
  CASE WHEN extract(month FROM now()) >= 8 THEN '1st Semester' WHEN extract(month FROM now()) <= 5 THEN '2nd Semester' ELSE 'Midyear' END,
  CASE WHEN extract(month FROM now()) >= 8
       THEN extract(year FROM now())::int || '-' || (extract(year FROM now())::int + 1)
       ELSE (extract(year FROM now())::int - 1) || '-' || extract(year FROM now())::int END
)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subjects', 'sections', 'rooms', 'app_settings'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "Signed-in users read %s" ON public.%I FOR SELECT TO authenticated USING (true)', t, t);
    EXECUTE format('CREATE POLICY "Admins manage %s" ON public.%I FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())', t, t);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS subjects_touch ON public.subjects;
CREATE TRIGGER subjects_touch BEFORE UPDATE ON public.subjects FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS sections_touch ON public.sections;
CREATE TRIGGER sections_touch BEFORE UPDATE ON public.sections FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS app_settings_touch ON public.app_settings;
CREATE TRIGGER app_settings_touch BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

/* ---------- Students belong to a section (set by an admin) ---------- */

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS section_id uuid REFERENCES public.sections(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS profiles_section ON public.profiles (section_id);

CREATE OR REPLACE FUNCTION public.profiles_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    NEW.status := OLD.status;
    NEW.student_number := OLD.student_number;
    NEW.section_id := OLD.section_id;
  END IF;
  NEW.email := OLD.email;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

/* ---------- Notifications ---------- */

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user ON public.notifications (user_id, created_at DESC);
GRANT SELECT, DELETE ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own notifications" ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Mark own notifications read" ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Delete own notifications" ON public.notifications FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.notify(_user uuid, _kind text, _title text, _body text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _user IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, kind, title, body) VALUES (_user, _kind, _title, COALESCE(_body, ''));
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL; -- a notification problem never blocks the change itself
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notify(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

/* ---------- Approval rules ---------- */

-- True when the user may teach: instructor role + approved application + active account.
CREATE OR REPLACE FUNCTION public.is_approved_instructor(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'instructor')
     AND EXISTS (SELECT 1 FROM public.instructor_profiles WHERE user_id = _user_id AND status = 'approved')
$$;
GRANT EXECUTE ON FUNCTION public.is_approved_instructor(uuid) TO authenticated;

-- Sign-up: an instructor choice becomes a pending application (no instructor role yet).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  _meta_role text := _meta->>'role';
  _email text := lower(COALESCE(NEW.email, ''));
  _inv public.invitations;
BEGIN
  SELECT * INTO _inv FROM public.invitations WHERE email = _email;

  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NULLIF(_meta->>'full_name', ''), NULLIF(_meta->>'name', ''), _inv.full_name, ''), _email)
  ON CONFLICT (id) DO NOTHING;

  IF _inv.email IS NOT NULL THEN
    -- An administrator invited this email: their role is already authorized.
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
    -- An employee ID already registered elsewhere is left blank for the applicant to correct.
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
  END IF;
  RETURN NEW;
END;
$$;

-- First Google sign-in: "student" is granted at once; "instructor" only opens a pending application.
CREATE OR REPLACE FUNCTION public.claim_role(_role public.app_role)
RETURNS public.app_role LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

-- Applicant fills in / corrects their application (also used to re-apply after a rejection).
CREATE OR REPLACE FUNCTION public.submit_instructor_application(
  _full_name text, _employee_id text, _department text, _contact_number text, _proof_path text DEFAULT NULL)
RETURNS public.instructor_profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  IF trim(COALESCE(_contact_number, '')) !~ '^\+?[0-9][0-9 -]{6,18}$' THEN RAISE EXCEPTION 'Enter a valid contact number (e.g. 0917 123 4567)'; END IF;
  IF _proof_path IS NOT NULL AND _proof_path <> '' AND split_part(_proof_path, '/', 1) <> _uid::text THEN
    RAISE EXCEPTION 'Invalid proof document';
  END IF;
  IF EXISTS (SELECT 1 FROM public.instructor_profiles WHERE lower(employee_id) = lower(trim(_employee_id)) AND user_id <> _uid) THEN
    RAISE EXCEPTION 'This employee / faculty ID is already registered to another account';
  END IF;

  UPDATE public.profiles SET full_name = trim(_full_name) WHERE id = _uid;
  INSERT INTO public.instructor_profiles (user_id, employee_id, department, contact_number, proof_path, status, submitted_at)
  VALUES (_uid, trim(_employee_id), trim(_department), trim(_contact_number), NULLIF(_proof_path, ''), 'pending', now())
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
$$;
REVOKE EXECUTE ON FUNCTION public.submit_instructor_application(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_instructor_application(text, text, text, text, text) TO authenticated;

-- Administrator decision. Approval grants the instructor role; rejection removes it and needs a reason.
CREATE OR REPLACE FUNCTION public.review_instructor(_user_id uuid, _approve boolean, _reason text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.review_instructor(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_instructor(uuid, boolean, text) TO authenticated;

-- Switching someone to Instructor from Users & roles counts as an admin approval (and is recorded).
CREATE OR REPLACE FUNCTION public.admin_set_role(_user_id uuid, _role public.app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

-- Unapproved users cannot create classes (instructor-only feature).
DROP POLICY IF EXISTS "Instructors create classes" ON public.classes;
CREATE POLICY "Instructors create classes" ON public.classes FOR INSERT TO authenticated
  WITH CHECK (instructor_id = auth.uid() AND public.is_approved_instructor(auth.uid()));

/* ---------- Official schedules ---------- */

CREATE TABLE IF NOT EXISTS public.instructor_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  section_id uuid NOT NULL REFERENCES public.sections(id) ON DELETE RESTRICT,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE RESTRICT,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_time time NOT NULL,
  end_time time NOT NULL,
  semester text NOT NULL CHECK (semester IN ('1st Semester', '2nd Semester', 'Midyear')),
  academic_year text NOT NULL CHECK (academic_year ~ '^[0-9]{4}-[0-9]{4}$'),
  created_by uuid DEFAULT auth.uid(),
  updated_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT instructor_schedules_time_order CHECK (end_time > start_time),
  -- Hard guarantees (the trigger below gives friendlier messages first).
  CONSTRAINT instructor_schedules_no_instructor_overlap EXCLUDE USING gist (
    instructor_id WITH =, semester WITH =, academic_year WITH =, day_of_week WITH =, public.timerange(start_time, end_time) WITH &&),
  CONSTRAINT instructor_schedules_no_room_overlap EXCLUDE USING gist (
    room_id WITH =, semester WITH =, academic_year WITH =, day_of_week WITH =, public.timerange(start_time, end_time) WITH &&),
  CONSTRAINT instructor_schedules_no_section_overlap EXCLUDE USING gist (
    section_id WITH =, semester WITH =, academic_year WITH =, day_of_week WITH =, public.timerange(start_time, end_time) WITH &&)
);
CREATE INDEX IF NOT EXISTS instructor_schedules_instructor ON public.instructor_schedules (instructor_id, academic_year, semester);
CREATE INDEX IF NOT EXISTS instructor_schedules_section ON public.instructor_schedules (section_id, academic_year, semester);
CREATE INDEX IF NOT EXISTS instructor_schedules_subject ON public.instructor_schedules (subject_id);
CREATE INDEX IF NOT EXISTS instructor_schedules_room ON public.instructor_schedules (room_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.instructor_schedules TO authenticated;
GRANT ALL ON public.instructor_schedules TO service_role;
ALTER TABLE public.instructor_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage schedules" ON public.instructor_schedules FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Instructors read own schedule" ON public.instructor_schedules FOR SELECT TO authenticated
  USING (instructor_id = auth.uid() AND public.is_approved_instructor(auth.uid()));
CREATE POLICY "Students read own section schedule" ON public.instructor_schedules FOR SELECT TO authenticated
  USING (public.is_active_user() AND section_id = (SELECT section_id FROM public.profiles WHERE id = auth.uid()));

CREATE OR REPLACE FUNCTION public.day_label(_d integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT (ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])[_d]
$$;
CREATE OR REPLACE FUNCTION public.time_label(_t time)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT trim(to_char(_t, 'FMHH12:MI AM')) $$;

-- Readable one-line description of a schedule row.
CREATE OR REPLACE FUNCTION public.schedule_label(_s public.instructor_schedules)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (SELECT code || ' ' || name FROM public.subjects WHERE id = _s.subject_id)
      || ' · ' || (SELECT name FROM public.sections WHERE id = _s.section_id)
      || ' · ' || public.day_label(_s.day_of_week) || ' ' || public.time_label(_s.start_time) || '–' || public.time_label(_s.end_time)
      || ' · ' || (SELECT name FROM public.rooms WHERE id = _s.room_id)
$$;

-- Clear error messages for conflicts and unapproved instructors.
CREATE OR REPLACE FUNCTION public.instructor_schedules_validate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
DROP TRIGGER IF EXISTS instructor_schedules_validate ON public.instructor_schedules;
CREATE TRIGGER instructor_schedules_validate BEFORE INSERT OR UPDATE ON public.instructor_schedules
  FOR EACH ROW EXECUTE FUNCTION public.instructor_schedules_validate();

-- Tell the instructor(s) and the section's students; record it in the activity log.
CREATE OR REPLACE FUNCTION public.instructor_schedules_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
DROP TRIGGER IF EXISTS instructor_schedules_notify ON public.instructor_schedules;
CREATE TRIGGER instructor_schedules_notify AFTER INSERT OR UPDATE OR DELETE ON public.instructor_schedules
  FOR EACH ROW EXECUTE FUNCTION public.instructor_schedules_notify();

-- Students moved to a section are told where to find its schedule.
CREATE OR REPLACE FUNCTION public.trg_section_assigned()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.section_id IS DISTINCT FROM OLD.section_id AND NEW.section_id IS NOT NULL THEN
    PERFORM public.notify(NEW.id, 'schedule', 'Section assigned',
      'You are now in ' || (SELECT name FROM public.sections WHERE id = NEW.section_id) || '. Open Schedule to see your classes.');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_section_assigned ON public.profiles;
CREATE TRIGGER profiles_section_assigned AFTER UPDATE OF section_id ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.trg_section_assigned();

-- The signed-in user's official schedule for the current term (instructor: own classes; student: own section).
CREATE OR REPLACE FUNCTION public.my_schedule()
RETURNS TABLE (
  id uuid, day_of_week integer, start_time time, end_time time, semester text, academic_year text,
  subject_code text, subject_name text, section_name text, year_level integer, room text,
  instructor_name text, instructor_employee_id text, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH term AS (SELECT current_semester, current_academic_year FROM public.app_settings LIMIT 1),
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

/* ---------- Proof documents (private storage) ---------- */

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('instructor-proofs', 'instructor-proofs', false, 10485760, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Applicants upload own proof" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'instructor-proofs' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Applicants and admins read proofs" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'instructor-proofs' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));
CREATE POLICY "Applicants replace own proof" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'instructor-proofs' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Applicants delete own proof" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'instructor-proofs' AND (storage.foldername(name))[1] = auth.uid()::text);


-- ----------------------------------------------------------------------------
-- From 20261125000400_event_timestamps.sql
-- ----------------------------------------------------------------------------
-- Several notifications / log rows can be written in one transaction (e.g. a schedule change notifies a
-- whole section); clock_timestamp() keeps their order exact, unlike now() which is fixed per transaction.
ALTER TABLE public.notifications ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE public.activity_log ALTER COLUMN created_at SET DEFAULT clock_timestamp();


-- ----------------------------------------------------------------------------
-- From 20261125000500_semester_dates.sql
-- ----------------------------------------------------------------------------
-- Start and end dates of the current semester. Official schedules repeat weekly between these dates;
-- the mobile app shows them and stops listing classes once the semester has ended.
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS semester_start date,
  ADD COLUMN IF NOT EXISTS semester_end date;
ALTER TABLE public.app_settings DROP CONSTRAINT IF EXISTS app_settings_semester_dates;
ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_semester_dates
  CHECK ((semester_start IS NULL AND semester_end IS NULL) OR (semester_start IS NOT NULL AND semester_end IS NOT NULL AND semester_end > semester_start));


-- ----------------------------------------------------------------------------
-- From 20261125000600_question_types.sql
-- ----------------------------------------------------------------------------
-- 1) Assessment review removed: published quizzes/exams go straight to enrolled students again.
-- 2) Quiz or Exam, and question types: multiple choice, true or false, modified true or false,
--    identification, enumeration and essay (graded by the instructor). Scoring stays on the server;
--    answer keys are never readable by students.

/* ---------- 1. Remove assessment review ---------- */

DROP TRIGGER IF EXISTS quizzes_review_guard ON public.quizzes;
DROP TRIGGER IF EXISTS log_quiz_review ON public.quizzes;
DROP FUNCTION IF EXISTS public.quiz_review_guard();
DROP FUNCTION IF EXISTS public.trg_log_quiz_review();
DROP FUNCTION IF EXISTS public.review_quiz(uuid, boolean, text);

DROP POLICY IF EXISTS "Read quizzes" ON public.quizzes;
ALTER TABLE public.quizzes DROP CONSTRAINT IF EXISTS quizzes_review_status_check;
ALTER TABLE public.quizzes
  DROP COLUMN IF EXISTS review_status,
  DROP COLUMN IF EXISTS review_note,
  DROP COLUMN IF EXISTS submitted_at,
  DROP COLUMN IF EXISTS reviewed_by,
  DROP COLUMN IF EXISTS reviewed_at;
CREATE POLICY "Read quizzes" ON public.quizzes FOR SELECT TO authenticated
  USING (public.is_class_instructor(class_id) OR (status = 'published' AND public.is_class_student(class_id)));

CREATE OR REPLACE FUNCTION public.can_take_quiz(_quiz_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.quizzes q WHERE q.id = _quiz_id AND q.status = 'published' AND public.is_class_student(q.class_id))
$$;

/* ---------- 2. Quiz or exam ---------- */

ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'quiz';
ALTER TABLE public.quizzes DROP CONSTRAINT IF EXISTS quizzes_kind_check;
ALTER TABLE public.quizzes ADD CONSTRAINT quizzes_kind_check CHECK (kind IN ('quiz', 'exam'));

CREATE OR REPLACE FUNCTION public.trg_log_quiz_published()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status <> 'published') THEN
    PERFORM public.log_activity('assessment', CASE WHEN NEW.kind = 'exam' THEN 'Exam published' ELSE 'Quiz published' END,
      NEW.title || ' · ' || COALESCE(public.class_label(NEW.class_id), ''), 'Published');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS log_quiz_published ON public.quizzes;
CREATE TRIGGER log_quiz_published AFTER INSERT OR UPDATE OF status ON public.quizzes FOR EACH ROW EXECUTE FUNCTION public.trg_log_quiz_published();

/* ---------- 3. Question types ---------- */

ALTER TABLE public.quiz_questions
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'multiple_choice',
  ADD COLUMN IF NOT EXISTS points integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS item_count integer NOT NULL DEFAULT 1;
ALTER TABLE public.quiz_questions DROP CONSTRAINT IF EXISTS quiz_questions_type_check;
ALTER TABLE public.quiz_questions ADD CONSTRAINT quiz_questions_type_check
  CHECK (type IN ('multiple_choice', 'true_false', 'modified_true_false', 'identification', 'enumeration', 'essay'));
ALTER TABLE public.quiz_questions DROP CONSTRAINT IF EXISTS quiz_questions_points_check;
ALTER TABLE public.quiz_questions ADD CONSTRAINT quiz_questions_points_check CHECK (points BETWEEN 1 AND 100 AND item_count BETWEEN 1 AND 50);

-- Answer key per type (never readable by students):
--   multiple_choice      correct_index
--   true_false           {"value": true|false}
--   modified_true_false  {"value": true|false, "accepted": ["word", ...]}   (accepted = correction when false)
--   identification       {"accepted": ["answer", "alternative", ...]}
--   enumeration          {"items": [["item 1", "alt"], ["item 2"], ...]}   (any order, 1 point each)
--   essay                {"guide": "what a good answer contains"}           (graded by the instructor)
ALTER TABLE public.quiz_answer_keys ALTER COLUMN correct_index DROP NOT NULL;
ALTER TABLE public.quiz_answer_keys ADD COLUMN IF NOT EXISTS answer jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Student responses, per-question scores and essay grading.
ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS responses jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS item_scores jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS needs_grading boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS graded_at timestamptz,
  ADD COLUMN IF NOT EXISTS feedback text NOT NULL DEFAULT '';

-- Older attempts (multiple choice only) get their responses filled in.
UPDATE public.quiz_attempts a
SET responses = COALESCE((SELECT jsonb_agg(jsonb_build_object('choice', x) ORDER BY i) FROM unnest(a.answers) WITH ORDINALITY u(x, i)), '[]'::jsonb)
WHERE a.responses = '[]'::jsonb AND cardinality(a.answers) > 0;

-- Case, extra spaces and surrounding punctuation don't matter when comparing typed answers.
CREATE OR REPLACE FUNCTION public.norm_answer(_t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(regexp_replace(trim(COALESCE(_t, '')), '\s+', ' ', 'g'), '^[[:punct:]]+|[[:punct:]]+$', '', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.answer_matches(_given text, _accepted jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT public.norm_answer(_given) <> '' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(_accepted, '[]'::jsonb)) a WHERE public.norm_answer(a) = public.norm_answer(_given))
$$;

-- Score one response: {"points": n, "max": m, "pending": bool}
CREATE OR REPLACE FUNCTION public.score_response(_type text, _points integer, _correct_index integer, _key jsonb, _r jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
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
$$;

-- Instructor saves a whole quiz/exam. Question payload:
--   {type, prompt, choices, points, correct_index, answer}
CREATE OR REPLACE FUNCTION public.save_quiz(_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

-- Student submits: _responses is an array in question order (null = skipped). One try per quiz/exam.
CREATE OR REPLACE FUNCTION public.submit_quiz_v2(_quiz_id uuid, _responses jsonb, _started_at timestamptz DEFAULT NULL)
RETURNS public.quiz_attempts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.submit_quiz_v2(uuid, jsonb, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_quiz_v2(uuid, jsonb, timestamptz) TO authenticated;

-- Older app versions / answers queued offline (multiple choice only) still work.
CREATE OR REPLACE FUNCTION public.submit_quiz(_quiz_id uuid, _answers integer[], _started_at timestamptz DEFAULT NULL)
RETURNS public.quiz_attempts LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.submit_quiz_v2(_quiz_id,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('choice', x) ORDER BY i) FROM unnest(_answers) WITH ORDINALITY u(x, i)), '[]'::jsonb),
    _started_at)
$$;

-- Instructor grades essays: _scores = {"<question_id>": points, ...}. Recomputes the total.
CREATE OR REPLACE FUNCTION public.grade_attempt(_attempt_id uuid, _scores jsonb, _feedback text DEFAULT '')
RETURNS public.quiz_attempts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.grade_attempt(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grade_attempt(uuid, jsonb, text) TO authenticated;


-- ----------------------------------------------------------------------------
-- From 20261125000700_student_section_choice.sql
-- ----------------------------------------------------------------------------
-- Students choose their section themselves: at sign-up (metadata "section_id") or once in the app
-- if they don't have one yet (choose_my_section). After that, only an administrator can change it.

-- The sign-up screen lists sections before the user has an account.
GRANT SELECT ON public.sections TO anon;
DROP POLICY IF EXISTS "Anyone reads sections" ON public.sections;
CREATE POLICY "Anyone reads sections" ON public.sections FOR SELECT TO anon USING (true);

-- Non-admins can't change status, student number or section — except through choose_my_section().
CREATE OR REPLACE FUNCTION public.profiles_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    NEW.status := OLD.status;
    NEW.student_number := OLD.student_number;
    IF current_setting('cms.section_pick', true) IS DISTINCT FROM 'on' THEN
      NEW.section_id := OLD.section_id;
    END IF;
  END IF;
  NEW.email := OLD.email;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- One-time choice for a student who has no section yet.
CREATE OR REPLACE FUNCTION public.choose_my_section(_section_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _name text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT public.has_role(_uid, 'student') THEN RAISE EXCEPTION 'Only students choose a section'; END IF;
  SELECT name INTO _name FROM public.sections WHERE id = _section_id;
  IF _name IS NULL THEN RAISE EXCEPTION 'That section does not exist'; END IF;
  IF (SELECT section_id FROM public.profiles WHERE id = _uid) IS NOT NULL THEN
    RAISE EXCEPTION 'You already have a section. Ask your administrator to change it.';
  END IF;
  PERFORM set_config('cms.section_pick', 'on', true);
  UPDATE public.profiles SET section_id = _section_id WHERE id = _uid;
  PERFORM set_config('cms.section_pick', 'off', true);
  PERFORM public.log_activity('enrollment', 'Section chosen', _name);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.choose_my_section(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.choose_my_section(uuid) TO authenticated;

-- Sign-up: a student who picked a section starts in it.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  _meta_role text := _meta->>'role';
  _email text := lower(COALESCE(NEW.email, ''));
  _inv public.invitations;
  _section uuid;
BEGIN
  SELECT * INTO _inv FROM public.invitations WHERE email = _email;
  IF COALESCE(_meta->>'section_id', '') ~ '^[0-9a-fA-F-]{36}$' THEN
    SELECT id INTO _section FROM public.sections WHERE id = (_meta->>'section_id')::uuid;
  END IF;

  INSERT INTO public.profiles (id, full_name, email, section_id)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(_meta->>'full_name', ''), NULLIF(_meta->>'name', ''), _inv.full_name, ''),
    _email,
    CASE WHEN _inv.email IS NULL AND COALESCE(_meta_role, 'student') = 'student' THEN _section END
  )
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
  END IF;
  RETURN NEW;
END;
$$;


-- ----------------------------------------------------------------------------
-- From 20261125000800_room_types.sql
-- ----------------------------------------------------------------------------
-- Rooms are either a lecture room or a laboratory (used when scheduling classes).
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS room_type text NOT NULL DEFAULT 'lecture'
  CHECK (room_type IN ('lecture', 'laboratory'));

-- Existing rooms named like "Computer Lab 3" / "Laboratory 2" start as laboratories.
UPDATE public.rooms SET room_type = 'laboratory' WHERE name ~* '\mlab' AND room_type = 'lecture';


-- ----------------------------------------------------------------------------
-- From 20261125000900_instructor_suspension.sql
-- ----------------------------------------------------------------------------
-- Instructor statuses: pending → approved / rejected, and approved ⇄ suspended (admin only).
-- A suspended instructor keeps their account and data but loses every instructor feature
-- (web portal, mobile instructor screens, own classes, schedule) until an admin reactivates them.

ALTER TABLE public.instructor_profiles DROP CONSTRAINT IF EXISTS instructor_profiles_status_check;
ALTER TABLE public.instructor_profiles ADD CONSTRAINT instructor_profiles_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'suspended'));

ALTER TABLE public.instructor_verifications DROP CONSTRAINT IF EXISTS instructor_verifications_decision_check;
ALTER TABLE public.instructor_verifications ADD CONSTRAINT instructor_verifications_decision_check
  CHECK (decision IN ('approved', 'rejected', 'suspended', 'reactivated'));

-- False while the signed-in user's instructor access is suspended.
CREATE OR REPLACE FUNCTION public.instructor_not_suspended()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.instructor_profiles WHERE user_id = auth.uid() AND status = 'suspended')
$$;
GRANT EXECUTE ON FUNCTION public.instructor_not_suspended() TO authenticated;

-- Class content (quizzes, assignments, announcements, extra meetings, rosters) goes through this check.
CREATE OR REPLACE FUNCTION public.is_class_instructor(_class_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_user() AND public.instructor_not_suspended()
     AND EXISTS (SELECT 1 FROM public.classes WHERE id = _class_id AND instructor_id = auth.uid())
$$;

DROP POLICY IF EXISTS "Instructors read own classes" ON public.classes;
CREATE POLICY "Instructors read own classes" ON public.classes FOR SELECT TO authenticated
  USING ((instructor_id = auth.uid() AND public.is_active_user() AND public.instructor_not_suspended()) OR public.is_class_student(id));

DROP POLICY IF EXISTS "Instructors update own classes" ON public.classes;
CREATE POLICY "Instructors update own classes" ON public.classes FOR UPDATE TO authenticated
  USING (public.is_class_instructor(id)) WITH CHECK (instructor_id = auth.uid());
DROP POLICY IF EXISTS "Instructors delete own classes" ON public.classes;
CREATE POLICY "Instructors delete own classes" ON public.classes FOR DELETE TO authenticated
  USING (public.is_class_instructor(id));

-- Suspend or reactivate an approved instructor. Administrators only; recorded with who and when.
CREATE OR REPLACE FUNCTION public.set_instructor_suspension(_user_id uuid, _suspend boolean, _reason text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.set_instructor_suspension(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_instructor_suspension(uuid, boolean, text) TO authenticated;


-- ----------------------------------------------------------------------------
-- From 20261125001000_attendance.sql
-- ----------------------------------------------------------------------------
-- Attendance: one session per class per date; each enrolled student is Present or Absent.
-- Instructors take attendance for classes they teach (web + mobile, through save_attendance);
-- students read only their own records; administrators read everything (reports).

CREATE TABLE IF NOT EXISTS public.attendance_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  session_date date NOT NULL,
  taken_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, session_date)
);
CREATE INDEX IF NOT EXISTS attendance_sessions_class ON public.attendance_sessions (class_id, session_date DESC);

CREATE TABLE IF NOT EXISTS public.attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_email text NOT NULL,
  student_name text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('present', 'absent')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, student_email)
);
CREATE INDEX IF NOT EXISTS attendance_records_student ON public.attendance_records (student_email, class_id);

GRANT SELECT, DELETE ON public.attendance_sessions TO authenticated;
GRANT SELECT ON public.attendance_records TO authenticated;
GRANT ALL ON public.attendance_sessions, public.attendance_records TO service_role;
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

-- Reads: the class's instructor, administrators, and enrolled students (students: own records only).
CREATE POLICY "Instructors read attendance sessions" ON public.attendance_sessions FOR SELECT TO authenticated
  USING (public.is_class_instructor(class_id) OR public.is_admin() OR public.is_class_student(class_id));
CREATE POLICY "Instructors delete attendance sessions" ON public.attendance_sessions FOR DELETE TO authenticated
  USING (public.is_class_instructor(class_id));
CREATE POLICY "Read attendance records" ON public.attendance_records FOR SELECT TO authenticated
  USING (
    public.is_class_instructor(class_id) OR public.is_admin()
    OR (public.is_class_student(class_id) AND student_email = public.current_email())
  );

-- Save one class's attendance for one date (creates or replaces it). Instructor of the class only;
-- every email must be on the class roster. _records: [{"email": "...", "status": "present"|"absent"}]
CREATE OR REPLACE FUNCTION public.save_attendance(_class_id uuid, _date date, _records jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.save_attendance(uuid, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_attendance(uuid, date, jsonb) TO authenticated;


-- ----------------------------------------------------------------------------
-- From 20261125001100_assignment_files.sql
-- ----------------------------------------------------------------------------
-- File attachments on assignments (handouts, instructions, templates).
-- Files live in the private "assignment-files" bucket at  <class_id>/<assignment_id>/<file>.
-- Upload/delete: the class's instructor. Download: that instructor, students enrolled in the class, administrators.

ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.assignments DROP CONSTRAINT IF EXISTS assignments_attachments_array;
ALTER TABLE public.assignments ADD CONSTRAINT assignments_attachments_array CHECK (jsonb_typeof(attachments) = 'array');

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'assignment-files', 'assignment-files', false, 26214400, -- 25 MB per file
  ARRAY[
    'application/pdf',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif',
    'application/zip', 'application/x-zip-compressed'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- The class id is the first folder of the file path; NULL (never a match) if it isn't a UUID.
CREATE OR REPLACE FUNCTION public.assignment_file_class(_name text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN split_part(_name, '/', 1)::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

DROP POLICY IF EXISTS "Instructors upload assignment files" ON storage.objects;
CREATE POLICY "Instructors upload assignment files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'assignment-files' AND public.is_class_instructor(public.assignment_file_class(name)));

DROP POLICY IF EXISTS "Instructors delete assignment files" ON storage.objects;
CREATE POLICY "Instructors delete assignment files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'assignment-files' AND public.is_class_instructor(public.assignment_file_class(name)));

DROP POLICY IF EXISTS "Class members read assignment files" ON storage.objects;
CREATE POLICY "Class members read assignment files" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'assignment-files' AND (
      public.is_class_instructor(public.assignment_file_class(name))
      OR public.is_class_student(public.assignment_file_class(name))
      OR public.is_admin()
    )
  );


-- ----------------------------------------------------------------------------
-- From 20261125001200_lint_fixes.sql
-- ----------------------------------------------------------------------------
-- Database health check (lint) fix: score_response calls helpers that the planner treats as STABLE,
-- so it must not claim to be IMMUTABLE. Behaviour and results are unchanged.
ALTER FUNCTION public.score_response(text, integer, integer, jsonb, jsonb) STABLE;


-- ----------------------------------------------------------------------------
-- From 20261125001300_omr.sql
-- ----------------------------------------------------------------------------
-- OMR (paper answer sheets) — one pipeline for flatbed-scanner uploads (Instructor website) and phone
-- camera photos (mobile app). Both upload an image to the private "omr-scans" bucket and call the
-- "omr-process" Edge Function, which reads the sheet and fills in omr_scans. The instructor reviews,
-- resolves unclear answers, and finalizes; finalizing scores with the same score_response() used by
-- phone quizzes and creates a normal quiz_attempt, so results show up everywhere.

/* ---------- Printed sheets: one per student per exam (its id is in the sheet's QR code) ---------- */
CREATE TABLE IF NOT EXISTS public.omr_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_email text NOT NULL,
  student_name text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quiz_id, student_email)
);

/* ---------- Scans: every uploaded image / photo ---------- */
CREATE TABLE IF NOT EXISTS public.omr_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  sheet_id uuid REFERENCES public.omr_sheets(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('physical_scanner', 'mobile_camera')),
  original_name text NOT NULL DEFAULT '',
  image_path text NOT NULL,
  processed_path text,
  status text NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'processing', 'failed', 'needs_review', 'ready', 'finalized', 'duplicate')),
  message text NOT NULL DEFAULT '',
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- per question: {choice, status: answered|blank|multiple|uncertain, confidence, fills[]}
  detected jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- per question after review: chosen index, -1 = left blank, null = still unresolved
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric,
  score integer,
  total integer,
  attempt_id uuid REFERENCES public.quiz_attempts(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  reviewed_at timestamptz,
  finalized_at timestamptz,
  finalized_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS omr_scans_quiz ON public.omr_scans (quiz_id, created_at DESC);
CREATE INDEX IF NOT EXISTS omr_scans_sheet ON public.omr_scans (sheet_id);
-- A sheet can be graded only once.
CREATE UNIQUE INDEX IF NOT EXISTS omr_scans_one_final ON public.omr_scans (sheet_id) WHERE status = 'finalized';

GRANT SELECT ON public.omr_sheets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.omr_scans TO authenticated;
GRANT ALL ON public.omr_sheets, public.omr_scans TO service_role;
ALTER TABLE public.omr_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omr_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Instructors and admins read sheets" ON public.omr_sheets FOR SELECT TO authenticated
  USING (public.is_class_instructor(class_id) OR public.is_admin());
CREATE POLICY "Instructors and admins read scans" ON public.omr_scans FOR SELECT TO authenticated
  USING (public.is_class_instructor(class_id) OR public.is_admin());
CREATE POLICY "Instructors add scans" ON public.omr_scans FOR INSERT TO authenticated
  WITH CHECK (public.is_class_instructor(class_id) AND created_by = auth.uid()
              AND EXISTS (SELECT 1 FROM public.quizzes q WHERE q.id = quiz_id AND q.class_id = omr_scans.class_id));
CREATE POLICY "Instructors update scans" ON public.omr_scans FOR UPDATE TO authenticated
  USING (public.is_class_instructor(class_id)) WITH CHECK (public.is_class_instructor(class_id));
CREATE POLICY "Instructors delete unfinalized scans" ON public.omr_scans FOR DELETE TO authenticated
  USING (public.is_class_instructor(class_id) AND status <> 'finalized');

-- Finalized scans are locked, and only omr_finalize() may mark a scan finalized.
CREATE OR REPLACE FUNCTION public.omr_scans_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
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
$$;
DROP TRIGGER IF EXISTS omr_scans_guard ON public.omr_scans;
CREATE TRIGGER omr_scans_guard BEFORE UPDATE ON public.omr_scans FOR EACH ROW EXECUTE FUNCTION public.omr_scans_guard();

/* ---------- Private image storage: <class_id>/<quiz_id>/<scan_id>[.processed].jpg ---------- */
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('omr-scans', 'omr-scans', false, 15728640, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Instructors upload OMR scans" ON storage.objects;
CREATE POLICY "Instructors upload OMR scans" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'omr-scans' AND public.is_class_instructor(public.assignment_file_class(name)));
DROP POLICY IF EXISTS "Instructors replace OMR scans" ON storage.objects;
CREATE POLICY "Instructors replace OMR scans" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'omr-scans' AND public.is_class_instructor(public.assignment_file_class(name)));
DROP POLICY IF EXISTS "Instructors delete OMR scans" ON storage.objects;
CREATE POLICY "Instructors delete OMR scans" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'omr-scans' AND public.is_class_instructor(public.assignment_file_class(name)));
DROP POLICY IF EXISTS "Instructors and admins read OMR scans" ON storage.objects;
CREATE POLICY "Instructors and admins read OMR scans" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'omr-scans' AND (public.is_class_instructor(public.assignment_file_class(name)) OR public.is_admin()));

/* ---------- Which exams can go on paper ---------- */
-- Multiple choice (2–5 options) and True/False only; at most 50 questions (the sheet's bubble grid).
CREATE OR REPLACE FUNCTION public.omr_layout(_quiz_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.omr_layout(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omr_layout(uuid) TO authenticated;

-- Create (or keep) one printed sheet per enrolled student; returns all sheets of the exam.
CREATE OR REPLACE FUNCTION public.prepare_omr_sheets(_quiz_id uuid)
RETURNS SETOF public.omr_sheets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.prepare_omr_sheets(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_omr_sheets(uuid) TO authenticated;

/* ---------- Review: save the instructor's corrections ---------- */
-- _answers: one entry per question — choice index, -1 for blank, null for unresolved.
CREATE OR REPLACE FUNCTION public.omr_save_review(_scan_id uuid, _answers jsonb, _sheet_id uuid DEFAULT NULL)
RETURNS public.omr_scans LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.omr_save_review(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omr_save_review(uuid, jsonb, uuid) TO authenticated;

/* ---------- Finalize: grade with the shared scoring and create the student's attempt ---------- */
CREATE OR REPLACE FUNCTION public.omr_finalize(_scan_id uuid)
RETURNS public.omr_scans LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.omr_finalize(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omr_finalize(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- From 20261125001400_auto_classes.sql
-- ----------------------------------------------------------------------------
-- Subject + Class become one flow: scheduling a Subject for a Section with an Instructor automatically
-- creates that instructor's Class (one per subject · section · instructor) and enrolls the section's
-- students. Students who join / change section follow automatically; renaming a subject or section
-- renames its classes. Classes made by hand (no subject/section link) keep working as before.

ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS section_id uuid REFERENCES public.sections(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS classes_subject_section_instructor
  ON public.classes (subject_id, section_id, instructor_id) WHERE subject_id IS NOT NULL AND section_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS classes_section ON public.classes (section_id);

-- Enrollments added automatically from the section (removed again if the student changes section).
ALTER TABLE public.class_students ADD COLUMN IF NOT EXISTS auto boolean NOT NULL DEFAULT false;

/* The instructor's class for a subject in a section (created if missing), with the section's students enrolled. */
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

  SELECT id INTO _cls FROM public.classes WHERE subject_id = _subject AND section_id = _section AND instructor_id = _instructor;
  IF _cls IS NULL THEN
    INSERT INTO public.classes (instructor_id, code, title, section, description, subject_id, section_id)
    VALUES (_instructor, _sub.code, _sub.name, _sec.name, COALESCE(_sub.description, ''), _subject, _section)
    RETURNING id INTO _cls;
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

CREATE OR REPLACE FUNCTION public.trg_schedule_class()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ensure_schedule_class(NEW.subject_id, NEW.section_id, NEW.instructor_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS schedule_class ON public.instructor_schedules;
CREATE TRIGGER schedule_class AFTER INSERT OR UPDATE OF subject_id, section_id, instructor_id ON public.instructor_schedules
  FOR EACH ROW EXECUTE FUNCTION public.trg_schedule_class();

/* A student's section decides their automatic classes. */
CREATE OR REPLACE FUNCTION public.sync_student_section_classes(_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _p public.profiles;
BEGIN
  SELECT * INTO _p FROM public.profiles WHERE id = _user;
  IF _p.id IS NULL OR _p.email = '' THEN RETURN; END IF;
  -- leave automatic classes of other sections
  DELETE FROM public.class_students cs
  USING public.classes c
  WHERE cs.class_id = c.id AND cs.auto AND lower(cs.email) = lower(_p.email)
    AND c.section_id IS NOT NULL AND c.section_id IS DISTINCT FROM _p.section_id;
  -- join the automatic classes of the current section (students only)
  IF _p.section_id IS NOT NULL AND public.has_role(_p.id, 'student') THEN
    INSERT INTO public.class_students (class_id, email, full_name, auto)
    SELECT c.id, lower(_p.email), _p.full_name, true FROM public.classes c
    WHERE c.section_id = _p.section_id AND c.subject_id IS NOT NULL
    ON CONFLICT (class_id, email) DO NOTHING;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_student_section_classes(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_profile_section_classes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.section_id IS DISTINCT FROM OLD.section_id THEN
    PERFORM public.sync_student_section_classes(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profile_section_classes ON public.profiles;
CREATE TRIGGER profile_section_classes AFTER INSERT OR UPDATE OF section_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_profile_section_classes();

-- The student role is often granted just after the profile is created (sign-up / approval).
CREATE OR REPLACE FUNCTION public.trg_role_section_classes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.sync_student_section_classes(COALESCE(NEW.user_id, OLD.user_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS role_section_classes ON public.user_roles;
CREATE TRIGGER role_section_classes AFTER INSERT OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.trg_role_section_classes();

/* Renames follow. */
CREATE OR REPLACE FUNCTION public.trg_subject_rename_classes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code OR NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.classes SET code = NEW.code, title = NEW.name WHERE subject_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subject_rename_classes ON public.subjects;
CREATE TRIGGER subject_rename_classes AFTER UPDATE ON public.subjects FOR EACH ROW EXECUTE FUNCTION public.trg_subject_rename_classes();

CREATE OR REPLACE FUNCTION public.trg_section_rename_classes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.classes SET section = NEW.name WHERE section_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS section_rename_classes ON public.sections;
CREATE TRIGGER section_rename_classes AFTER UPDATE ON public.sections FOR EACH ROW EXECUTE FUNCTION public.trg_section_rename_classes();

/* Existing schedules get their classes now. */
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT subject_id, section_id, instructor_id FROM public.instructor_schedules LOOP
    PERFORM public.ensure_schedule_class(r.subject_id, r.section_id, r.instructor_id);
  END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- From 20261125001500_no_duplicate_classes.sql
-- ----------------------------------------------------------------------------
-- No duplicate classes: one class per (instructor, subject code, section).
-- 1) A schedule re-uses an existing class with the same code + section + instructor (even one made by hand)
--    instead of creating a second one.
-- 2) Creating a class that already exists (by hand, admin or instructor) is refused with a clear message.
-- 3) Existing duplicates that are completely empty are removed (never one with students or work in it).

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

  SELECT id INTO _cls FROM public.classes WHERE subject_id = _subject AND section_id = _section AND instructor_id = _instructor;
  IF _cls IS NULL THEN
    -- Same class made by hand earlier? Link it instead of creating a duplicate.
    SELECT id INTO _cls FROM public.classes
    WHERE instructor_id = _instructor AND lower(trim(code)) = lower(trim(_sub.code)) AND lower(trim(section)) = lower(trim(_sec.name))
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

/* 3) Remove existing empty duplicates (keep the scheduled one, else the oldest). */
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.id FROM public.classes c
    WHERE EXISTS (
      SELECT 1 FROM public.classes k
      WHERE k.id <> c.id AND k.instructor_id = c.instructor_id
        AND lower(trim(k.code)) = lower(trim(c.code)) AND lower(trim(k.section)) = lower(trim(c.section))
        AND (k.subject_id IS NOT NULL OR (c.subject_id IS NULL AND k.created_at < c.created_at))
    )
    AND c.subject_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.class_students x WHERE x.class_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.quizzes x WHERE x.class_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.assignments x WHERE x.class_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.announcements x WHERE x.class_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.class_schedules x WHERE x.class_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.attendance_sessions x WHERE x.class_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.omr_sheets x WHERE x.class_id = c.id)
  LOOP
    DELETE FROM public.classes WHERE id = r.id;
  END LOOP;
END $$;

/* 2) Refuse new duplicates. */
CREATE OR REPLACE FUNCTION public.classes_no_duplicate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.classes c
    WHERE c.id <> NEW.id AND c.instructor_id = NEW.instructor_id
      AND lower(trim(c.code)) = lower(trim(NEW.code)) AND lower(trim(c.section)) = lower(trim(NEW.section))
  ) THEN
    RAISE EXCEPTION 'This class already exists: % · % for this instructor. Open the existing class instead.', NEW.code, NEW.section;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS classes_no_duplicate ON public.classes;
CREATE TRIGGER classes_no_duplicate BEFORE INSERT OR UPDATE OF code, section, instructor_id ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.classes_no_duplicate();


-- ----------------------------------------------------------------------------
-- From 20261125001600_classes_from_subjects.sql
-- ----------------------------------------------------------------------------
-- As many classes as subjects: a class only exists because a Subject was scheduled for a Section with an
-- Instructor (ensure_schedule_class). Creating a class by hand is refused, and existing hand-made
-- classes that are completely empty are removed (never one with students or work in it).

CREATE OR REPLACE FUNCTION public.classes_from_subject_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.subject_id IS NULL OR NEW.section_id IS NULL THEN
    RAISE EXCEPTION 'Classes are created from Subjects. Add a Schedule for the subject, section and instructor and its class is made automatically.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS classes_from_subject_only ON public.classes;
CREATE TRIGGER classes_from_subject_only BEFORE INSERT ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.classes_from_subject_only();

DELETE FROM public.classes c
WHERE c.subject_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.class_students x WHERE x.class_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM public.quizzes x WHERE x.class_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM public.assignments x WHERE x.class_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM public.announcements x WHERE x.class_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM public.class_schedules x WHERE x.class_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM public.attendance_sessions x WHERE x.class_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM public.omr_sheets x WHERE x.class_id = c.id);


-- ----------------------------------------------------------------------------
-- From 20261126000100_lock_down_anon.sql
-- ----------------------------------------------------------------------------
-- Hardening: visitors who are not signed in (the public "anon" key) can no longer call any database
-- function. Signed-in users keep exactly the access they had; every function still checks who is calling.
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') -- skip extension functions
  LOOP
    IF has_function_privilege('authenticated', f.sig, 'EXECUTE') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
    END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;
END $$;

-- Functions created later are not callable by visitors either.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

-- Visitors only ever need the section list (sign-up screen). Nothing else is readable without signing in.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT SELECT ON public.sections TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;


-- ----------------------------------------------------------------------------
-- From 20261127000100_announcement_author.sql
-- ----------------------------------------------------------------------------
-- Announcements show who posted them. Students can't read other people's profiles, so the
-- poster's name is stamped onto the announcement by the database when it is written.

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS posted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS author_name text NOT NULL DEFAULT '';

-- Existing announcements: credit the class's instructor (before the trigger exists).
UPDATE public.announcements a
SET posted_by = c.instructor_id,
    author_name = COALESCE(NULLIF(p.full_name, ''), p.email, '')
FROM public.classes c
LEFT JOIN public.profiles p ON p.id = c.instructor_id
WHERE c.id = a.class_id AND a.posted_by IS NULL;

CREATE OR REPLACE FUNCTION public.trg_announcement_author()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.trg_announcement_author() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS announcements_author ON public.announcements;
CREATE TRIGGER announcements_author BEFORE INSERT OR UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.trg_announcement_author();


-- ----------------------------------------------------------------------------
-- From 20261127000200_keep_scheduled_classes.sql
-- ----------------------------------------------------------------------------
-- A class that is on the official schedule must exist, so the mobile app (which lists classes) and the
-- website (which reads the schedule) always show the same classes.

-- 1) Repair: re-create any class whose schedule still exists but whose class was deleted
--    (the section's students are enrolled again automatically).
SELECT public.ensure_schedule_class(s.subject_id, s.section_id, s.instructor_id)
FROM (SELECT DISTINCT subject_id, section_id, instructor_id FROM public.instructor_schedules) s;

-- 2) Prevent: a scheduled class can't be deleted; remove its schedule first (admin website → Schedules).
CREATE OR REPLACE FUNCTION public.classes_keep_scheduled()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.subject_id IS NOT NULL AND OLD.section_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.instructor_schedules s
    WHERE s.subject_id = OLD.subject_id AND s.section_id = OLD.section_id AND s.instructor_id = OLD.instructor_id
  ) THEN
    RAISE EXCEPTION 'This class is on the official schedule (% · %). Ask the administrator to remove its schedule first.', OLD.code, OLD.section;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.classes_keep_scheduled() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS classes_keep_scheduled ON public.classes;
CREATE TRIGGER classes_keep_scheduled BEFORE DELETE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.classes_keep_scheduled();


-- ----------------------------------------------------------------------------
-- From 20261127000300_semester_archive.sql
-- ----------------------------------------------------------------------------
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


-- ----------------------------------------------------------------------------
-- From 20261127000400_fix_start_semester.sql
-- ----------------------------------------------------------------------------
-- start_semester: the settings UPDATE needs a WHERE clause (Supabase blocks UPDATE without one).

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


-- ----------------------------------------------------------------------------
-- From 20261127000500_admin_manage_instructors.sql
-- ----------------------------------------------------------------------------
-- Admin CRUD for instructors.
--   Create: the admin-users Edge Function makes the login (needs the service key), then calls
--           admin_set_role(…,'instructor') and admin_save_instructor() as the admin.
--   Update: admin_save_instructor() — name, employee ID, department, contact number.
--   Delete: admin_delete_instructor() — one transaction; refused while they still teach this semester.

-- Archived (ended-semester) records stay read-only, except for the account clean-up done inside
-- admin_delete_instructor(), which sets a transaction-local flag.
CREATE OR REPLACE FUNCTION public.guard_archived_class()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

-- A class is "on the schedule" only for the ACTIVE semester's schedules.
CREATE OR REPLACE FUNCTION public.classes_keep_scheduled()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.archived_at IS NULL AND OLD.subject_id IS NOT NULL AND OLD.section_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.instructor_schedules s JOIN public.semesters t ON t.status = 'active' AND t.semester = s.semester AND t.academic_year = s.academic_year
    WHERE s.subject_id = OLD.subject_id AND s.section_id = OLD.section_id AND s.instructor_id = OLD.instructor_id
  ) THEN
    RAISE EXCEPTION 'This class is on the official schedule (% · %). Ask the administrator to remove its schedule first.', OLD.code, OLD.section;
  END IF;
  RETURN OLD;
END;
$$;

/* ---------- Update ---------- */
CREATE OR REPLACE FUNCTION public.admin_save_instructor(_user_id uuid, _full_name text, _employee_id text, _department text, _contact_number text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.admin_save_instructor(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_instructor(uuid, text, text, text, text) TO authenticated;

/* ---------- Delete ---------- */
CREATE OR REPLACE FUNCTION public.admin_delete_instructor(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.admin_delete_instructor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_instructor(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- From 20261127000600_suspension_notice.sql
-- ----------------------------------------------------------------------------
-- Suspended people are told why: the admin gives a reason, the person gets a notification, and the
-- app / website show the reason when they are signed out or try to sign in.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS suspension_reason text NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION public.trg_profile_suspension()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.trg_profile_suspension() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profile_suspension ON public.profiles;
CREATE TRIGGER profile_suspension BEFORE UPDATE OF status, suspension_reason ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_profile_suspension();


-- ----------------------------------------------------------------------------
-- From 20261127000700_semester_fresh_start.sql
-- ----------------------------------------------------------------------------
-- Ending a semester gives a fresh start for the next one.
-- Kept: subjects, instructors, student accounts, rooms (and the read-only archive of the ended semester).
-- Removed: the ended semester's schedules and all sections; every student's section is cleared, so
-- students renew by choosing their new section (or the admin assigns it). Students are notified.

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

  -- 5) Fresh start: only subjects, instructors, students and rooms carry over.
  --    The ended semester's schedules and all sections are removed (the archive keeps a copy), and every
  --    student must choose their section again for the next semester.
  DELETE FROM public.instructor_schedules WHERE semester = _sem.semester AND academic_year = _sem.academic_year;
  GET DIAGNOSTICS _schedules_removed = ROW_COUNT;

  SELECT count(*) INTO _students_renew FROM public.profiles WHERE section_id IS NOT NULL;
  UPDATE public.profiles SET section_id = NULL WHERE section_id IS NOT NULL;

  -- Sections still used by another semester's schedule stay; the rest are removed.
  UPDATE public.classes SET section_id = NULL
  WHERE section_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.instructor_schedules s WHERE s.section_id = classes.section_id);
  DELETE FROM public.sections x WHERE NOT EXISTS (SELECT 1 FROM public.instructor_schedules s WHERE s.section_id = x.id);
  GET DIAGNOSTICS _sections_removed = ROW_COUNT;

  PERFORM public.notify(p.id, 'schedule', 'New semester: choose your section',
    _sem.semester || ', AY ' || _sem.academic_year || ' has ended. Your records are in My Semesters. Choose your section for the new semester when it opens.')
  FROM public.profiles p WHERE public.has_role(p.id, 'student') AND p.status = 'active';

  UPDATE public.semester_archives
  SET summary = summary || jsonb_build_object('schedules_removed', _schedules_removed, 'sections_removed', _sections_removed, 'students_to_renew', _students_renew)
  WHERE semester_id = _sem.id;

  PERFORM public.log_activity('settings', 'Ended semester', _sem.semester || ', AY ' || _sem.academic_year,
                              _archived || ' classes archived', auth.uid());
  RETURN _summary || jsonb_build_object('archived_classes', _archived, 'archived_student_records', _student_rows,
    'schedules_removed', _schedules_removed, 'sections_removed', _sections_removed, 'students_to_renew', _students_renew);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.end_semester(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_semester(uuid) TO authenticated;

-- One-time clean-up: schedules of semesters that were ended before this rule existed
-- (their copies are in the archive). Current sections and students are not touched.
DELETE FROM public.instructor_schedules s
USING public.semesters t
WHERE t.status = 'completed' AND t.semester = s.semester AND t.academic_year = s.academic_year;


-- ----------------------------------------------------------------------------
-- From 20261127000800_admin_not_student.sql
-- ----------------------------------------------------------------------------
-- An administrator can never also be a student (any path: role change, invitation, Google sign-in).

-- Existing overlap: drop the student role from admin accounts (and any automatic class enrollments).
DELETE FROM public.class_students cs
USING public.profiles p
WHERE lower(cs.email) = lower(p.email) AND cs.auto
  AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role::text = 'admin');
UPDATE public.profiles p SET section_id = NULL
WHERE section_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role::text = 'admin');
DELETE FROM public.user_roles s
WHERE s.role::text = 'student' AND EXISTS (SELECT 1 FROM public.user_roles a WHERE a.user_id = s.user_id AND a.role::text = 'admin');

CREATE OR REPLACE FUNCTION public.trg_admin_not_student()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.trg_admin_not_student() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS admin_not_student ON public.user_roles;
CREATE TRIGGER admin_not_student BEFORE INSERT OR UPDATE OF role ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.trg_admin_not_student();


-- ----------------------------------------------------------------------------
-- From 20261127000900_semester_dates.sql
-- ----------------------------------------------------------------------------
-- Semesters can't overlap: a semester must start after the previous one ended.
-- "Ended" = whichever came first: its last day, or the day the admin ended it.

CREATE OR REPLACE FUNCTION public.previous_semester_end()
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT max(LEAST(COALESCE(ends_on, (ended_at AT TIME ZONE 'Asia/Manila')::date), COALESCE((ended_at AT TIME ZONE 'Asia/Manila')::date, ends_on)))
  FROM public.semesters WHERE status = 'completed'
$$;
GRANT EXECUTE ON FUNCTION public.previous_semester_end() TO authenticated;

-- Editing the active term (Semesters → Edit) is checked too.
CREATE OR REPLACE FUNCTION public.trg_settings_check_dates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.trg_settings_check_dates() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS settings_check_dates ON public.app_settings;
CREATE TRIGGER settings_check_dates BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.trg_settings_check_dates();

CREATE OR REPLACE FUNCTION public.start_semester(_semester text, _academic_year text, _starts_on date, _ends_on date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.start_semester(text, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_semester(text, text, date, date) TO authenticated;

-- Fix the current overlap: the active semester starts the day after the previous one ended.
UPDATE public.app_settings
SET semester_start = public.previous_semester_end() + 1, updated_at = now()
WHERE id = true AND EXISTS (SELECT 1 FROM public.semesters WHERE status = 'active')
  AND public.previous_semester_end() IS NOT NULL AND semester_start <= public.previous_semester_end()
  AND (semester_end IS NULL OR semester_end > public.previous_semester_end() + 1);
UPDATE public.semesters s
SET starts_on = a.semester_start
FROM public.app_settings a
WHERE s.status = 'active' AND s.starts_on IS DISTINCT FROM a.semester_start;


-- ----------------------------------------------------------------------------
-- From 20261127001000_renewals.sql
-- ----------------------------------------------------------------------------
-- Student and instructor renewal for each new semester / school year.
--
-- * Accounts are permanent (one per person). A renewal is the person's semester-specific record:
--   for a student it is their enrollment (course, year level, section) for that semester; for an
--   instructor it confirms they teach that semester.
-- * Nobody is enrolled or assigned automatically: a student gets a section (and with it the semester's
--   classes) only when an administrator approves their renewal; an instructor can only be scheduled for
--   the active semester once an administrator has confirmed them.
-- * Renewals of ended semesters are never changed (history); new semesters get new rows.

CREATE TABLE IF NOT EXISTS public.renewals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  semester_id uuid NOT NULL REFERENCES public.semesters(id),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('student', 'instructor')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  full_name text NOT NULL DEFAULT '',
  program text NOT NULL DEFAULT '',          -- student: course / program
  year_level integer,                        -- student
  preferred_section_id uuid REFERENCES public.sections(id) ON DELETE SET NULL,
  preferred_section_name text NOT NULL DEFAULT '',
  assigned_section_id uuid REFERENCES public.sections(id) ON DELETE SET NULL,
  assigned_section_name text NOT NULL DEFAULT '',
  details jsonb NOT NULL DEFAULT '{}'::jsonb, -- everything else the person confirmed (contact, IDs, notes)
  reason text NOT NULL DEFAULT '',           -- administrator's reason when rejected
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  reviewed_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (semester_id, user_id)
);
CREATE INDEX IF NOT EXISTS renewals_semester_status ON public.renewals (semester_id, kind, status);
GRANT SELECT ON public.renewals TO authenticated;
GRANT ALL ON public.renewals TO service_role;
ALTER TABLE public.renewals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read own or admin renewals" ON public.renewals;
CREATE POLICY "Read own or admin renewals" ON public.renewals FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
-- No write policies: renewals change only through the functions below.

/* ---------- Helpers ---------- */

CREATE OR REPLACE FUNCTION public.renewal_approved(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.renewals r WHERE r.user_id = _user AND r.status = 'approved' AND r.semester_id = public.current_semester_id())
$$;
GRANT EXECUTE ON FUNCTION public.renewal_approved(uuid) TO authenticated;

-- Records an approval made by an administrator (or by the system on their behalf).
CREATE OR REPLACE FUNCTION public.renewal_mark_approved(_user uuid, _kind text, _section uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _sem uuid := public.current_semester_id();
  _p public.profiles;
  _sec public.sections;
  _by text;
BEGIN
  IF _sem IS NULL THEN RETURN; END IF;
  SELECT * INTO _p FROM public.profiles WHERE id = _user;
  IF _p.id IS NULL THEN RETURN; END IF;
  SELECT * INTO _sec FROM public.sections WHERE id = _section;
  SELECT COALESCE(NULLIF(full_name, ''), email) INTO _by FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.renewals (semester_id, user_id, kind, status, full_name, program, year_level, assigned_section_id, assigned_section_name,
                               reviewed_at, reviewed_by, reviewed_by_name)
  VALUES (_sem, _user, _kind, 'approved', COALESCE(_p.full_name, ''), COALESCE(_sec.program, ''), _sec.year_level, _sec.id, COALESCE(_sec.name, ''),
          now(), auth.uid(), COALESCE(_by, ''))
  ON CONFLICT (semester_id, user_id) DO UPDATE SET
    status = 'approved', reason = '',
    assigned_section_id = COALESCE(EXCLUDED.assigned_section_id, public.renewals.assigned_section_id),
    assigned_section_name = CASE WHEN EXCLUDED.assigned_section_id IS NOT NULL THEN EXCLUDED.assigned_section_name ELSE public.renewals.assigned_section_name END,
    year_level = COALESCE(public.renewals.year_level, EXCLUDED.year_level),
    program = CASE WHEN public.renewals.program = '' THEN EXCLUDED.program ELSE public.renewals.program END,
    reviewed_at = now(), reviewed_by = auth.uid(), reviewed_by_name = COALESCE(_by, ''), updated_at = now();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.renewal_mark_approved(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

/* ---------- Students: a section only comes with an approved renewal ---------- */

-- Students may update their own student number while renewing (cms.renewal), never their status;
-- their section only changes through an administrator.
CREATE OR REPLACE FUNCTION public.profiles_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
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
$$;

-- An administrator giving a student a section (Users, Renewals) = an approved renewal for this semester.
CREATE OR REPLACE FUNCTION public.trg_section_renewal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.section_id IS NOT NULL AND NEW.section_id IS DISTINCT FROM OLD.section_id
     AND public.is_admin() AND public.has_role(NEW.id, 'student') THEN
    PERFORM public.renewal_mark_approved(NEW.id, 'student', NEW.section_id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trg_section_renewal() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS profile_section_renewal ON public.profiles;
CREATE TRIGGER profile_section_renewal AFTER UPDATE OF section_id ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.trg_section_renewal();

/* ---------- Instructors: only confirmed instructors can be scheduled this semester ---------- */

-- Approving an instructor (application, role change, invitation) during a semester confirms them for it.
CREATE OR REPLACE FUNCTION public.trg_instructor_approved_renewal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved') THEN
    PERFORM public.renewal_mark_approved(NEW.user_id, 'instructor', NULL);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trg_instructor_approved_renewal() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS instructor_approved_renewal ON public.instructor_profiles;
CREATE TRIGGER instructor_approved_renewal AFTER INSERT OR UPDATE OF status ON public.instructor_profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_instructor_approved_renewal();

CREATE OR REPLACE FUNCTION public.trg_schedule_needs_renewal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.trg_schedule_needs_renewal() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS schedule_needs_renewal ON public.instructor_schedules;
CREATE TRIGGER schedule_needs_renewal BEFORE INSERT OR UPDATE OF instructor_id, semester, academic_year ON public.instructor_schedules
  FOR EACH ROW EXECUTE FUNCTION public.trg_schedule_needs_renewal();

/* ---------- Submitting a renewal (student / instructor, from the app) ---------- */

CREATE OR REPLACE FUNCTION public.submit_renewal(_details jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _sem public.semesters;
  _kind text;
  _cur public.renewals;
  _name text := trim(COALESCE(_details->>'full_name', ''));
  _sec public.sections;
  _year int;
  _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'This account is suspended.'; END IF;
  SELECT * INTO _sem FROM public.semesters WHERE status = 'active';
  IF _sem.id IS NULL THEN RAISE EXCEPTION 'Renewal opens when the administrator starts the next semester.'; END IF;
  _kind := CASE WHEN public.is_approved_instructor(_uid) THEN 'instructor' WHEN public.has_role(_uid, 'student') THEN 'student' END;
  IF _kind IS NULL THEN RAISE EXCEPTION 'Only students and approved instructors renew.'; END IF;
  IF _name = '' THEN RAISE EXCEPTION 'Enter your full name.'; END IF;
  IF COALESCE((_details->>'confirmed')::boolean, false) IS NOT TRUE THEN RAISE EXCEPTION 'Confirm that your details are correct.'; END IF;

  SELECT * INTO _cur FROM public.renewals WHERE semester_id = _sem.id AND user_id = _uid;
  IF _cur.status = 'approved' THEN RAISE EXCEPTION 'Your renewal for % AY % is already approved.', _sem.semester, _sem.academic_year; END IF;

  IF _kind = 'student' THEN
    IF trim(COALESCE(_details->>'program', '')) = '' THEN RAISE EXCEPTION 'Enter your course / program.'; END IF;
    _year := NULLIF(_details->>'year_level', '')::int;
    IF _year IS NULL OR _year < 1 OR _year > 6 THEN RAISE EXCEPTION 'Choose your year level.'; END IF;
    IF NULLIF(_details->>'section_id', '') IS NOT NULL THEN
      SELECT * INTO _sec FROM public.sections WHERE id = (_details->>'section_id')::uuid;
    END IF;
    -- Personal information the student reviewed.
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

  INSERT INTO public.renewals (semester_id, user_id, kind, status, full_name, program, year_level, preferred_section_id, preferred_section_name, details, submitted_at)
  VALUES (_sem.id, _uid, _kind, 'pending', _name, trim(COALESCE(_details->>'program', '')), _year, _sec.id, COALESCE(_sec.name, ''),
          _details - 'confirmed', now())
  ON CONFLICT (semester_id, user_id) DO UPDATE SET
    status = 'pending', reason = '', full_name = EXCLUDED.full_name, program = EXCLUDED.program, year_level = EXCLUDED.year_level,
    preferred_section_id = EXCLUDED.preferred_section_id, preferred_section_name = EXCLUDED.preferred_section_name,
    details = EXCLUDED.details, submitted_at = now(), updated_at = now()
  RETURNING id INTO _id;

  PERFORM public.log_activity('enrollment', CASE WHEN _kind = 'student' THEN 'Enrollment renewal submitted' ELSE 'Instructor renewal submitted' END,
                              _name || ' · ' || _sem.semester || ', AY ' || _sem.academic_year, 'Pending');
  RETURN _id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.submit_renewal(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_renewal(jsonb) TO authenticated;

-- Older app versions call this: it now files a renewal request instead of enrolling directly.
CREATE OR REPLACE FUNCTION public.choose_my_section(_section_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

/* ---------- Admin: approve / reject ---------- */

CREATE OR REPLACE FUNCTION public.review_renewal(_user_id uuid, _approve boolean, _reason text DEFAULT '', _section_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _sem public.semesters;
  _r public.renewals;
  _kind text;
  _sec public.sections;
  _name text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only administrators review renewals.'; END IF;
  SELECT * INTO _sem FROM public.semesters WHERE status = 'active';
  IF _sem.id IS NULL THEN RAISE EXCEPTION 'No semester is active.'; END IF;
  SELECT * INTO _r FROM public.renewals WHERE semester_id = _sem.id AND user_id = _user_id;
  _kind := COALESCE(_r.kind, CASE WHEN public.is_approved_instructor(_user_id) THEN 'instructor' WHEN public.has_role(_user_id, 'student') THEN 'student' END);
  IF _kind IS NULL THEN RAISE EXCEPTION 'This account is not a student or an approved instructor.'; END IF;
  SELECT COALESCE(NULLIF(full_name, ''), email) INTO _name FROM public.profiles WHERE id = _user_id;

  IF _approve THEN
    IF _kind = 'student' THEN
      SELECT * INTO _sec FROM public.sections WHERE id = COALESCE(_section_id, _r.preferred_section_id);
      IF _sec.id IS NULL THEN RAISE EXCEPTION 'Choose the section to enroll % in.', _name; END IF;
      -- Giving the section enrolls the student in this semester's classes for it (and records the approval).
      UPDATE public.profiles SET section_id = _sec.id WHERE id = _user_id;
      PERFORM public.renewal_mark_approved(_user_id, 'student', _sec.id);
      PERFORM public.notify(_user_id, 'enrollment', 'Enrollment approved',
        'You are enrolled in ' || _sec.name || ' for ' || _sem.semester || ', AY ' || _sem.academic_year || '. Your classes are in Schedule and My Classes.');
    ELSE
      PERFORM public.renewal_mark_approved(_user_id, 'instructor', NULL);
      PERFORM public.notify(_user_id, 'enrollment', 'Teaching status confirmed',
        'You are confirmed for ' || _sem.semester || ', AY ' || _sem.academic_year || '. Your subjects and sections appear once they are assigned.');
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
$$;
REVOKE EXECUTE ON FUNCTION public.review_renewal(uuid, boolean, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_renewal(uuid, boolean, text, uuid) TO authenticated;

/* ---------- Sign-up: a chosen section becomes a renewal request (no automatic enrollment) ---------- */

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    IF _section.id IS NOT NULL AND _sem IS NOT NULL THEN
      INSERT INTO public.renewals (semester_id, user_id, kind, status, full_name, program, year_level, preferred_section_id, preferred_section_name, submitted_at)
      VALUES (_sem, NEW.id, 'student', 'pending', COALESCE(NULLIF(_meta->>'full_name', ''), _email), COALESCE(_section.program, ''), _section.year_level,
              _section.id, _section.name, now())
      ON CONFLICT (semester_id, user_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

/* ---------- Opening a semester tells everyone to renew ---------- */

CREATE OR REPLACE FUNCTION public.notify_renewal_open(_sem public.semesters)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.notify_renewal_open(public.semesters) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_semester_opened()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'active' THEN PERFORM public.notify_renewal_open(NEW); END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trg_semester_opened() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS semester_opened ON public.semesters;
CREATE TRIGGER semester_opened AFTER INSERT ON public.semesters FOR EACH ROW EXECUTE FUNCTION public.trg_semester_opened();

/* ---------- The semester that is already running ---------- */

-- Students who already have a section this semester keep it (recorded as approved);
-- everyone else is asked to renew.
DO $$
DECLARE
  _sem public.semesters;
  _p record;
BEGIN
  SELECT * INTO _sem FROM public.semesters WHERE status = 'active';
  IF _sem.id IS NULL THEN RETURN; END IF;
  FOR _p IN SELECT p.id, p.full_name, p.section_id FROM public.profiles p
            WHERE p.section_id IS NOT NULL AND public.has_role(p.id, 'student') LOOP
    INSERT INTO public.renewals (semester_id, user_id, kind, status, full_name, program, year_level, assigned_section_id, assigned_section_name, reviewed_at, reviewed_by_name)
    SELECT _sem.id, _p.id, 'student', 'approved', COALESCE(_p.full_name, ''), COALESCE(s.program, ''), s.year_level, s.id, s.name, now(), 'Already enrolled'
    FROM public.sections s WHERE s.id = _p.section_id
    ON CONFLICT (semester_id, user_id) DO NOTHING;
  END LOOP;
  PERFORM public.notify_renewal_open(_sem);
END $$;

/* ---------- Ending a semester tells instructors where their records are (students are told by end_semester) ---------- */
CREATE OR REPLACE FUNCTION public.trg_semester_closed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status = 'active' THEN
    PERFORM public.notify(p.id, 'enrollment', NEW.semester || ', AY ' || NEW.academic_year || ' has ended',
      'Your classes, grades and attendance are saved in Previous Semesters. You will be asked to confirm your status when the next semester opens.')
    FROM public.profiles p WHERE p.status = 'active' AND public.is_approved_instructor(p.id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trg_semester_closed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS semester_closed ON public.semesters;
CREATE TRIGGER semester_closed AFTER UPDATE OF status ON public.semesters FOR EACH ROW EXECUTE FUNCTION public.trg_semester_closed();

/* =====================================================================
   Renewal opens as soon as a semester ends.
   Until the admin starts the next semester, a renewal belongs to "the next semester"
   (semester_id IS NULL). Starting the semester attaches those renewals to it.
   ===================================================================== */

ALTER TABLE public.renewals ALTER COLUMN semester_id DROP NOT NULL;
ALTER TABLE public.renewals DROP CONSTRAINT IF EXISTS renewals_semester_id_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS renewals_one_per_semester ON public.renewals (semester_id, user_id) WHERE semester_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS renewals_one_upcoming ON public.renewals (user_id) WHERE semester_id IS NULL;

-- Renewals open while a semester runs, and also after one has ended (for the next semester).
CREATE OR REPLACE FUNCTION public.renewal_open()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.semesters)
$$;
GRANT EXECUTE ON FUNCTION public.renewal_open() TO authenticated;

CREATE OR REPLACE FUNCTION public.renewal_approved(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.renewals r WHERE r.user_id = _user AND r.status = 'approved'
                 AND r.semester_id IS NOT DISTINCT FROM public.current_semester_id())
$$;

-- The renewal row for the current target (active semester, or the next one) — created when missing.
CREATE OR REPLACE FUNCTION public.renewal_row(_user uuid, _kind text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.renewal_row(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.renewal_mark_approved(_user uuid, _kind text, _section uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.renewal_mark_approved(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_renewal(_details jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  PERFORM public.log_activity('enrollment', CASE WHEN _kind = 'student' THEN 'Enrollment renewal submitted' ELSE 'Instructor renewal submitted' END,
                              _name || ' · ' || _term, 'Pending');
  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_renewal(_user_id uuid, _approve boolean, _reason text DEFAULT '', _section_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

-- Starting a semester: renewals filed for "the next semester" now belong to it; then remind the rest.
CREATE OR REPLACE FUNCTION public.trg_semester_opened()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'active' THEN
    UPDATE public.renewals SET semester_id = NEW.id, updated_at = now() WHERE semester_id IS NULL;
    PERFORM public.notify_renewal_open(NEW);
  END IF;
  RETURN NEW;
END;
$$;

-- Ending a semester opens renewal for the next one right away.
CREATE OR REPLACE FUNCTION public.trg_semester_closed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;


-- Sign-up with a section: the request is for the active semester, or the next one between semesters.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
      INSERT INTO public.renewals (semester_id, user_id, kind, status, full_name, program, year_level, preferred_section_id, preferred_section_name, submitted_at)
      VALUES (_sem, NEW.id, 'student', 'pending', COALESCE(NULLIF(_meta->>'full_name', ''), _email), COALESCE(_section.program, ''), _section.year_level,
              _section.id, _section.name, now());
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- End semester: same as before; the renewal notice comes from trg_semester_closed.
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

  -- 5) Fresh start: only subjects, instructors, students and rooms carry over.
  --    The ended semester's schedules and all sections are removed (the archive keeps a copy), and every
  --    student must choose their section again for the next semester.
  DELETE FROM public.instructor_schedules WHERE semester = _sem.semester AND academic_year = _sem.academic_year;
  GET DIAGNOSTICS _schedules_removed = ROW_COUNT;

  SELECT count(*) INTO _students_renew FROM public.profiles WHERE section_id IS NOT NULL;
  UPDATE public.profiles SET section_id = NULL WHERE section_id IS NOT NULL;

  -- Sections still used by another semester's schedule stay; the rest are removed.
  UPDATE public.classes SET section_id = NULL
  WHERE section_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.instructor_schedules s WHERE s.section_id = classes.section_id);
  DELETE FROM public.sections x WHERE NOT EXISTS (SELECT 1 FROM public.instructor_schedules s WHERE s.section_id = x.id);
  GET DIAGNOSTICS _sections_removed = ROW_COUNT;

  -- Students and instructors are told by trg_semester_closed (renewal for the next semester opens now).

  UPDATE public.semester_archives
  SET summary = summary || jsonb_build_object('schedules_removed', _schedules_removed, 'sections_removed', _sections_removed, 'students_to_renew', _students_renew)
  WHERE semester_id = _sem.id;

  PERFORM public.log_activity('settings', 'Ended semester', _sem.semester || ', AY ' || _sem.academic_year,
                              _archived || ' classes archived', auth.uid());
  RETURN _summary || jsonb_build_object('archived_classes', _archived, 'archived_student_records', _student_rows,
    'schedules_removed', _schedules_removed, 'sections_removed', _sections_removed, 'students_to_renew', _students_renew);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.end_semester(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_semester(uuid) TO authenticated;

-- Between semesters right now: tell everyone renewal for the next semester is open.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.semesters WHERE status = 'active') AND EXISTS (SELECT 1 FROM public.semesters) THEN
    PERFORM public.notify(p.id, 'enrollment', 'Renewal for the next semester is open',
      'Open the app and tap “Renew Enrollment” to confirm your course, year level and section.')
    FROM public.profiles p WHERE p.status = 'active' AND public.has_role(p.id, 'student') AND NOT public.has_role(p.id, 'admin');
    PERFORM public.notify(p.id, 'enrollment', 'Confirm your status for the next semester',
      'Open the app and tap “Confirm Status” so the administrator can assign your subjects and sections.')
    FROM public.profiles p WHERE p.status = 'active' AND public.is_approved_instructor(p.id);
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- From 20261127001100_student_self_renewal.sql
-- ----------------------------------------------------------------------------
-- Renewal rule: only instructors need an administrator's approval.
-- Students renew themselves: choosing their section in Renew Enrollment (or at sign-up) enrolls them
-- right away for the active semester (or the next one, between semesters).

CREATE OR REPLACE FUNCTION public.submit_renewal(_details jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;


-- ----------------------------------------------------------------------------
-- From 20261127001200_realtime.sql
-- ----------------------------------------------------------------------------
-- Live updates for the mobile app: Supabase Realtime sends a change event for these tables
-- (only for rows each person is allowed to see — row-level security still applies), and the app
-- quietly refreshes the open screen.
DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'semesters', 'renewals', 'sections', 'classes', 'class_students', 'class_schedules', 'instructor_schedules',
    'quizzes', 'quiz_attempts', 'assignments', 'announcements', 'attendance_sessions', 'attendance_records',
    'notifications', 'profiles', 'instructor_profiles'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- From 20261127001300_keep_sections.sql
-- ----------------------------------------------------------------------------
-- Ending a semester keeps rooms, subjects AND sections for the next semester.
-- Still removed: the ended semester's schedules (archived). Students still renew by choosing a section.

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
$$;
REVOKE EXECUTE ON FUNCTION public.end_semester(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_semester(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- From 20261127001400_contact_optional.sql
-- ----------------------------------------------------------------------------
-- The mobile app no longer asks for a contact number: it is optional for instructor applications.

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
