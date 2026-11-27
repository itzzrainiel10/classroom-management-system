-- Semesters can't overlap: a semester must start after the previous one ended.
-- "Ended" = whichever came first: its last day, or the day the admin ended it.

CREATE OR REPLACE FUNCTION public.previous_semester_end()
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT max(LEAST(COALESCE(ends_on, (ended_at AT TIME ZONE 'Asia/Manila')::date), COALESCE((ended_at AT TIME ZONE 'Asia/Manila')::date, ends_on)))
  FROM public.semesters WHERE status = 'completed'
$$;
GRANT EXECUTE ON FUNCTION public.previous_semester_end() TO authenticated;

-- Editing the active term (Semesters → Edit) is checked too.
CREATE OR REPLACE FUNCTION public.trg_settings_check_dates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _prev date := public.previous_semester_end();
BEGIN
  IF NEW.semester_start IS NOT NULL AND NEW.semester_end IS NOT NULL AND NEW.semester_end <= NEW.semester_start THEN
    RAISE EXCEPTION 'The last day must be after the first day.';
  END IF;
  IF NEW.semester_start IS DISTINCT FROM OLD.semester_start AND NEW.semester_start IS NOT NULL AND _prev IS NOT NULL AND NEW.semester_start <= _prev THEN
    RAISE EXCEPTION 'The semester must start after the previous one ended (%). Choose % or later.', to_char(_prev, 'Mon DD, YYYY'), to_char(_prev + 1, 'Mon DD, YYYY');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trg_settings_check_dates() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS settings_check_dates ON public.app_settings;
CREATE TRIGGER settings_check_dates BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.trg_settings_check_dates();

CREATE OR REPLACE FUNCTION public.start_semester(_semester text, _academic_year text, _starts_on date, _ends_on date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _id uuid;
  _prev date := public.previous_semester_end();
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only administrators can start a semester.'; END IF;
  IF trim(coalesce(_semester, '')) = '' OR trim(coalesce(_academic_year, '')) = '' THEN RAISE EXCEPTION 'Enter the semester and academic year.'; END IF;
  IF _starts_on IS NULL OR _ends_on IS NULL THEN RAISE EXCEPTION 'Set the first and last day of the semester.'; END IF;
  IF _ends_on <= _starts_on THEN RAISE EXCEPTION 'The end date must be after the start date.'; END IF;
  IF _prev IS NOT NULL AND _starts_on <= _prev THEN
    RAISE EXCEPTION 'The semester must start after the previous one ended (%). Choose % or later.', to_char(_prev, 'Mon DD, YYYY'), to_char(_prev + 1, 'Mon DD, YYYY');
  END IF;
  IF EXISTS (SELECT 1 FROM public.semesters WHERE status = 'active') THEN
    RAISE EXCEPTION 'End the current semester before starting a new one.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.semesters WHERE semester = trim(_semester) AND academic_year = trim(_academic_year)) THEN
    RAISE EXCEPTION '% AY % already exists. Choose a different semester or academic year.', trim(_semester), trim(_academic_year);
  END IF;

  INSERT INTO public.semesters (semester, academic_year, starts_on, ends_on, status, created_by)
  VALUES (trim(_semester), trim(_academic_year), _starts_on, _ends_on, 'active', auth.uid())
  RETURNING id INTO _id;
  UPDATE public.app_settings SET current_semester = trim(_semester), current_academic_year = trim(_academic_year),
         semester_start = _starts_on, semester_end = _ends_on, updated_at = now(), updated_by = auth.uid()
  WHERE id = true;
  UPDATE public.classes SET semester_id = _id WHERE semester_id IS NULL AND archived_at IS NULL;

  PERFORM public.log_activity('settings', 'Started semester', trim(_semester) || ', AY ' || trim(_academic_year), 'Active', auth.uid());
  RETURN _id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.start_semester(text, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_semester(text, text, date, date) TO authenticated;

-- Fix the current overlap: the active semester starts the day after the previous one ended.
UPDATE public.app_settings
SET semester_start = public.previous_semester_end() + 1, updated_at = now()
WHERE id = true AND EXISTS (SELECT 1 FROM public.semesters WHERE status = 'active')
  AND public.previous_semester_end() IS NOT NULL AND semester_start <= public.previous_semester_end()
  AND (semester_end IS NULL OR semester_end > public.previous_semester_end() + 1);
UPDATE public.semesters s
SET starts_on = a.semester_start
FROM public.app_settings a
WHERE s.status = 'active' AND s.starts_on IS DISTINCT FROM a.semester_start;
