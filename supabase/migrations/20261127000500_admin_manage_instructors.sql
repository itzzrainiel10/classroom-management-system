-- Admin CRUD for instructors.
--   Create: the admin-users Edge Function makes the login (needs the service key), then calls
--           admin_set_role(…,'instructor') and admin_save_instructor() as the admin.
--   Update: admin_save_instructor() — name, employee ID, department, contact number.
--   Delete: admin_delete_instructor() — one transaction; refused while they still teach this semester.

-- Archived (ended-semester) records stay read-only, except for the account clean-up done inside
-- admin_delete_instructor(), which sets a transaction-local flag.
CREATE OR REPLACE FUNCTION public.guard_archived_class()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row record;
  _cid uuid;
BEGIN
  IF current_setting('cms.account_cleanup', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN _row := OLD; ELSE _row := NEW; END IF;
  IF TG_TABLE_NAME IN ('quiz_questions', 'quiz_answer_keys', 'quiz_attempts') THEN
    SELECT class_id INTO _cid FROM public.quizzes WHERE id = _row.quiz_id;
  ELSE
    _cid := _row.class_id;
  END IF;
  IF _cid IS NOT NULL AND EXISTS (SELECT 1 FROM public.classes WHERE id = _cid AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This class belongs to an ended semester. Its records are read-only.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- A class is "on the schedule" only for the ACTIVE semester's schedules.
CREATE OR REPLACE FUNCTION public.classes_keep_scheduled()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.archived_at IS NULL AND OLD.subject_id IS NOT NULL AND OLD.section_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.instructor_schedules s JOIN public.semesters t ON t.status = 'active' AND t.semester = s.semester AND t.academic_year = s.academic_year
    WHERE s.subject_id = OLD.subject_id AND s.section_id = OLD.section_id AND s.instructor_id = OLD.instructor_id
  ) THEN
    RAISE EXCEPTION 'This class is on the official schedule (% · %). Ask the administrator to remove its schedule first.', OLD.code, OLD.section;
  END IF;
  RETURN OLD;
END;
$$;

/* ---------- Update ---------- */
CREATE OR REPLACE FUNCTION public.admin_save_instructor(_user_id uuid, _full_name text, _employee_id text, _department text, _contact_number text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only administrators can edit instructors.'; END IF;
  IF trim(coalesce(_full_name, '')) = '' THEN RAISE EXCEPTION 'Enter the instructor''s full name.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id) THEN RAISE EXCEPTION 'Instructor not found.'; END IF;
  IF trim(coalesce(_employee_id, '')) <> '' AND EXISTS (
    SELECT 1 FROM public.instructor_profiles WHERE lower(trim(employee_id)) = lower(trim(_employee_id)) AND user_id <> _user_id
  ) THEN
    RAISE EXCEPTION 'Employee ID % is already used by another instructor.', trim(_employee_id);
  END IF;

  UPDATE public.profiles SET full_name = trim(_full_name), updated_at = now() WHERE id = _user_id;
  INSERT INTO public.instructor_profiles (user_id, employee_id, department, contact_number, status, reviewed_by, reviewed_at)
  VALUES (_user_id, trim(coalesce(_employee_id, '')), trim(coalesce(_department, '')), trim(coalesce(_contact_number, '')), 'approved', auth.uid(), now())
  ON CONFLICT (user_id) DO UPDATE SET employee_id = EXCLUDED.employee_id, department = EXCLUDED.department,
    contact_number = EXCLUDED.contact_number, updated_at = now();
  PERFORM public.log_activity('user', 'Instructor details updated', trim(_full_name));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_save_instructor(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_instructor(uuid, text, text, text, text) TO authenticated;

/* ---------- Delete ---------- */
CREATE OR REPLACE FUNCTION public.admin_delete_instructor(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  _name text;
  _sched int;
  _classes int;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only administrators can delete instructors.'; END IF;
  IF _user_id = auth.uid() THEN RAISE EXCEPTION 'You can''t delete your own account.'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role::text = 'admin') THEN
    RAISE EXCEPTION 'This account is an administrator and can''t be deleted here.';
  END IF;
  SELECT COALESCE(NULLIF(full_name, ''), email) INTO _name FROM public.profiles WHERE id = _user_id;
  IF _name IS NULL THEN RAISE EXCEPTION 'Instructor not found.'; END IF;

  SELECT count(*) INTO _sched FROM public.instructor_schedules s
    JOIN public.semesters t ON t.status = 'active' AND t.semester = s.semester AND t.academic_year = s.academic_year
    WHERE s.instructor_id = _user_id;
  IF _sched > 0 THEN
    RAISE EXCEPTION '% still has % class time(s) on this semester''s schedule. Remove or reassign them in Schedules first.', _name, _sched;
  END IF;

  PERFORM set_config('cms.account_cleanup', 'on', true);  -- this transaction only

  -- Current (live) classes go with the account; archived semesters keep their copies and the name.
  SELECT count(*) INTO _classes FROM public.classes WHERE instructor_id = _user_id AND archived_at IS NULL;
  DELETE FROM public.classes WHERE instructor_id = _user_id AND archived_at IS NULL;

  -- References that would otherwise block deleting the login.
  UPDATE public.announcements SET posted_by = NULL WHERE posted_by = _user_id;
  UPDATE public.attendance_sessions SET taken_by = NULL WHERE taken_by = _user_id;
  UPDATE public.omr_scans SET created_by = NULL WHERE created_by = _user_id;
  UPDATE public.omr_scans SET finalized_by = NULL WHERE finalized_by = _user_id;
  UPDATE public.omr_sheets SET created_by = NULL WHERE created_by = _user_id;
  UPDATE public.instructor_profiles SET reviewed_by = NULL WHERE reviewed_by = _user_id;
  UPDATE public.instructor_verifications SET decided_by = NULL WHERE decided_by = _user_id;
  UPDATE public.app_settings SET updated_by = NULL WHERE updated_by = _user_id;

  -- The login itself (profile, roles, application, notifications and old schedules follow).
  DELETE FROM auth.users WHERE id = _user_id;

  PERFORM public.log_activity('user', 'Instructor deleted', _name, _classes || ' current class(es) removed');
  RETURN jsonb_build_object('name', _name, 'classes_removed', _classes);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_delete_instructor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_instructor(uuid) TO authenticated;
