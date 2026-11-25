-- Attendance: one session per class per date; each enrolled student is Present or Absent.
-- Instructors take attendance for classes they teach (web + mobile, through save_attendance);
-- students read only their own records; administrators read everything (reports).

CREATE TABLE IF NOT EXISTS public.attendance_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  session_date date NOT NULL,
  taken_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, session_date)
);
CREATE INDEX IF NOT EXISTS attendance_sessions_class ON public.attendance_sessions (class_id, session_date DESC);

CREATE TABLE IF NOT EXISTS public.attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_email text NOT NULL,
  student_name text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('present', 'absent')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, student_email)
);
CREATE INDEX IF NOT EXISTS attendance_records_student ON public.attendance_records (student_email, class_id);

GRANT SELECT, DELETE ON public.attendance_sessions TO authenticated;
GRANT SELECT ON public.attendance_records TO authenticated;
GRANT ALL ON public.attendance_sessions, public.attendance_records TO service_role;
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

-- Reads: the class's instructor, administrators, and enrolled students (students: own records only).
CREATE POLICY "Instructors read attendance sessions" ON public.attendance_sessions FOR SELECT TO authenticated
  USING (public.is_class_instructor(class_id) OR public.is_admin() OR public.is_class_student(class_id));
CREATE POLICY "Instructors delete attendance sessions" ON public.attendance_sessions FOR DELETE TO authenticated
  USING (public.is_class_instructor(class_id));
CREATE POLICY "Read attendance records" ON public.attendance_records FOR SELECT TO authenticated
  USING (
    public.is_class_instructor(class_id) OR public.is_admin()
    OR (public.is_class_student(class_id) AND student_email = public.current_email())
  );

-- Save one class's attendance for one date (creates or replaces it). Instructor of the class only;
-- every email must be on the class roster. _records: [{"email": "...", "status": "present"|"absent"}]
CREATE OR REPLACE FUNCTION public.save_attendance(_class_id uuid, _date date, _records jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _session uuid;
  _r jsonb;
  _email text;
  _status text;
  _name text;
  _present integer := 0;
  _total integer := 0;
BEGIN
  IF NOT public.is_class_instructor(_class_id) THEN RAISE EXCEPTION 'Only the class instructor can take attendance'; END IF;
  IF _date IS NULL OR _date > (now() AT TIME ZONE 'Asia/Manila')::date + 1 THEN RAISE EXCEPTION 'Choose a date that is not in the future'; END IF;
  IF jsonb_typeof(_records) <> 'array' OR jsonb_array_length(_records) = 0 THEN RAISE EXCEPTION 'Mark at least one student'; END IF;

  INSERT INTO public.attendance_sessions (class_id, session_date, taken_by)
  VALUES (_class_id, _date, auth.uid())
  ON CONFLICT (class_id, session_date) DO UPDATE SET taken_by = auth.uid(), updated_at = now()
  RETURNING id INTO _session;

  FOR _r IN SELECT * FROM jsonb_array_elements(_records) LOOP
    _email := lower(trim(COALESCE(_r->>'email', '')));
    _status := _r->>'status';
    IF _status NOT IN ('present', 'absent') THEN RAISE EXCEPTION 'Status must be present or absent'; END IF;
    SELECT full_name INTO _name FROM public.class_students WHERE class_id = _class_id AND lower(email) = _email;
    IF NOT FOUND THEN RAISE EXCEPTION '% is not enrolled in this class', _email; END IF;
    INSERT INTO public.attendance_records (session_id, class_id, student_email, student_name, status)
    VALUES (_session, _class_id, _email, COALESCE(_name, ''), _status)
    ON CONFLICT (session_id, student_email) DO UPDATE SET status = EXCLUDED.status, student_name = EXCLUDED.student_name, updated_at = now();
    _total := _total + 1;
    IF _status = 'present' THEN _present := _present + 1; END IF;
  END LOOP;

  PERFORM public.log_activity('attendance', 'Attendance taken',
    COALESCE(public.class_label(_class_id), '') || ' · ' || to_char(_date, 'Mon DD') || ' · ' || _present || '/' || _total || ' present');
  RETURN _session;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.save_attendance(uuid, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_attendance(uuid, date, jsonb) TO authenticated;
