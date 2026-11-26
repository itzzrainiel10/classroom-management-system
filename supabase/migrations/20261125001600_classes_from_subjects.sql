-- As many classes as subjects: a class only exists because a Subject was scheduled for a Section with an
-- Instructor (ensure_schedule_class). Creating a class by hand is refused, and existing hand-made
-- classes that are completely empty are removed (never one with students or work in it).

CREATE OR REPLACE FUNCTION public.classes_from_subject_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.subject_id IS NULL OR NEW.section_id IS NULL THEN
    RAISE EXCEPTION 'Classes are created from Subjects. Add a Schedule for the subject, section and instructor and its class is made automatically.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS classes_from_subject_only ON public.classes;
CREATE TRIGGER classes_from_subject_only BEFORE INSERT ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.classes_from_subject_only();

DELETE FROM public.classes c
WHERE c.subject_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.class_students x WHERE x.class_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM public.quizzes x WHERE x.class_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM public.assignments x WHERE x.class_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM public.announcements x WHERE x.class_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM public.class_schedules x WHERE x.class_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM public.attendance_sessions x WHERE x.class_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM public.omr_sheets x WHERE x.class_id = c.id);
