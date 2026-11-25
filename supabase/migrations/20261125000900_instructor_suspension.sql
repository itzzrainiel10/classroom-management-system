-- Instructor statuses: pending → approved / rejected, and approved ⇄ suspended (admin only).
-- A suspended instructor keeps their account and data but loses every instructor feature
-- (web portal, mobile instructor screens, own classes, schedule) until an admin reactivates them.

ALTER TABLE public.instructor_profiles DROP CONSTRAINT IF EXISTS instructor_profiles_status_check;
ALTER TABLE public.instructor_profiles ADD CONSTRAINT instructor_profiles_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'suspended'));

ALTER TABLE public.instructor_verifications DROP CONSTRAINT IF EXISTS instructor_verifications_decision_check;
ALTER TABLE public.instructor_verifications ADD CONSTRAINT instructor_verifications_decision_check
  CHECK (decision IN ('approved', 'rejected', 'suspended', 'reactivated'));

-- False while the signed-in user's instructor access is suspended.
CREATE OR REPLACE FUNCTION public.instructor_not_suspended()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.instructor_profiles WHERE user_id = auth.uid() AND status = 'suspended')
$$;
GRANT EXECUTE ON FUNCTION public.instructor_not_suspended() TO authenticated;

-- Class content (quizzes, assignments, announcements, extra meetings, rosters) goes through this check.
CREATE OR REPLACE FUNCTION public.is_class_instructor(_class_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_user() AND public.instructor_not_suspended()
     AND EXISTS (SELECT 1 FROM public.classes WHERE id = _class_id AND instructor_id = auth.uid())
$$;

DROP POLICY IF EXISTS "Instructors read own classes" ON public.classes;
CREATE POLICY "Instructors read own classes" ON public.classes FOR SELECT TO authenticated
  USING ((instructor_id = auth.uid() AND public.is_active_user() AND public.instructor_not_suspended()) OR public.is_class_student(id));

DROP POLICY IF EXISTS "Instructors update own classes" ON public.classes;
CREATE POLICY "Instructors update own classes" ON public.classes FOR UPDATE TO authenticated
  USING (public.is_class_instructor(id)) WITH CHECK (instructor_id = auth.uid());
DROP POLICY IF EXISTS "Instructors delete own classes" ON public.classes;
CREATE POLICY "Instructors delete own classes" ON public.classes FOR DELETE TO authenticated
  USING (public.is_class_instructor(id));

-- Suspend or reactivate an approved instructor. Administrators only; recorded with who and when.
CREATE OR REPLACE FUNCTION public.set_instructor_suspension(_user_id uuid, _suspend boolean, _reason text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _name text;
  _status text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only administrators can suspend or reactivate instructors'; END IF;
  IF _user_id = auth.uid() THEN RAISE EXCEPTION 'You cannot change your own instructor status'; END IF;
  SELECT status INTO _status FROM public.instructor_profiles WHERE user_id = _user_id;
  IF _status IS NULL THEN RAISE EXCEPTION 'No instructor record found for this user'; END IF;
  IF _suspend AND _status <> 'approved' THEN RAISE EXCEPTION 'Only approved instructors can be suspended'; END IF;
  IF NOT _suspend AND _status <> 'suspended' THEN RAISE EXCEPTION 'This instructor is not suspended'; END IF;
  IF _suspend AND trim(COALESCE(_reason, '')) = '' THEN RAISE EXCEPTION 'Give a reason for the suspension'; END IF;

  SELECT COALESCE(NULLIF(full_name, ''), email) INTO _name FROM public.profiles WHERE id = _user_id;
  UPDATE public.instructor_profiles
  SET status = CASE WHEN _suspend THEN 'suspended' ELSE 'approved' END,
      rejection_reason = CASE WHEN _suspend THEN trim(_reason) ELSE '' END,
      reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE user_id = _user_id;
  INSERT INTO public.instructor_verifications (user_id, decision, reason, decided_by)
  VALUES (_user_id, CASE WHEN _suspend THEN 'suspended' ELSE 'reactivated' END, trim(COALESCE(_reason, '')), auth.uid());

  IF _suspend THEN
    PERFORM public.notify(_user_id, 'application', 'Instructor access suspended', 'Reason: ' || trim(_reason));
    PERFORM public.log_activity('verification', 'Instructor suspended', COALESCE(_name, ''), 'Suspended');
  ELSE
    PERFORM public.notify(_user_id, 'application', 'Instructor access restored', 'An administrator reactivated your instructor account.');
    PERFORM public.log_activity('verification', 'Instructor reactivated', COALESCE(_name, ''), 'Reactivated');
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_instructor_suspension(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_instructor_suspension(uuid, boolean, text) TO authenticated;
