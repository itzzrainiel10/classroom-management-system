-- The mobile app no longer asks for a contact number: it is optional for instructor applications.

CREATE OR REPLACE FUNCTION public.submit_instructor_application(_full_name text, _employee_id text, _department text, _contact_number text, _proof_path text DEFAULT NULL::text)
 RETURNS instructor_profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row public.instructor_profiles;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'This account is suspended'; END IF;
  IF public.is_approved_instructor(_uid) THEN RAISE EXCEPTION 'Your instructor account is already approved'; END IF;
  IF trim(COALESCE(_full_name, '')) = '' THEN RAISE EXCEPTION 'Enter your full name'; END IF;
  IF trim(COALESCE(_employee_id, '')) = '' THEN RAISE EXCEPTION 'Enter your employee / faculty ID'; END IF;
  IF trim(COALESCE(_department, '')) = '' THEN RAISE EXCEPTION 'Enter your department'; END IF;
  -- Contact number is optional; if given it must look like a phone number.
  IF trim(COALESCE(_contact_number, '')) <> '' AND trim(_contact_number) !~ '^\+?[0-9][0-9 -]{6,18}$' THEN RAISE EXCEPTION 'Enter a valid contact number (e.g. 0917 123 4567)'; END IF;
  IF _proof_path IS NOT NULL AND _proof_path <> '' AND split_part(_proof_path, '/', 1) <> _uid::text THEN
    RAISE EXCEPTION 'Invalid proof document';
  END IF;
  IF EXISTS (SELECT 1 FROM public.instructor_profiles WHERE lower(employee_id) = lower(trim(_employee_id)) AND user_id <> _uid) THEN
    RAISE EXCEPTION 'This employee / faculty ID is already registered to another account';
  END IF;

  UPDATE public.profiles SET full_name = trim(_full_name) WHERE id = _uid;
  INSERT INTO public.instructor_profiles (user_id, employee_id, department, contact_number, proof_path, status, submitted_at)
  VALUES (_uid, trim(_employee_id), trim(_department), trim(COALESCE(_contact_number, '')), NULLIF(_proof_path, ''), 'pending', now())
  ON CONFLICT (user_id) DO UPDATE SET
    employee_id = EXCLUDED.employee_id,
    department = EXCLUDED.department,
    contact_number = EXCLUDED.contact_number,
    proof_path = COALESCE(EXCLUDED.proof_path, public.instructor_profiles.proof_path),
    status = 'pending',
    rejection_reason = '',
    reviewed_by = NULL,
    reviewed_at = NULL,
    submitted_at = now(),
    updated_at = now()
  RETURNING * INTO _row;
  PERFORM public.log_activity('verification', 'Instructor application submitted', trim(_full_name) || ' · ' || trim(_department), 'Pending');
  RETURN _row;
END;
$function$

;
