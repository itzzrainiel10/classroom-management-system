-- A Google sign-in creates the login immediately. When that new login turns out to be useless
-- (e.g. someone tried the admin website with a non-admin Google account), the website calls this to
-- remove it again, so no "No role" accounts are left behind.
-- Safe: only the caller's OWN login, only if it has no role and no instructor application at all,
-- and only within 10 minutes of being created. Existing accounts are never touched.
CREATE OR REPLACE FUNCTION public.discard_my_new_account()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid)
     OR EXISTS (SELECT 1 FROM public.instructor_profiles WHERE user_id = _uid)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _uid AND created_at > now() - interval '10 minutes') THEN
    RETURN false;
  END IF;
  DELETE FROM public.notifications WHERE user_id = _uid;
  DELETE FROM public.activity_log WHERE actor_id = _uid;  -- it never really signed in
  DELETE FROM auth.users WHERE id = _uid;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.discard_my_new_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discard_my_new_account() TO authenticated;

-- "Signed in" is only recorded for accounts that can actually use the system
-- (a role, or an instructor application). A Google login that is refused is not a sign-in.
CREATE OR REPLACE FUNCTION public.trg_log_sign_in()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.last_sign_in_at IS DISTINCT FROM OLD.last_sign_in_at
     AND (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id)
          OR EXISTS (SELECT 1 FROM public.instructor_profiles WHERE user_id = NEW.id)) THEN
    PERFORM public.log_activity('sign_in', 'Signed in', COALESCE(NEW.email, ''), 'Success', NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

-- One-time clean-up: logins that never got a role or an application (refused Google sign-ins).
DELETE FROM public.activity_log a
WHERE a.actor_id IN (SELECT p.id FROM public.profiles p
                     WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id)
                       AND NOT EXISTS (SELECT 1 FROM public.instructor_profiles ip WHERE ip.user_id = p.id));
DELETE FROM public.notifications n
WHERE n.user_id IN (SELECT p.id FROM public.profiles p
                    WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id)
                      AND NOT EXISTS (SELECT 1 FROM public.instructor_profiles ip WHERE ip.user_id = p.id));
DELETE FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM public.instructor_profiles ip WHERE ip.user_id = u.id);
