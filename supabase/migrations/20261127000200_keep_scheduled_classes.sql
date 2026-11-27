-- A class that is on the official schedule must exist, so the mobile app (which lists classes) and the
-- website (which reads the schedule) always show the same classes.

-- 1) Repair: re-create any class whose schedule still exists but whose class was deleted
--    (the section's students are enrolled again automatically).
SELECT public.ensure_schedule_class(s.subject_id, s.section_id, s.instructor_id)
FROM (SELECT DISTINCT subject_id, section_id, instructor_id FROM public.instructor_schedules) s;

-- 2) Prevent: a scheduled class can't be deleted; remove its schedule first (admin website → Schedules).
CREATE OR REPLACE FUNCTION public.classes_keep_scheduled()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.subject_id IS NOT NULL AND OLD.section_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.instructor_schedules s
    WHERE s.subject_id = OLD.subject_id AND s.section_id = OLD.section_id AND s.instructor_id = OLD.instructor_id
  ) THEN
    RAISE EXCEPTION 'This class is on the official schedule (% · %). Ask the administrator to remove its schedule first.', OLD.code, OLD.section;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.classes_keep_scheduled() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS classes_keep_scheduled ON public.classes;
CREATE TRIGGER classes_keep_scheduled BEFORE DELETE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.classes_keep_scheduled();
