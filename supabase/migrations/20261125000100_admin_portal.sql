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
