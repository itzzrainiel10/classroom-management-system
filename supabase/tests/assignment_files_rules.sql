-- Dry-run check of who may upload / download assignment files. Uses real accounts on a temporary class,
-- always ends with "RESULT: ..." and undoes everything (nothing is saved). Every item should end in "ok".
DO $$
DECLARE
  inst uuid := (SELECT r.user_id FROM public.user_roles r JOIN public.instructor_profiles ip ON ip.user_id = r.user_id
                WHERE r.role::text = 'instructor' AND ip.status = 'approved' ORDER BY r.user_id LIMIT 1);
  stu uuid := (SELECT user_id FROM public.user_roles WHERE role::text = 'student' LIMIT 1);
  adm uuid := (SELECT user_id FROM public.user_roles WHERE role::text = 'admin' LIMIT 1);
  outsider uuid := gen_random_uuid();
  stu_email text;
  cls uuid := gen_random_uuid();
  obj text;
  n int; msg text := '';
BEGIN
  IF inst IS NULL OR stu IS NULL OR adm IS NULL THEN RAISE EXCEPTION 'RESULT: missing test accounts'; END IF;
  SELECT email INTO stu_email FROM public.profiles WHERE id = stu;
  obj := cls::text || '/' || gen_random_uuid()::text || '/handout.pdf';
  INSERT INTO public.classes (id, instructor_id, code, title, section) VALUES (cls, inst, 'TEST 101', 'Files test', 'TEST 1-1');
  INSERT INTO public.class_students (class_id, email, full_name) VALUES (cls, stu_email, 'Test Student');
  PERFORM set_config('role', 'authenticated', true);

  /* class instructor uploads */
  PERFORM set_config('request.jwt.claims', json_build_object('sub', inst, 'role', 'authenticated')::text, true);
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('assignment-files', obj, inst);
    msg := msg || '1 instructor uploads ok; ';
  EXCEPTION WHEN others THEN msg := msg || '1 instructor upload BLOCKED BAD (' || SQLERRM || '); '; END;
  UPDATE public.assignments SET attachments = '[]'::jsonb WHERE false; -- column exists check
  msg := msg || '2 attachments column ok; ';

  /* enrolled student downloads but cannot upload */
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'email', stu_email, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'assignment-files' AND name = obj;
  msg := msg || format('3 enrolled student sees file=%s %s; ', n, CASE WHEN n = 1 THEN 'ok' ELSE 'BAD' END);
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('assignment-files', cls::text || '/x/student.pdf', stu);
    msg := msg || '4 student upload ALLOWED BAD; ';
  EXCEPTION WHEN others THEN msg := msg || '4 student upload blocked ok; '; END;

  /* someone outside the class */
  PERFORM set_config('request.jwt.claims', json_build_object('sub', outsider, 'email', 'outsider@example.com', 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'assignment-files' AND name = obj;
  msg := msg || format('5 outsider sees file=%s %s; ', n, CASE WHEN n = 0 THEN 'ok' ELSE 'BAD' END);
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('assignment-files', cls::text || '/x/hack.pdf', outsider);
    msg := msg || '6 outsider upload ALLOWED BAD; ';
  EXCEPTION WHEN others THEN msg := msg || '6 outsider upload blocked ok; '; END;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('assignment-files', 'not-a-class/x/hack.pdf', outsider);
    msg := msg || '7 bad path ALLOWED BAD; ';
  EXCEPTION WHEN others THEN msg := msg || '7 bad path blocked ok; '; END;

  /* administrator */
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'assignment-files' AND name = obj;
  msg := msg || format('8 admin sees file=%s %s', n, CASE WHEN n = 1 THEN 'ok' ELSE 'BAD' END);

  RAISE EXCEPTION 'RESULT: %', msg;
END $$;
