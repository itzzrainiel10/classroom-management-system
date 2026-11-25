-- 1) Assessment review removed: published quizzes/exams go straight to enrolled students again.
-- 2) Quiz or Exam, and question types: multiple choice, true or false, modified true or false,
--    identification, enumeration and essay (graded by the instructor). Scoring stays on the server;
--    answer keys are never readable by students.

/* ---------- 1. Remove assessment review ---------- */

DROP TRIGGER IF EXISTS quizzes_review_guard ON public.quizzes;
DROP TRIGGER IF EXISTS log_quiz_review ON public.quizzes;
DROP FUNCTION IF EXISTS public.quiz_review_guard();
DROP FUNCTION IF EXISTS public.trg_log_quiz_review();
DROP FUNCTION IF EXISTS public.review_quiz(uuid, boolean, text);

DROP POLICY IF EXISTS "Read quizzes" ON public.quizzes;
ALTER TABLE public.quizzes DROP CONSTRAINT IF EXISTS quizzes_review_status_check;
ALTER TABLE public.quizzes
  DROP COLUMN IF EXISTS review_status,
  DROP COLUMN IF EXISTS review_note,
  DROP COLUMN IF EXISTS submitted_at,
  DROP COLUMN IF EXISTS reviewed_by,
  DROP COLUMN IF EXISTS reviewed_at;
CREATE POLICY "Read quizzes" ON public.quizzes FOR SELECT TO authenticated
  USING (public.is_class_instructor(class_id) OR (status = 'published' AND public.is_class_student(class_id)));

CREATE OR REPLACE FUNCTION public.can_take_quiz(_quiz_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.quizzes q WHERE q.id = _quiz_id AND q.status = 'published' AND public.is_class_student(q.class_id))
$$;

/* ---------- 2. Quiz or exam ---------- */

ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'quiz';
ALTER TABLE public.quizzes DROP CONSTRAINT IF EXISTS quizzes_kind_check;
ALTER TABLE public.quizzes ADD CONSTRAINT quizzes_kind_check CHECK (kind IN ('quiz', 'exam'));

CREATE OR REPLACE FUNCTION public.trg_log_quiz_published()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status <> 'published') THEN
    PERFORM public.log_activity('assessment', CASE WHEN NEW.kind = 'exam' THEN 'Exam published' ELSE 'Quiz published' END,
      NEW.title || ' · ' || COALESCE(public.class_label(NEW.class_id), ''), 'Published');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS log_quiz_published ON public.quizzes;
CREATE TRIGGER log_quiz_published AFTER INSERT OR UPDATE OF status ON public.quizzes FOR EACH ROW EXECUTE FUNCTION public.trg_log_quiz_published();

/* ---------- 3. Question types ---------- */

ALTER TABLE public.quiz_questions
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'multiple_choice',
  ADD COLUMN IF NOT EXISTS points integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS item_count integer NOT NULL DEFAULT 1;
ALTER TABLE public.quiz_questions DROP CONSTRAINT IF EXISTS quiz_questions_type_check;
ALTER TABLE public.quiz_questions ADD CONSTRAINT quiz_questions_type_check
  CHECK (type IN ('multiple_choice', 'true_false', 'modified_true_false', 'identification', 'enumeration', 'essay'));
ALTER TABLE public.quiz_questions DROP CONSTRAINT IF EXISTS quiz_questions_points_check;
ALTER TABLE public.quiz_questions ADD CONSTRAINT quiz_questions_points_check CHECK (points BETWEEN 1 AND 100 AND item_count BETWEEN 1 AND 50);

-- Answer key per type (never readable by students):
--   multiple_choice      correct_index
--   true_false           {"value": true|false}
--   modified_true_false  {"value": true|false, "accepted": ["word", ...]}   (accepted = correction when false)
--   identification       {"accepted": ["answer", "alternative", ...]}
--   enumeration          {"items": [["item 1", "alt"], ["item 2"], ...]}   (any order, 1 point each)
--   essay                {"guide": "what a good answer contains"}           (graded by the instructor)
ALTER TABLE public.quiz_answer_keys ALTER COLUMN correct_index DROP NOT NULL;
ALTER TABLE public.quiz_answer_keys ADD COLUMN IF NOT EXISTS answer jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Student responses, per-question scores and essay grading.
ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS responses jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS item_scores jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS needs_grading boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS graded_at timestamptz,
  ADD COLUMN IF NOT EXISTS feedback text NOT NULL DEFAULT '';

