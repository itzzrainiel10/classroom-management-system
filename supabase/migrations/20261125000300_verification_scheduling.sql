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
