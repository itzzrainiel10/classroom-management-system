-- start_semester: the settings UPDATE needs a WHERE clause (Supabase blocks UPDATE without one).

CREATE OR REPLACE FUNCTION public.start_semester(_semester text, _academic_year text, _starts_on date, _ends_on date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _id uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only administrators can start a semester.'; END IF;
  IF trim(coalesce(_semester, '')) = '' OR trim(coalesce(_academic_year, '')) = '' THEN RAISE EXCEPTION 'Enter the semester and academic year.'; END IF;
  IF _starts_on IS NOT NULL AND _ends_on IS NOT NULL AND _ends_on <= _starts_on THEN RAISE EXCEPTION 'The end date must be after the start date.'; END IF;
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
  WHERE id = true;  -- app_settings has one row; Supabase refuses UPDATE without WHERE
  -- Classes created while no semester was active join the new one.
  UPDATE public.classes SET semester_id = _id WHERE semester_id IS NULL AND archived_at IS NULL;

  PERFORM public.log_activity('settings', 'Started semester', trim(_semester) || ', AY ' || trim(_academic_year), 'Active', auth.uid());
  RETURN _id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.start_semester(text, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_semester(text, text, date, date) TO authenticated;