-- Older attempts (multiple choice only) get their responses filled in.
UPDATE public.quiz_attempts a
SET responses = COALESCE((SELECT jsonb_agg(jsonb_build_object('choice', x) ORDER BY i) FROM unnest(a.answers) WITH ORDINALITY u(x, i)), '[]'::jsonb)
WHERE a.responses = '[]'::jsonb AND cardinality(a.answers) > 0;

-- Case, extra spaces and surrounding punctuation don't matter when comparing typed answers.
CREATE OR REPLACE FUNCTION public.norm_answer(_t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(regexp_replace(trim(COALESCE(_t, '')), '\s+', ' ', 'g'), '^[[:punct:]]+|[[:punct:]]+$', '', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.answer_matches(_given text, _accepted jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT public.norm_answer(_given) <> '' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(_accepted, '[]'::jsonb)) a WHERE public.norm_answer(a) = public.norm_answer(_given))
$$;

-- Score one response: {"points": n, "max": m, "pending": bool}
CREATE OR REPLACE FUNCTION public.score_response(_type text, _points integer, _correct_index integer, _key jsonb, _r jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  _got integer := 0;
  _max integer := _points;
  _given jsonb;
  _used boolean[];
  _item jsonb;
  _i integer;
  _n integer;
BEGIN
  _r := COALESCE(_r, '{}'::jsonb);
  IF _type = 'multiple_choice' THEN
    IF (_r->>'choice') ~ '^-?[0-9]+$' AND (_r->>'choice')::int = _correct_index THEN _got := _points; END IF;
  ELSIF _type = 'true_false' THEN
    IF jsonb_typeof(_r->'value') = 'boolean' AND (_r->'value') = (_key->'value') THEN _got := _points; END IF;
  ELSIF _type = 'modified_true_false' THEN
    IF jsonb_typeof(_r->'value') = 'boolean' AND (_r->'value') = (_key->'value') THEN
      IF (_key->>'value')::boolean OR public.answer_matches(_r->>'correction', _key->'accepted') THEN _got := _points; END IF;
    END IF;
  ELSIF _type = 'identification' THEN
    IF public.answer_matches(_r->>'text', _key->'accepted') THEN _got := _points; END IF;
  ELSIF _type = 'enumeration' THEN
    _given := CASE WHEN jsonb_typeof(_r->'items') = 'array' THEN _r->'items' ELSE '[]'::jsonb END;
    _n := jsonb_array_length(_given);
    _used := array_fill(false, ARRAY[GREATEST(_n, 1)]);
    _max := jsonb_array_length(COALESCE(_key->'items', '[]'::jsonb));
    FOR _item IN SELECT * FROM jsonb_array_elements(COALESCE(_key->'items', '[]'::jsonb)) LOOP
      FOR _i IN 1.._n LOOP
        IF NOT _used[_i] AND public.answer_matches(_given->>(_i - 1), _item) THEN
          _used[_i] := true;
          _got := _got + 1;
          EXIT;
        END IF;
      END LOOP;
    END LOOP;
  ELSIF _type = 'essay' THEN
    RETURN jsonb_build_object('points', 0, 'max', _points, 'pending', trim(COALESCE(_r->>'text', '')) <> '');
  END IF;
  RETURN jsonb_build_object('points', _got, 'max', _max, 'pending', false);
END;
$$;

-- Instructor saves a whole quiz/exam. Question payload:
--   {type, prompt, choices, points, correct_index, answer}
CREATE OR REPLACE FUNCTION public.save_quiz(_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _id uuid := (_payload->>'id')::uuid;
  _class uuid := (_payload->>'class_id')::uuid;
  _q jsonb;
  _pos integer := 0;
  _qid uuid;
  _type text;
  _answer jsonb;
  _points integer;
  _count integer;
  _kind text := CASE WHEN _payload->>'kind' = 'exam' THEN 'exam' ELSE 'quiz' END;
BEGIN
  IF NOT public.is_class_instructor(_class) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.quizzes WHERE id = _id AND class_id <> _class) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.quiz_attempts WHERE quiz_id = _id) THEN
    -- Questions are locked once students have answered; only details and status change.
    UPDATE public.quizzes SET
      title = _payload->>'title',
      description = COALESCE(_payload->>'description', ''),
      due_at = NULLIF(_payload->>'due_at', '')::timestamptz,
      time_limit_minutes = COALESCE((_payload->>'time_limit_minutes')::int, 30),
      passing_score = COALESCE((_payload->>'passing_score')::int, 70),
      status = COALESCE(_payload->>'status', 'draft'),
      kind = _kind
    WHERE id = _id;
    RETURN _id;
  END IF;

  INSERT INTO public.quizzes (id, class_id, title, description, due_at, time_limit_minutes, passing_score, status, kind)
  VALUES (_id, _class, _payload->>'title', COALESCE(_payload->>'description', ''),
          NULLIF(_payload->>'due_at', '')::timestamptz,
          COALESCE((_payload->>'time_limit_minutes')::int, 30),
          COALESCE((_payload->>'passing_score')::int, 70),
          COALESCE(_payload->>'status', 'draft'), _kind)
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, description = EXCLUDED.description, due_at = EXCLUDED.due_at,
    time_limit_minutes = EXCLUDED.time_limit_minutes, passing_score = EXCLUDED.passing_score,
    status = EXCLUDED.status, kind = EXCLUDED.kind;

  DELETE FROM public.quiz_questions WHERE quiz_id = _id;
  FOR _q IN SELECT * FROM jsonb_array_elements(COALESCE(_payload->'questions', '[]'::jsonb)) LOOP
    _pos := _pos + 1;
    _type := COALESCE(_q->>'type', 'multiple_choice');
    _answer := COALESCE(_q->'answer', '{}'::jsonb);
    _points := GREATEST(1, LEAST(100, COALESCE((_q->>'points')::int, 1)));
    _count := 1;
    IF trim(COALESCE(_q->>'prompt', '')) = '' THEN
      RAISE EXCEPTION 'Question % has no text', _pos;
    END IF;
    IF _type = 'multiple_choice' THEN
      IF jsonb_array_length(COALESCE(_q->'choices', '[]'::jsonb)) < 2 THEN RAISE EXCEPTION 'Question %: add at least two choices', _pos; END IF;
    ELSIF _type IN ('true_false', 'modified_true_false') THEN
      IF jsonb_typeof(_answer->'value') <> 'boolean' THEN RAISE EXCEPTION 'Question %: mark it True or False', _pos; END IF;
      IF _type = 'modified_true_false' AND NOT (_answer->>'value')::boolean AND jsonb_array_length(COALESCE(_answer->'accepted', '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'Question %: give the word that makes the statement true', _pos;
      END IF;
    ELSIF _type = 'identification' THEN
      IF jsonb_array_length(COALESCE(_answer->'accepted', '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'Question %: give the correct answer', _pos; END IF;
    ELSIF _type = 'enumeration' THEN
      _count := jsonb_array_length(COALESCE(_answer->'items', '[]'::jsonb));
      IF _count = 0 THEN RAISE EXCEPTION 'Question %: list the expected items', _pos; END IF;
      _points := _count; -- one point per item
    ELSIF _type <> 'essay' THEN
      RAISE EXCEPTION 'Question %: unknown question type', _pos;
    END IF;

    INSERT INTO public.quiz_questions (quiz_id, position, prompt, choices, type, points, item_count)
    VALUES (_id, _pos, _q->>'prompt',
            CASE WHEN _type = 'multiple_choice' THEN ARRAY(SELECT jsonb_array_elements_text(_q->'choices')) ELSE '{}'::text[] END,
            _type, _points, _count)
    RETURNING id INTO _qid;
    INSERT INTO public.quiz_answer_keys (question_id, quiz_id, correct_index, answer)
    VALUES (_qid, _id, CASE WHEN _type = 'multiple_choice' THEN COALESCE((_q->>'correct_index')::int, 0) END, _answer);
  END LOOP;
  RETURN _id;
END;
$$;

-- Student submits: _responses is an array in question order (null = skipped). One try per quiz/exam.
CREATE OR REPLACE FUNCTION public.submit_quiz_v2(_quiz_id uuid, _responses jsonb, _started_at timestamptz DEFAULT NULL)
RETURNS public.quiz_attempts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row public.quiz_attempts;
  _q record;
  _r jsonb;
  _s jsonb;
  _scores jsonb := '[]'::jsonb;
  _score integer := 0;
  _total integer := 0;
  _pending boolean := false;
  _legacy integer[] := '{}';
  _name text;
BEGIN
  IF NOT public.can_take_quiz(_quiz_id) THEN
    RAISE EXCEPTION 'This quiz is not available to you';
  END IF;
  SELECT * INTO _row FROM public.quiz_attempts WHERE quiz_id = _quiz_id AND student_id = auth.uid();
  IF FOUND THEN RETURN _row; END IF;
  IF jsonb_typeof(_responses) <> 'array' THEN _responses := '[]'::jsonb; END IF;

  FOR _q IN
    SELECT q.id, q.position, q.type, q.points, k.correct_index, k.answer
    FROM public.quiz_questions q JOIN public.quiz_answer_keys k ON k.question_id = q.id
    WHERE q.quiz_id = _quiz_id ORDER BY q.position
  LOOP
    _r := _responses->(_q.position - 1);
    IF _r IS NULL OR jsonb_typeof(_r) <> 'object' THEN _r := '{}'::jsonb; END IF;
    _s := public.score_response(_q.type, _q.points, _q.correct_index, _q.answer, _r);
    _scores := _scores || jsonb_build_object('question_id', _q.id, 'points', _s->'points', 'max', _s->'max', 'pending', _s->'pending');
    _score := _score + (_s->>'points')::int;
    _total := _total + (_s->>'max')::int;
    _pending := _pending OR (_s->>'pending')::boolean;
    _legacy := _legacy || CASE WHEN _q.type = 'multiple_choice' AND (_r->>'choice') ~ '^-?[0-9]+$' THEN (_r->>'choice')::int ELSE -1 END;
  END LOOP;

  SELECT full_name INTO _name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.quiz_attempts (quiz_id, student_id, student_name, student_email, answers, responses, item_scores, needs_grading, score, total, started_at)
  VALUES (_quiz_id, auth.uid(), COALESCE(_name, ''), public.current_email(), _legacy, _responses, _scores, _pending, _score, _total, _started_at)
  RETURNING * INTO _row;
  RETURN _row;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.submit_quiz_v2(uuid, jsonb, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_quiz_v2(uuid, jsonb, timestamptz) TO authenticated;

-- Older app versions / answers queued offline (multiple choice only) still work.
CREATE OR REPLACE FUNCTION public.submit_quiz(_quiz_id uuid, _answers integer[], _started_at timestamptz DEFAULT NULL)
RETURNS public.quiz_attempts LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.submit_quiz_v2(_quiz_id,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('choice', x) ORDER BY i) FROM unnest(_answers) WITH ORDINALITY u(x, i)), '[]'::jsonb),
    _started_at)
$$;

-- Instructor grades essays: _scores = {"<question_id>": points, ...}. Recomputes the total.
CREATE OR REPLACE FUNCTION public.grade_attempt(_attempt_id uuid, _scores jsonb, _feedback text DEFAULT '')
RETURNS public.quiz_attempts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row public.quiz_attempts;
  _new jsonb := '[]'::jsonb;
  _it jsonb;
  _qid text;
  _given integer;
  _title text;
BEGIN
  SELECT * INTO _row FROM public.quiz_attempts WHERE id = _attempt_id;
  IF NOT FOUND OR NOT public.can_manage_quiz(_row.quiz_id) THEN
    RAISE EXCEPTION 'Only the class instructor can grade this';
  END IF;
  FOR _it IN SELECT * FROM jsonb_array_elements(_row.item_scores) LOOP
    _qid := _it->>'question_id';
    IF (SELECT type FROM public.quiz_questions WHERE id = _qid::uuid) = 'essay' AND _scores ? _qid THEN
      _given := (_scores->>_qid)::int;
      IF _given < 0 OR _given > (_it->>'max')::int THEN
        RAISE EXCEPTION 'Essay points must be between 0 and %', _it->>'max';
      END IF;
      _it := _it || jsonb_build_object('points', _given, 'pending', false);
    END IF;
    _new := _new || _it;
  END LOOP;
  UPDATE public.quiz_attempts SET
    item_scores = _new,
    score = (SELECT COALESCE(sum((x->>'points')::int), 0) FROM jsonb_array_elements(_new) x),
    needs_grading = EXISTS (SELECT 1 FROM jsonb_array_elements(_new) x WHERE (x->>'pending')::boolean),
    graded_at = now(),
    feedback = trim(COALESCE(_feedback, ''))
  WHERE id = _attempt_id
  RETURNING * INTO _row;
  SELECT title INTO _title FROM public.quizzes WHERE id = _row.quiz_id;
  IF NOT _row.needs_grading THEN
    PERFORM public.notify(_row.student_id, 'grade', 'Your answers were graded', _title || ': ' || _row.score || ' / ' || _row.total);
  END IF;
  PERFORM public.log_activity('assessment', 'Essay graded', COALESCE(NULLIF(_row.student_name, ''), _row.student_email) || ' · ' || _title, _row.score || ' / ' || _row.total);
  RETURN _row;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.grade_attempt(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grade_attempt(uuid, jsonb, text) TO authenticated;
