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
