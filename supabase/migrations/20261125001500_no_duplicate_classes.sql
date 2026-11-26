-- No duplicate classes: one class per (instructor, subject code, section).
-- 1) A schedule re-uses an existing class with the same code + section + instructor (even one made by hand)
--    instead of creating a second one.
-- 2) Creating a class that already exists (by hand, admin or instructor) is refused with a clear message.
-- 3) Existing duplicates that are completely empty are removed (never one with students or work in it).

CREATE OR REPLACE FUNCTION public.ensure_schedule_class(_subject uuid, _section uuid, _instructor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cls uuid;
  _sub public.subjects;
  _sec public.sections;
BEGIN
  SELECT * INTO _sub FROM public.subjects WHERE id = _subject;
  SELECT * INTO _sec FROM public.sections WHERE id = _section;
  IF _sub.id IS NULL OR _sec.id IS NULL OR _instructor IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO _cls FROM public.classes WHERE subject_id = _subject AND section_id = _section AND instructor_id = _instructor;
  IF _cls IS NULL THEN
    -- Same class made by hand earlier? Link it instead of creating a duplicate.
    SELECT id INTO _cls FROM public.classes
    WHERE instructor_id = _instructor AND lower(trim(code)) = lower(trim(_sub.code)) AND lower(trim(section)) = lower(trim(_sec.name))
    ORDER BY created_at LIMIT 1;
    IF _cls IS NOT NULL THEN
      UPDATE public.classes SET subject_id = _subject, section_id = _section, title = _sub.name WHERE id = _cls;
    ELSE
      INSERT INTO public.classes (instructor_id, code, title, section, description, subject_id, section_id)
      VALUES (_instructor, _sub.code, _sub.name, _sec.name, COALESCE(_sub.description, ''), _subject, _section)
      RETURNING id INTO _cls;
    END IF;
  END IF;

  INSERT INTO public.class_students (class_id, email, full_name, auto)
  SELECT _cls, lower(p.email), p.full_name, true
  FROM public.profiles p
  WHERE p.section_id = _section AND p.email <> '' AND public.has_role(p.id, 'student')
  ON CONFLICT (class_id, email) DO NOTHING;
  RETURN _cls;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ensure_schedule_class(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

/* 3) Remove existing empty duplicates (keep the scheduled one, else the oldest). */
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.id FROM public.classes c
    WHERE EXISTS (
      SELECT 1 FROM public.classes k
      WHERE k.id <> c.id AND k.instructor_id = c.instructor_id
        AND lower(trim(k.code)) = lower(trim(c.code)) AND lower(trim(k.section)) = lower(trim(c.section))
        AND (k.subject_id IS NOT NULL OR (c.subject_id IS NULL AND k.created_at < c.created_at))
    )
    AND c.subject_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.class_students x WHERE x.class_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.quizzes x WHERE x.class_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.assignments x WHERE x.class_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.announcements x WHERE x.class_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.class_schedules x WHERE x.class_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.attendance_sessions x WHERE x.class_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.omr_sheets x WHERE x.class_id = c.id)
  LOOP
    DELETE FROM public.classes WHERE id = r.id;
  END LOOP;
END $$;

/* 2) Refuse new duplicates. */
CREATE OR REPLACE FUNCTION public.classes_no_duplicate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.classes c
    WHERE c.id <> NEW.id AND c.instructor_id = NEW.instructor_id
      AND lower(trim(c.code)) = lower(trim(NEW.code)) AND lower(trim(c.section)) = lower(trim(NEW.section))
  ) THEN
    RAISE EXCEPTION 'This class already exists: % · % for this instructor. Open the existing class instead.', NEW.code, NEW.section;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS classes_no_duplicate ON public.classes;
CREATE TRIGGER classes_no_duplicate BEFORE INSERT OR UPDATE OF code, section, instructor_id ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.classes_no_duplicate();
