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
