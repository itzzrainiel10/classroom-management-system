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