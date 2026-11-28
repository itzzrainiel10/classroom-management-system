ALTER TABLE public.profiles
  ADD COLUMN is_inactive boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_inactive IS 'Admin-managed directory label; does not block sign-in or affect access.';

CREATE OR REPLACE FUNCTION public.profiles_inactive_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN
    NEW.is_inactive := OLD.is_inactive;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE TRIGGER profiles_inactive_guard
  BEFORE UPDATE OF is_inactive ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_inactive_guard();
