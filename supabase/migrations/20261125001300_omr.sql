-- OMR (paper answer sheets) — one pipeline for flatbed-scanner uploads (Instructor website) and phone
-- camera photos (mobile app). Both upload an image to the private "omr-scans" bucket and call the
-- "omr-process" Edge Function, which reads the sheet and fills in omr_scans. The instructor reviews,
-- resolves unclear answers, and finalizes; finalizing scores with the same score_response() used by
-- phone quizzes and creates a normal quiz_attempt, so results show up everywhere.

/* ---------- Printed sheets: one per student per exam (its id is in the sheet's QR code) ---------- */
CREATE TABLE IF NOT EXISTS public.omr_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_email text NOT NULL,
  student_name text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quiz_id, student_email)
);

/* ---------- Scans: every uploaded image / photo ---------- */
CREATE TABLE IF NOT EXISTS public.omr_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  sheet_id uuid REFERENCES public.omr_sheets(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('physical_scanner', 'mobile_camera')),
  original_name text NOT NULL DEFAULT '',
  image_path text NOT NULL,
  processed_path text,
  status text NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'processing', 'failed', 'needs_review', 'ready', 'finalized', 'duplicate')),
  message text NOT NULL DEFAULT '',
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- per question: {choice, status: answered|blank|multiple|uncertain, confidence, fills[]}
  detected jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- per question after review: chosen index, -1 = left blank, null = still unresolved
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric,
  score integer,
  total integer,
  attempt_id uuid REFERENCES public.quiz_attempts(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  reviewed_at timestamptz,
  finalized_at timestamptz,
  finalized_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS omr_scans_quiz ON public.omr_scans (quiz_id, created_at DESC);
CREATE INDEX IF NOT EXISTS omr_scans_sheet ON public.omr_scans (sheet_id);
-- A sheet can be graded only once.
CREATE UNIQUE INDEX IF NOT EXISTS omr_scans_one_final ON public.omr_scans (sheet_id) WHERE status = 'finalized';

GRANT SELECT ON public.omr_sheets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.omr_scans TO authenticated;
GRANT ALL ON public.omr_sheets, public.omr_scans TO service_role;
ALTER TABLE public.omr_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omr_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Instructors and admins read sheets" ON public.omr_sheets FOR SELECT TO authenticated
  USING (public.is_class_instructor(class_id) OR public.is_admin());
CREATE POLICY "Instructors and admins read scans" ON public.omr_scans FOR SELECT TO authenticated
  USING (public.is_class_instructor(class_id) OR public.is_admin());
CREATE POLICY "Instructors add scans" ON public.omr_scans FOR INSERT TO authenticated
  WITH CHECK (public.is_class_instructor(class_id) AND created_by = auth.uid()
              AND EXISTS (SELECT 1 FROM public.quizzes q WHERE q.id = quiz_id AND q.class_id = omr_scans.class_id));
CREATE POLICY "Instructors update scans" ON public.omr_scans FOR UPDATE TO authenticated
  USING (public.is_class_instructor(class_id)) WITH CHECK (public.is_class_instructor(class_id));
CREATE POLICY "Instructors delete unfinalized scans" ON public.omr_scans FOR DELETE TO authenticated
  USING (public.is_class_instructor(class_id) AND status <> 'finalized');

-- Finalized scans are locked, and only omr_finalize() may mark a scan finalized.
CREATE OR REPLACE FUNCTION public.omr_scans_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_setting('cms.omr_finalize', true) = 'on' THEN RETURN NEW; END IF;
  IF OLD.status = 'finalized' THEN RAISE EXCEPTION 'This answer sheet is already finalized'; END IF;
  IF NEW.status = 'finalized' THEN RAISE EXCEPTION 'Use Finalize to grade an answer sheet'; END IF;
  NEW.quiz_id := OLD.quiz_id;
  NEW.class_id := OLD.class_id;
  NEW.created_by := OLD.created_by;
  NEW.attempt_id := OLD.attempt_id;
  NEW.score := NULL;
  NEW.total := NULL;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS omr_scans_guard ON public.omr_scans;
CREATE TRIGGER omr_scans_guard BEFORE UPDATE ON public.omr_scans FOR EACH ROW EXECUTE FUNCTION public.omr_scans_guard();

/* ---------- Private image storage: <class_id>/<quiz_id>/<scan_id>[.processed].jpg ---------- */
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('omr-scans', 'omr-scans', false, 15728640, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Instructors upload OMR scans" ON storage.objects;
CREATE POLICY "Instructors upload OMR scans" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'omr-scans' AND public.is_class_instructor(public.assignment_file_class(name)));
DROP POLICY IF EXISTS "Instructors replace OMR scans" ON storage.objects;
CREATE POLICY "Instructors replace OMR scans" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'omr-scans' AND public.is_class_instructor(public.assignment_file_class(name)));
DROP POLICY IF EXISTS "Instructors delete OMR scans" ON storage.objects;
CREATE POLICY "Instructors delete OMR scans" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'omr-scans' AND public.is_class_instructor(public.assignment_file_class(name)));
DROP POLICY IF EXISTS "Instructors and admins read OMR scans" ON storage.objects;
CREATE POLICY "Instructors and admins read OMR scans" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'omr-scans' AND (public.is_class_instructor(public.assignment_file_class(name)) OR public.is_admin()));

