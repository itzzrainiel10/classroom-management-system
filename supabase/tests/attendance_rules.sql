-- Dry-run check of attendance permissions. Uses real accounts on a temporary class, always ends with
-- "RESULT: ..." and undoes everything (nothing is saved). Every item should end in "ok".
DO $$
DECLARE
  adm uuid := (SELECT user_id FROM public.user_roles WHERE role::text = 'admin' LIMIT 1);
  inst uuid := (SELECT r.user_id FROM public.user_roles r JOIN public.instructor_profiles ip ON ip.user_id = r.user_id
                WHERE r.role::text = 'instructor' AND ip.status = 'approved' ORDER BY r.user_id LIMIT 1);
  other uuid := (SELECT r.user_id FROM public.user_roles r JOIN public.instructor_profiles ip ON ip.user_id = r.user_id
                 WHERE r.role::text = 'instructor' AND ip.status = 'approved' ORDER BY r.user_id DESC LIMIT 1);
  stu uuid := (SELECT user_id FROM public.user_roles WHERE role::text = 'student' LIMIT 1);
  stu_email text;
  cls uuid := gen_random_uuid();
  n int; s text; msg text := '';
BEGIN
  -- these checks build classes directly (rolled back at the end)
  ALTER TABLE public.classes DISABLE TRIGGER classes_from_subject_only;
  IF adm IS NULL OR inst IS NULL OR stu IS NULL THEN RAISE EXCEPTION 'RESULT: missing test accounts'; END IF;
  -- Only one approved instructor? Use a made-up outsider account (not this class's instructor) instead.
  IF other IS NULL OR other = inst THEN other := gen_random_uuid(); END IF;
  SELECT email INTO stu_email FROM public.profiles WHERE id = stu;
  INSERT INTO public.classes (id, instructor_id, code, title, section) VALUES (cls, inst, 'TEST 101', 'Attendance test', 'TEST 1-1');
  INSERT INTO public.class_students (class_id, email, full_name) VALUES (cls, stu_email, 'Test Student');
  PERFORM set_config('role', 'authenticated', true);

  /* class instructor */
  PERFORM set_config('request.jwt.claims', json_build_object('sub', inst, 'role', 'authenticated')::text, true);
  PERFORM public.save_attendance(cls, current_date, json_build_array(json_build_object('email', stu_email, 'status', 'present'))::jsonb);
  SELECT count(*) INTO n FROM public.attendance_records WHERE class_id = cls AND status = 'present';
  msg := msg || format('1 instructor saves present=%s %s; ', n, CASE WHEN n = 1 THEN 'ok' ELSE 'BAD' END);
  PERFORM public.save_attendance(cls, current_date, json_build_array(json_build_object('email', stu_email, 'status', 'absent'))::jsonb);
  SELECT count(*), max(status) INTO n, s FROM public.attendance_records WHERE class_id = cls;
  msg := msg || format('2 re-save updates rows=%s status=%s %s; ', n, s, CASE WHEN n = 1 AND s = 'absent' THEN 'ok' ELSE 'BAD' END);
  BEGIN
    PERFORM public.save_attendance(cls, current_date, json_build_array(json_build_object('email', 'stranger@example.com', 'status', 'present'))::jsonb);
    msg := msg || '3 non-enrolled student ALLOWED BAD; ';
  EXCEPTION WHEN others THEN msg := msg || '3 non-enrolled student blocked ok; '; END;
  BEGIN
    PERFORM public.save_attendance(cls, current_date + 30, json_build_array(json_build_object('email', stu_email, 'status', 'present'))::jsonb);
    msg := msg || '4 future date ALLOWED BAD; ';
  EXCEPTION WHEN others THEN msg := msg || '4 future date blocked ok; '; END;

  /* student */
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'email', stu_email, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.attendance_records WHERE class_id = cls;
  msg := msg || format('5 student sees own records=%s %s; ', n, CASE WHEN n = 1 THEN 'ok' ELSE 'BAD' END);
  BEGIN
    PERFORM public.save_attendance(cls, current_date, json_build_array(json_build_object('email', stu_email, 'status', 'present'))::jsonb);
    msg := msg || '6 student marks self ALLOWED BAD; ';
  EXCEPTION WHEN others THEN msg := msg || '6 student marks self blocked ok; '; END;

  /* another instructor */
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', other, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO n FROM public.attendance_records WHERE class_id = cls;
    msg := msg || format('7 other instructor sees=%s %s; ', n, CASE WHEN n = 0 THEN 'ok' ELSE 'BAD' END);
    BEGIN
      PERFORM public.save_attendance(cls, current_date, json_build_array(json_build_object('email', stu_email, 'status', 'present'))::jsonb);
      msg := msg || '8 other instructor saves ALLOWED BAD; ';
    EXCEPTION WHEN others THEN msg := msg || '8 other instructor blocked ok; '; END;
  END;

  /* administrator (read-only reports) */
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.attendance_records WHERE class_id = cls;
  msg := msg || format('9 admin sees=%s %s', n, CASE WHEN n = 1 THEN 'ok' ELSE 'BAD' END);

  RAISE EXCEPTION 'RESULT: %', msg;
END $$;
