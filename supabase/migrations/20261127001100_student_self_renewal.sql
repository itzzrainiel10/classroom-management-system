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