/* ---------- Which exams can go on paper ---------- */
-- Multiple choice (2–5 options) and True/False only; at most 50 questions (the sheet's bubble grid).
CREATE OR REPLACE FUNCTION public.omr_layout(_quiz_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _out jsonb := '[]'::jsonb;
  _q record;
BEGIN
  IF NOT public.can_manage_quiz(_quiz_id) AND NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  FOR _q IN SELECT position, type, cardinality(choices) AS n FROM public.quiz_questions WHERE quiz_id = _quiz_id ORDER BY position LOOP
    IF _q.type NOT IN ('multiple_choice', 'true_false') THEN
      RAISE EXCEPTION 'Question % is %. Paper answer sheets support multiple choice and True/False only.', _q.position, replace(_q.type, '_', ' ');
    END IF;
    IF _q.type = 'multiple_choice' AND (_q.n < 2 OR _q.n > 5) THEN
      RAISE EXCEPTION 'Question % has % choices. Paper answer sheets support 2 to 5 choices (A–E).', _q.position, _q.n;
    END IF;
    _out := _out || jsonb_build_object('position', _q.position, 'type', _q.type, 'choices', CASE WHEN _q.type = 'true_false' THEN 2 ELSE _q.n END);
  END LOOP;
  IF jsonb_array_length(_out) = 0 THEN RAISE EXCEPTION 'This exam has no questions yet'; END IF;
  IF jsonb_array_length(_out) > 50 THEN RAISE EXCEPTION 'Paper answer sheets hold at most 50 questions (this exam has %).', jsonb_array_length(_out); END IF;
  RETURN _out;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.omr_layout(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omr_layout(uuid) TO authenticated;

-- Create (or keep) one printed sheet per enrolled student; returns all sheets of the exam.
CREATE OR REPLACE FUNCTION public.prepare_omr_sheets(_quiz_id uuid)
RETURNS SETOF public.omr_sheets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _class uuid;
BEGIN
  IF NOT public.can_manage_quiz(_quiz_id) THEN RAISE EXCEPTION 'Only the class instructor can print answer sheets'; END IF;
  PERFORM public.omr_layout(_quiz_id); -- validates the exam
  SELECT class_id INTO _class FROM public.quizzes WHERE id = _quiz_id;
  INSERT INTO public.omr_sheets (quiz_id, class_id, student_email, student_name, created_by)
  SELECT _quiz_id, _class, lower(s.email), s.full_name, auth.uid() FROM public.class_students s WHERE s.class_id = _class
  ON CONFLICT (quiz_id, student_email) DO UPDATE SET student_name = EXCLUDED.student_name;
  RETURN QUERY SELECT * FROM public.omr_sheets WHERE quiz_id = _quiz_id ORDER BY student_name, student_email;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.prepare_omr_sheets(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_omr_sheets(uuid) TO authenticated;

/* ---------- Review: save the instructor's corrections ---------- */
-- _answers: one entry per question — choice index, -1 for blank, null for unresolved.
CREATE OR REPLACE FUNCTION public.omr_save_review(_scan_id uuid, _answers jsonb, _sheet_id uuid DEFAULT NULL)
RETURNS public.omr_scans LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _s public.omr_scans;
  _layout jsonb;
  _i integer;
  _v jsonb;
  _unresolved boolean := false;
BEGIN
  SELECT * INTO _s FROM public.omr_scans WHERE id = _scan_id;
  IF NOT FOUND OR NOT public.is_class_instructor(_s.class_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _s.status IN ('finalized', 'failed', 'uploaded', 'processing') THEN RAISE EXCEPTION 'This scan cannot be reviewed now (status: %)', _s.status; END IF;
  _layout := public.omr_layout(_s.quiz_id);
  IF jsonb_typeof(_answers) <> 'array' OR jsonb_array_length(_answers) <> jsonb_array_length(_layout) THEN
    RAISE EXCEPTION 'Give one answer per question (% questions)', jsonb_array_length(_layout);
  END IF;
  FOR _i IN 0 .. jsonb_array_length(_answers) - 1 LOOP
    _v := _answers->_i;
    IF _v = 'null'::jsonb THEN _unresolved := true; CONTINUE; END IF;
    IF jsonb_typeof(_v) <> 'number' OR (_v::text)::int < -1 OR (_v::text)::int >= (_layout->_i->>'choices')::int THEN
      RAISE EXCEPTION 'Question %: invalid answer', _i + 1;
    END IF;
  END LOOP;
  IF _sheet_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.omr_sheets WHERE id = _sheet_id AND quiz_id = _s.quiz_id) THEN
    RAISE EXCEPTION 'That student sheet does not belong to this exam';
  END IF;
  UPDATE public.omr_scans
  SET answers = _answers,
      sheet_id = COALESCE(_sheet_id, sheet_id),
      status = CASE WHEN _unresolved OR COALESCE(_sheet_id, sheet_id) IS NULL THEN 'needs_review' ELSE 'ready' END,
      reviewed_at = now()
  WHERE id = _scan_id
  RETURNING * INTO _s;
  RETURN _s;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.omr_save_review(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omr_save_review(uuid, jsonb, uuid) TO authenticated;

/* ---------- Finalize: grade with the shared scoring and create the student's attempt ---------- */
CREATE OR REPLACE FUNCTION public.omr_finalize(_scan_id uuid)
RETURNS public.omr_scans LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _s public.omr_scans;
  _sheet public.omr_sheets;
  _student uuid;
  _layout jsonb;
  _q record;
  _a jsonb;
  _r jsonb;
  _res jsonb;
  _responses jsonb := '[]'::jsonb;
  _scores jsonb := '[]'::jsonb;
  _legacy integer[] := '{}';
  _score integer := 0;
  _total integer := 0;
  _attempt uuid;
  _i integer := 0;
BEGIN
  SELECT * INTO _s FROM public.omr_scans WHERE id = _scan_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_class_instructor(_s.class_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _s.status = 'finalized' THEN RAISE EXCEPTION 'This answer sheet is already finalized'; END IF;
  IF _s.status <> 'ready' THEN RAISE EXCEPTION 'Resolve every unclear answer and choose the student before finalizing'; END IF;
  SELECT * INTO _sheet FROM public.omr_sheets WHERE id = _s.sheet_id AND quiz_id = _s.quiz_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose which student this answer sheet belongs to'; END IF;
  IF EXISTS (SELECT 1 FROM public.omr_scans WHERE sheet_id = _sheet.id AND status = 'finalized') THEN
    RAISE EXCEPTION 'Duplicate: % already has a finalized answer sheet for this exam', COALESCE(NULLIF(_sheet.student_name, ''), _sheet.student_email);
  END IF;
  SELECT id INTO _student FROM public.profiles WHERE lower(email) = lower(_sheet.student_email);
  IF _student IS NULL THEN RAISE EXCEPTION '% has no CvSU CMS account yet, so the score cannot be recorded. Ask the student to sign up first.', _sheet.student_email; END IF;
  IF EXISTS (SELECT 1 FROM public.quiz_attempts WHERE quiz_id = _s.quiz_id AND student_id = _student) THEN
    RAISE EXCEPTION 'Duplicate: % already has a score for this exam', COALESCE(NULLIF(_sheet.student_name, ''), _sheet.student_email);
  END IF;
  _layout := public.omr_layout(_s.quiz_id);
  IF jsonb_array_length(_s.answers) <> jsonb_array_length(_layout) THEN RAISE EXCEPTION 'Review the answers again before finalizing'; END IF;

  FOR _q IN
    SELECT q.id, q.position, q.type, q.points, k.correct_index, k.answer
    FROM public.quiz_questions q JOIN public.quiz_answer_keys k ON k.question_id = q.id
    WHERE q.quiz_id = _s.quiz_id ORDER BY q.position
  LOOP
    _a := _s.answers->_i;
    IF _a IS NULL OR _a = 'null'::jsonb THEN RAISE EXCEPTION 'Question % is still unresolved', _i + 1; END IF;
    IF (_a::text)::int < 0 THEN
      _r := '{}'::jsonb; -- left blank
    ELSIF _q.type = 'true_false' THEN
      _r := jsonb_build_object('value', (_a::text)::int = 0); -- bubble A = True, B = False
    ELSE
      _r := jsonb_build_object('choice', (_a::text)::int);
    END IF;
    _res := public.score_response(_q.type, _q.points, _q.correct_index, _q.answer, _r);
    _responses := _responses || jsonb_build_array(_r);
    _scores := _scores || jsonb_build_object('question_id', _q.id, 'points', _res->'points', 'max', _res->'max', 'pending', _res->'pending');
    _score := _score + (_res->>'points')::int;
    _total := _total + (_res->>'max')::int;
    _legacy := _legacy || CASE WHEN _q.type = 'multiple_choice' AND (_a::text)::int >= 0 THEN (_a::text)::int ELSE -1 END;
    _i := _i + 1;
  END LOOP;

  INSERT INTO public.quiz_attempts (quiz_id, student_id, student_name, student_email, answers, responses, item_scores, needs_grading, score, total, started_at, submitted_at)
  VALUES (_s.quiz_id, _student, _sheet.student_name, lower(_sheet.student_email), _legacy, _responses, _scores, false, _score, _total, NULL, now())
  RETURNING id INTO _attempt;

  PERFORM set_config('cms.omr_finalize', 'on', true);
  UPDATE public.omr_scans
  SET status = 'finalized', score = _score, total = _total, attempt_id = _attempt, finalized_at = now(), finalized_by = auth.uid(), message = ''
  WHERE id = _scan_id
  RETURNING * INTO _s;
  -- Other unfinished scans of the same sheet are now duplicates.
  UPDATE public.omr_scans SET status = 'duplicate', message = 'This sheet was already graded from another scan.'
  WHERE sheet_id = _sheet.id AND id <> _scan_id AND status NOT IN ('finalized', 'duplicate');
  PERFORM set_config('cms.omr_finalize', 'off', true);

  PERFORM public.log_activity('assessment', 'Paper answer sheet graded',
    COALESCE(NULLIF(_sheet.student_name, ''), _sheet.student_email) || ' · ' || _score || '/' || _total || ' · ' ||
    CASE _s.source WHEN 'mobile_camera' THEN 'phone camera' ELSE 'scanner' END);
  RETURN _s;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.omr_finalize(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omr_finalize(uuid) TO authenticated;
