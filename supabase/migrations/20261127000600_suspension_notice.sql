-- Suspended people are told why: the admin gives a reason, the person gets a notification, and the
-- app / website show the reason when they are signed out or try to sign in.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS suspension_reason text NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION public.trg_profile_suspension()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _name text := COALESCE(NULLIF(NEW.full_name, ''), NEW.email);
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.suspension_reason IS NOT DISTINCT FROM OLD.suspension_reason THEN
    RETURN NEW;
  END IF;
  -- Only administrators (or the database itself) may suspend or reactivate an account.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can change an account''s status.';
  END IF;

  IF NEW.status = 'suspended' AND OLD.status IS DISTINCT FROM 'suspended' THEN
    IF trim(NEW.suspension_reason) = '' THEN RAISE EXCEPTION 'Give a reason for the suspension. The person will see it.'; END IF;
    PERFORM public.notify(NEW.id, 'account', 'Your account has been suspended', 'Reason: ' || trim(NEW.suspension_reason) || '. Please contact your administrator.');
    PERFORM public.log_activity('user', 'Account suspended', _name, trim(NEW.suspension_reason));
  ELSIF NEW.status = 'active' AND OLD.status = 'suspended' THEN
    NEW.suspension_reason := '';
    PERFORM public.notify(NEW.id, 'account', 'Your account is active again', 'An administrator reactivated your account. You can sign in again.');
    PERFORM public.log_activity('user', 'Account reactivated', _name);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trg_profile_suspension() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profile_suspension ON public.profiles;
CREATE TRIGGER profile_suspension BEFORE UPDATE OF status, suspension_reason ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_profile_suspension();
