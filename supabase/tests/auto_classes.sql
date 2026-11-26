-- Dry-run check: schedules create classes automatically and section students follow.
-- Creates temporary accounts / data, always ends with "RESULT: ..." and undoes everything.
DO $$
DECLARE
  inst uuid := gen_random_uuid();
  inst2 uuid := gen_random_uuid();
  stu1 uuid := gen_random_uuid();
  stu2 uuid := gen_random_uuid();
  sub uuid := gen_random_uuid();
  secA uuid := gen_random_uuid();
  secB uuid := gen_random_uuid();
  room uuid := gen_random_uuid();
  cls uuid;
  n int; s text; msg text := '';
  term record;
BEGIN
  SELECT current_semester AS sem, current_academic_year AS ay INTO term FROM public.app_settings LIMIT 1;
  INSERT INTO public.subjects (id, code, name, units) VALUES (sub, 'TST 101', 'Test Subject', 3);
  INSERT INTO public.sections (id, name, year_level) VALUES (secA, 'TEST 1-A', 1), (secB, 'TEST 1-B', 1);
  INSERT INTO public.rooms (id, name) VALUES (room, 'Test Room 1');

  -- two approved instructors, one student already in section A
  INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data) VALUES
    (inst, 'test.inst@example.com', 'authenticated', 'authenticated', '{"full_name":"Test Instructor"}'),
    (inst2, 'test.inst2@example.com', 'authenticated', 'authenticated', '{"full_name":"Test Instructor Two"}'),
    (stu1, 'test.stu1@example.com', 'authenticated', 'authenticated', jsonb_build_object('full_name', 'Student One', 'role', 'student', 'section_id', secA));
  DELETE FROM public.user_roles WHERE user_id IN (inst, inst2);
  INSERT INTO public.user_roles (user_id, role) VALUES (inst, 'instructor'), (inst2, 'instructor');
  INSERT INTO public.instructor_profiles (user_id, status) VALUES (inst, 'approved'), (inst2, 'approved')
    ON CONFLICT (user_id) DO UPDATE SET status = 'approved';
  PERFORM set_config('cms.section_pick', 'on', true);
  UPDATE public.profiles SET section_id = secA WHERE id = stu1;

  -- 1) scheduling creates the class + enrolls section A
  INSERT INTO public.instructor_schedules (instructor_id, subject_id, section_id, room_id, day_of_week, start_time, end_time, semester, academic_year)
  VALUES (inst, sub, secA, room, 1, '08:00', '09:00', term.sem, term.ay);
  SELECT id INTO cls FROM public.classes WHERE subject_id = sub AND section_id = secA AND instructor_id = inst;
  msg := msg || format('1 class auto-created %s; ', CASE WHEN cls IS NOT NULL THEN 'ok' ELSE 'BAD' END);
  SELECT code || ' / ' || title || ' / ' || section INTO s FROM public.classes WHERE id = cls;
  msg := msg || format('2 class name "%s" %s; ', s, CASE WHEN s = 'TST 101 / Test Subject / TEST 1-A' THEN 'ok' ELSE 'BAD' END);
  SELECT count(*) INTO n FROM public.class_students WHERE class_id = cls AND email = 'test.stu1@example.com';
  msg := msg || format('3 section student enrolled=%s %s; ', n, CASE WHEN n = 1 THEN 'ok' ELSE 'BAD' END);

  -- 2) another time slot for the same subject/section/instructor: no duplicate class
  INSERT INTO public.instructor_schedules (instructor_id, subject_id, section_id, room_id, day_of_week, start_time, end_time, semester, academic_year)
  VALUES (inst, sub, secA, room, 3, '08:00', '09:00', term.sem, term.ay);
  SELECT count(*) INTO n FROM public.classes WHERE subject_id = sub AND section_id = secA;
  msg := msg || format('4 still one class=%s %s; ', n, CASE WHEN n = 1 THEN 'ok' ELSE 'BAD' END);

  -- 3) a different instructor teaching the same subject to section B gets their own class
  INSERT INTO public.instructor_schedules (instructor_id, subject_id, section_id, room_id, day_of_week, start_time, end_time, semester, academic_year)
  VALUES (inst2, sub, secB, room, 2, '10:00', '11:00', term.sem, term.ay);
  SELECT count(*) INTO n FROM public.classes WHERE subject_id = sub;
  msg := msg || format('5 per-instructor classes=%s %s; ', n, CASE WHEN n = 2 THEN 'ok' ELSE 'BAD' END);

  -- 4) a new student signing up in section A joins automatically
  INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data) VALUES
    (stu2, 'test.stu2@example.com', 'authenticated', 'authenticated', jsonb_build_object('full_name', 'Student Two', 'role', 'student', 'section_id', secA));
  UPDATE public.profiles SET section_id = secA WHERE id = stu2 AND section_id IS NULL;
  SELECT count(*) INTO n FROM public.class_students WHERE class_id = cls AND email = 'test.stu2@example.com';
  msg := msg || format('6 new student auto-enrolled=%s %s; ', n, CASE WHEN n = 1 THEN 'ok' ELSE 'BAD' END);

  -- 5) moving a student to section B moves their classes
  UPDATE public.profiles SET section_id = secB WHERE id = stu1;
  SELECT count(*) INTO n FROM public.class_students WHERE class_id = cls AND email = 'test.stu1@example.com';
  msg := msg || format('7 left old section class=%s %s; ', n, CASE WHEN n = 0 THEN 'ok' ELSE 'BAD' END);
  SELECT count(*) INTO n FROM public.class_students cs JOIN public.classes c ON c.id = cs.class_id WHERE c.section_id = secB AND cs.email = 'test.stu1@example.com';
  msg := msg || format('8 joined new section class=%s %s; ', n, CASE WHEN n = 1 THEN 'ok' ELSE 'BAD' END);

  -- 6) renames follow
  UPDATE public.subjects SET code = 'TST 102', name = 'Renamed Subject' WHERE id = sub;
  UPDATE public.sections SET name = 'TEST 1-AA' WHERE id = secA;
  SELECT code || ' / ' || title || ' / ' || section INTO s FROM public.classes WHERE id = cls;
  msg := msg || format('9 renamed to "%s" %s', s, CASE WHEN s = 'TST 102 / Renamed Subject / TEST 1-AA' THEN 'ok' ELSE 'BAD' END);

  RAISE EXCEPTION 'RESULT: %', msg;
END $$;
