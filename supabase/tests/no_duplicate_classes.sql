-- Dry-run check: classes can't be duplicated. Always ends with "RESULT: ..." and undoes everything.
DO $$
DECLARE
  inst uuid := gen_random_uuid();
  sub uuid := gen_random_uuid();
  sec uuid := gen_random_uuid();
  room uuid := gen_random_uuid();
  n int; msg text := ''; ok boolean;
  term record;
BEGIN
  SELECT current_semester AS sem, current_academic_year AS ay INTO term FROM public.app_settings LIMIT 1;
  INSERT INTO public.subjects (id, code, name, units) VALUES (sub, 'DUP 101', 'Dup Subject', 3);
  INSERT INTO public.sections (id, name, year_level) VALUES (sec, 'DUP 1-1', 1);
  INSERT INTO public.rooms (id, name) VALUES (room, 'Dup Room');
  INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data) VALUES
    (inst, 'dup.inst@example.com', 'authenticated', 'authenticated', '{"full_name":"Dup Instructor"}');
  DELETE FROM public.user_roles WHERE user_id = inst;
  INSERT INTO public.user_roles (user_id, role) VALUES (inst, 'instructor');
  INSERT INTO public.instructor_profiles (user_id, status) VALUES (inst, 'approved')
    ON CONFLICT (user_id) DO UPDATE SET status = 'approved';

  -- 1) a class made by hand is refused (classes come from subjects)
  ok := false;
  BEGIN
    INSERT INTO public.classes (instructor_id, code, title, section) VALUES (inst, 'DUP 101', 'Dup Subject', 'DUP 1-1');
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'Classes are created from Subjects%';
  END;
  msg := msg || format('1 hand-made class refused %s; ', CASE WHEN ok THEN 'ok' ELSE 'BAD' END);

  -- 2) scheduling the subject makes exactly one class, even with two time slots
  INSERT INTO public.instructor_schedules (instructor_id, subject_id, section_id, room_id, day_of_week, start_time, end_time, semester, academic_year)
  VALUES (inst, sub, sec, room, 1, '08:00', '09:00', term.sem, term.ay), (inst, sub, sec, room, 3, '08:00', '09:00', term.sem, term.ay);
  SELECT count(*) INTO n FROM public.classes WHERE instructor_id = inst;
  msg := msg || format('2 one class per subject=%s %s; ', n, CASE WHEN n = 1 THEN 'ok' ELSE 'BAD' END);

  -- 3) a copy of that class is refused
  ok := false;
  BEGIN
    INSERT INTO public.classes (instructor_id, code, title, section, subject_id, section_id) VALUES (inst, ' dup 101 ', 'x', 'dup 1-1', sub, sec);
  EXCEPTION WHEN OTHERS THEN ok := true;
  END;
  msg := msg || format('3 duplicate refused %s; ', CASE WHEN ok THEN 'ok' ELSE 'BAD' END);

  -- 4) live data has no duplicates left
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM public.classes GROUP BY instructor_id, lower(trim(code)), lower(trim(section)) HAVING count(*) > 1) d;
  msg := msg || format('4 duplicate groups in data=%s %s; ', n, CASE WHEN n = 0 THEN 'ok' ELSE 'BAD' END);

  SELECT count(*) INTO n FROM public.classes WHERE subject_id IS NULL;
  msg := msg || format('5 classes without a subject=%s %s', n, CASE WHEN n = 0 THEN 'ok' ELSE 'BAD' END);

  RAISE EXCEPTION 'RESULT: %', msg;
END $$;
