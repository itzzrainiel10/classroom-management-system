-- Dry-run check of the OMR database rules (review, finalize, scoring, duplicates, permissions).
-- Uses real accounts on a temporary class; always ends with "RESULT: ..." and undoes everything.
DO $$
DECLARE
  inst uuid := (SELECT r.user_id FROM public.user_roles r JOIN public.instructor_profiles ip ON ip.user_id = r.user_id
                WHERE r.role::text = 'instructor' AND ip.status = 'approved' ORDER BY r.user_id LIMIT 1);
  stu uuid := (SELECT user_id FROM public.user_roles WHERE role::text = 'student' LIMIT 1);
  outsider uuid := gen_random_uuid();
  stu_email text;
  cls uuid := gen_random_uuid();
  qz uuid := gen_random_uuid();
  sheet uuid;
  s1 uuid := gen_random_uuid();
  s2 uuid := gen_random_uuid();
  r public.omr_scans;
  n int; msg text := '';
BEGIN
  IF inst IS NULL OR stu IS NULL THEN RAISE EXCEPTION 'RESULT: missing test accounts'; END IF;
  SELECT email INTO stu_email FROM public.profiles WHERE id = stu;
  INSERT INTO public.classes (id, instructor_id, code, title, section) VALUES (cls, inst, 'TEST 101', 'OMR test', 'TEST 1-1');
  INSERT INTO public.class_students (class_id, email, full_name) VALUES (cls, stu_email, 'Test Student');
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', inst, 'role', 'authenticated')::text, true);

  -- Exam: Q1 MC (correct C), Q2 MC (correct A), Q3 True/False (correct False), 1 point each.
  PERFORM public.save_quiz(json_build_object('id', qz, 'class_id', cls, 'title', 'OMR test exam', 'kind', 'exam', 'status', 'published',
    'questions', json_build_array(
      json_build_object('type', 'multiple_choice', 'prompt', 'q1', 'choices', json_build_array('a','b','c','d'), 'correct_index', 2, 'points', 1),
      json_build_object('type', 'multiple_choice', 'prompt', 'q2', 'choices', json_build_array('a','b','c','d'), 'correct_index', 0, 'points', 1),
      json_build_object('type', 'true_false', 'prompt', 'q3', 'answer', json_build_object('value', false), 'points', 1)))::jsonb);
  SELECT count(*) INTO n FROM jsonb_array_elements(public.omr_layout(qz));
  msg := msg || format('1 layout questions=%s %s; ', n, CASE WHEN n = 3 THEN 'ok' ELSE 'BAD' END);
  SELECT id INTO sheet FROM public.prepare_omr_sheets(qz) LIMIT 1;
  msg := msg || format('2 sheet prepared %s; ', CASE WHEN sheet IS NOT NULL THEN 'ok' ELSE 'BAD' END);

  -- A scan as the Edge Function would leave it: Q1=C read, Q2 unclear, Q3 = B (False) read.
  INSERT INTO public.omr_scans (id, quiz_id, class_id, source, image_path, created_by) VALUES (s1, qz, cls, 'mobile_camera', cls || '/' || qz || '/' || s1 || '.jpg', inst);
  UPDATE public.omr_scans SET status = 'needs_review', sheet_id = sheet, answers = '[2, null, 1]'::jsonb,
    detected = '[{"choice":2,"status":"answered"},{"choice":null,"status":"uncertain"},{"choice":1,"status":"answered"}]'::jsonb WHERE id = s1;

  BEGIN PERFORM public.omr_finalize(s1); msg := msg || '3 finalize with unclear answer ALLOWED BAD; ';
  EXCEPTION WHEN others THEN msg := msg || '3 finalize blocked while unresolved ok; '; END;
  BEGIN UPDATE public.omr_scans SET status = 'finalized' WHERE id = s1; msg := msg || '4 direct finalize ALLOWED BAD; ';
  EXCEPTION WHEN others THEN msg := msg || '4 direct status=finalized blocked ok; '; END;

  r := public.omr_save_review(s1, '[2, 1, 1]'::jsonb, NULL); -- instructor decides Q2 = B (wrong)
  msg := msg || format('5 review saved status=%s %s; ', r.status, CASE WHEN r.status = 'ready' THEN 'ok' ELSE 'BAD' END);
  r := public.omr_finalize(s1);
  msg := msg || format('6 finalized score=%s/%s %s; ', r.score, r.total, CASE WHEN r.score = 2 AND r.total = 3 THEN 'ok' ELSE 'BAD' END);
  SELECT count(*) INTO n FROM public.quiz_attempts WHERE quiz_id = qz AND student_id = stu AND score = 2 AND total = 3;
  msg := msg || format('7 student attempt created=%s %s; ', n, CASE WHEN n = 1 THEN 'ok' ELSE 'BAD' END);
  BEGIN UPDATE public.omr_scans SET answers = '[0,0,0]'::jsonb WHERE id = s1; msg := msg || '8 edit finalized ALLOWED BAD; ';
  EXCEPTION WHEN others THEN msg := msg || '8 finalized sheet locked ok; '; END;

  -- A second scan of the same student's sheet must not be graded again.
  INSERT INTO public.omr_scans (id, quiz_id, class_id, source, image_path, created_by) VALUES (s2, qz, cls, 'physical_scanner', cls || '/' || qz || '/' || s2 || '.jpg', inst);
  UPDATE public.omr_scans SET status = 'needs_review', sheet_id = sheet, answers = '[2,0,1]'::jsonb, detected = '[{},{},{}]'::jsonb WHERE id = s2;
  PERFORM public.omr_save_review(s2, '[2,0,1]'::jsonb, NULL);
  BEGIN PERFORM public.omr_finalize(s2); msg := msg || '9 duplicate graded ALLOWED BAD; ';
  EXCEPTION WHEN others THEN msg := msg || '9 duplicate blocked ok; '; END;

  -- Others cannot see or touch scans.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'email', stu_email, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.omr_scans WHERE quiz_id = qz;
  msg := msg || format('10 student sees scans=%s %s; ', n, CASE WHEN n = 0 THEN 'ok' ELSE 'BAD' END);
  BEGIN PERFORM public.omr_finalize(s2); msg := msg || '11 student finalize ALLOWED BAD; ';
  EXCEPTION WHEN others THEN msg := msg || '11 student finalize blocked ok; '; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.omr_scans WHERE quiz_id = qz;
  msg := msg || format('12 outsider sees scans=%s %s; ', n, CASE WHEN n = 0 THEN 'ok' ELSE 'BAD' END);
  BEGIN
    INSERT INTO public.omr_scans (quiz_id, class_id, source, image_path, created_by) VALUES (qz, cls, 'mobile_camera', 'x.jpg', outsider);
    msg := msg || '13 outsider upload ALLOWED BAD';
  EXCEPTION WHEN others THEN msg := msg || '13 outsider upload blocked ok'; END;

  RAISE EXCEPTION 'RESULT: %', msg;
END $$;
