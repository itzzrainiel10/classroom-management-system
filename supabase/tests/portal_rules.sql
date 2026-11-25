-- Dry-run check of admin vs instructor permissions (separate portals). Uses real accounts, always ends
-- with "RESULT: ..." and undoes everything (nothing is saved). Every line should end in "ok".
DO $$
DECLARE
  adm uuid := (SELECT user_id FROM public.user_roles WHERE role::text = 'admin' LIMIT 1);
  inst uuid := (SELECT r.user_id FROM public.user_roles r JOIN public.instructor_profiles ip ON ip.user_id = r.user_id
                WHERE r.role::text = 'instructor' AND ip.status = 'approved' ORDER BY r.user_id LIMIT 1);
  other uuid := (SELECT r.user_id FROM public.user_roles r JOIN public.instructor_profiles ip ON ip.user_id = r.user_id
                 WHERE r.role::text = 'instructor' AND ip.status = 'approved' ORDER BY r.user_id DESC LIMIT 1);
  stu uuid := (SELECT user_id FROM public.user_roles WHERE role::text = 'student' LIMIT 1);
  sch public.instructor_schedules;
  n int; b boolean; s text; msg text := '';
BEGIN
  IF adm IS NULL OR inst IS NULL OR stu IS NULL THEN RAISE EXCEPTION 'RESULT: missing test accounts'; END IF;
  SELECT * INTO sch FROM public.instructor_schedules LIMIT 1;

  /* ---------- as an approved instructor ---------- */
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', inst, 'role', 'authenticated')::text, true);

  SELECT public.is_admin() INTO b;
  msg := msg || format('1 instructor is_admin=%s %s; ', b, CASE WHEN NOT b THEN 'ok' ELSE 'BAD' END);

  BEGIN PERFORM public.review_instructor(stu, true, ''); msg := msg || '2 approve others ALLOWED BAD; ';
  EXCEPTION WHEN others THEN msg := msg || '2 approve others blocked ok; '; END;

  BEGIN PERFORM public.set_instructor_suspension(other, true, 'x'); msg := msg || '3 suspend others ALLOWED BAD; ';
  EXCEPTION WHEN others THEN msg := msg || '3 suspend others blocked ok; '; END;

  BEGIN
    UPDATE public.instructor_profiles SET status = 'approved', employee_id = 'HACK' WHERE user_id = inst;
    GET DIAGNOSTICS n = ROW_COUNT;
    msg := msg || format('4 edit own verification rows=%s %s; ', n, CASE WHEN n = 0 THEN 'ok' ELSE 'BAD' END);
  EXCEPTION WHEN others THEN msg := msg || '4 edit own verification blocked ok; '; END;

  BEGIN INSERT INTO public.user_roles (user_id, role) VALUES (inst, 'admin'); msg := msg || '5 make self admin ALLOWED BAD; ';
  EXCEPTION WHEN others THEN msg := msg || '5 make self admin blocked ok; '; END;

  BEGIN PERFORM public.admin_set_role(stu, 'instructor'); msg := msg || '6 change roles ALLOWED BAD; ';
  EXCEPTION WHEN others THEN msg := msg || '6 change roles blocked ok; '; END;

  BEGIN
    UPDATE public.profiles SET status = 'suspended', section_id = (SELECT id FROM public.sections LIMIT 1) WHERE id = inst;
    SELECT status INTO s FROM public.profiles WHERE id = inst;
    msg := msg || format('7 own account status stays %s %s; ', s, CASE WHEN s = 'active' THEN 'ok' ELSE 'BAD' END);
  EXCEPTION WHEN others THEN msg := msg || '7 own status blocked ok; '; END;

  IF sch.id IS NOT NULL THEN
    BEGIN
      UPDATE public.instructor_schedules SET room_id = room_id WHERE id = sch.id;
      GET DIAGNOSTICS n = ROW_COUNT;
      msg := msg || format('8 edit official schedule rows=%s %s; ', n, CASE WHEN n = 0 THEN 'ok' ELSE 'BAD' END);
    EXCEPTION WHEN others THEN msg := msg || '8 edit official schedule blocked ok; '; END;
    BEGIN
      INSERT INTO public.instructor_schedules (instructor_id, subject_id, section_id, room_id, day_of_week, start_time, end_time, semester, academic_year)
      VALUES (inst, sch.subject_id, sch.section_id, sch.room_id, 6, '20:00', '21:00', sch.semester, sch.academic_year);
      msg := msg || '9 assign self to section ALLOWED BAD; ';
    EXCEPTION WHEN others THEN msg := msg || '9 assign self to section blocked ok; '; END;
  ELSE
    msg := msg || '8-9 skipped (no schedules); ';
  END IF;

  SELECT count(*) INTO n FROM public.activity_log;
  msg := msg || format('10 sees admin activity log rows=%s %s; ', n, CASE WHEN n = 0 THEN 'ok' ELSE 'BAD' END);
  SELECT count(*) INTO n FROM public.instructor_profiles WHERE user_id <> inst;
  msg := msg || format('11 sees other applications=%s %s; ', n, CASE WHEN n = 0 THEN 'ok' ELSE 'BAD' END);
  SELECT count(*) INTO n FROM public.my_schedule();
  msg := msg || format('12 own schedule rows=%s ok; ', n);

  /* ---------- as admin: suspend, then the instructor loses access ---------- */
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  PERFORM public.set_instructor_suspension(inst, true, 'Test suspension');
  SELECT status INTO s FROM public.instructor_profiles WHERE user_id = inst;
  SELECT count(*) INTO n FROM public.instructor_verifications WHERE user_id = inst AND decision = 'suspended' AND decided_by = adm AND decided_at IS NOT NULL;
  msg := msg || format('13 admin suspends status=%s logged=%s %s; ', s, n, CASE WHEN s = 'suspended' AND n > 0 THEN 'ok' ELSE 'BAD' END);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', inst, 'role', 'authenticated')::text, true);
  SELECT public.is_approved_instructor(inst) INTO b;
  SELECT count(*) INTO n FROM public.my_schedule();
  msg := msg || format('14 suspended can teach=%s schedule rows=%s %s; ', b, n, CASE WHEN NOT b AND n = 0 THEN 'ok' ELSE 'BAD' END);
  SELECT count(*) INTO n FROM public.classes WHERE instructor_id = inst;
  msg := msg || format('15 suspended sees own classes=%s %s; ', n, CASE WHEN n = 0 THEN 'ok' ELSE 'BAD' END);
  BEGIN PERFORM public.set_instructor_suspension(inst, false, ''); msg := msg || '16 self-reactivate ALLOWED BAD; ';
  EXCEPTION WHEN others THEN msg := msg || '16 self-reactivate blocked ok; '; END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  PERFORM public.set_instructor_suspension(inst, false, '');
  SELECT status INTO s FROM public.instructor_profiles WHERE user_id = inst;
  msg := msg || format('17 admin reactivates status=%s %s; ', s, CASE WHEN s = 'approved' THEN 'ok' ELSE 'BAD' END);
  BEGIN PERFORM public.set_instructor_suspension(inst, true, ''); msg := msg || '18 suspend without reason ALLOWED BAD; ';
  EXCEPTION WHEN others THEN msg := msg || '18 suspend needs reason ok; '; END;

  /* ---------- student cannot do admin work either ---------- */
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  BEGIN PERFORM public.review_instructor(inst, false, 'x'); msg := msg || '19 student reviews ALLOWED BAD';
  EXCEPTION WHEN others THEN msg := msg || '19 student reviews blocked ok'; END;

  RAISE EXCEPTION 'RESULT: %', msg;
END $$;
