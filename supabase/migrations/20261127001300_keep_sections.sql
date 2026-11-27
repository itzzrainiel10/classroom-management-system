-- Ending a semester keeps rooms, subjects AND sections for the next semester.
-- Still removed: the ended semester's schedules (archived). Students still renew by choosing a section.

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

  -- 5) Fresh start: subjects, sections, rooms and every account carry over.
  --    The ended semester's schedules are removed (the archive keeps a copy), and every student renews
  --    by choosing their section again for the next semester.
  DELETE FROM public.instructor_schedules WHERE semester = _sem.semester AND academic_year = _sem.academic_year;
  GET DIAGNOSTICS _schedules_removed = ROW_COUNT;

  SELECT count(*) INTO _students_renew FROM public.profiles WHERE section_id IS NOT NULL;
  UPDATE public.profiles SET section_id = NULL WHERE section_id IS NOT NULL;

  _sections_removed := 0;  -- sections stay for the next semester

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
