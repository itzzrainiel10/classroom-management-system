-- Dry-run check of the quiz rules. Run in the SQL editor; it always ends with
-- "RESULT: ..." and undoes everything (nothing is saved).
-- Expected: instructor sees 3 answer keys; student sees 3 questions, 0 keys; score 2/3;
--           resubmit keeps 2/3; outsider sees 0 quizzes; outsider submit blocked
DO $$
DECLARE
  inst uuid := '00000000-0000-0000-0000-0000000000a1';
  stu uuid := '00000000-0000-0000-0000-0000000000b1';
  cls uuid := gen_random_uuid();
  qz uuid := gen_random_uuid();
  n int; keys_visible int; att public.quiz_attempts; msg text := '';
BEGIN
  -- these checks build classes directly (rolled back at the end)
  ALTER TABLE public.classes DISABLE TRIGGER classes_from_subject_only;
  INSERT INTO public.classes (id, instructor_id, code, title, section) VALUES (cls, inst, 'ITEC 116', 'Web Development', 'Dash 3');
  INSERT INTO public.class_students (class_id, email, full_name) VALUES (cls, 'Ana.Reyes@cvsu.edu.ph', 'Reyes, Ana');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', inst, 'email', 'teacher@cvsu.edu.ph', 'role', 'authenticated')::text, true);
  PERFORM public.save_quiz(json_build_object('id', qz, 'class_id', cls, 'title', 'HTML Basics', 'status', 'published', 'passing_score', 70,
    'questions', json_build_array(
      json_build_object('prompt', 'What does HTML stand for?', 'choices', json_build_array('Hyper Text Markup Language','High Text Machine Language','Hyperlink and Text Markup','Home Tool Markup Language'), 'correct_index', 0),
      json_build_object('prompt', 'Tag for a link?', 'choices', json_build_array('<p>','<a>','<h1>'), 'correct_index', 1),
      json_build_object('prompt', 'Tag for a paragraph?', 'choices', json_build_array('<p>','<a>'), 'correct_index', 0)))::jsonb);
  SELECT count(*) INTO n FROM public.quiz_answer_keys WHERE quiz_id = qz;
  msg := msg || format('instructor sees %s answer keys; ', n);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'email', 'ana.reyes@cvsu.edu.ph', 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.quiz_questions WHERE quiz_id = qz;
  SELECT count(*) INTO keys_visible FROM public.quiz_answer_keys WHERE quiz_id = qz;
  msg := msg || format('student sees %s questions, %s keys; ', n, keys_visible);
  att := public.submit_quiz(qz, ARRAY[0, 1, 1], now() - interval '5 minutes');
  msg := msg || format('score %s/%s; ', att.score, att.total);
  att := public.submit_quiz(qz, ARRAY[0, 0, 0], now());
  msg := msg || format('resubmit keeps %s/%s; ', att.score, att.total);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'email', 'outsider@x.com', 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.quizzes WHERE id = qz;
  msg := msg || format('outsider sees %s quizzes; ', n);
  BEGIN
    PERFORM public.submit_quiz(qz, ARRAY[0,1,0], now());
    msg := msg || 'outsider submit ALLOWED (bad)';
  EXCEPTION WHEN others THEN msg := msg || 'outsider submit blocked';
  END;

  RAISE EXCEPTION 'RESULT: %', msg;
END $$;
