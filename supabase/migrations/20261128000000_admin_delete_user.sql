CREATE OR REPLACE FUNCTION public.admin_delete_user(_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  _name text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only administrators can delete users.'; END IF;
  IF _user_id = auth.uid() THEN RAISE EXCEPTION 'You can''t delete your own account.'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role::text = 'admin') THEN
    RAISE EXCEPTION 'This account is an administrator and can''t be deleted here.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role::text = 'instructor') THEN
    RETURN public.admin_delete_instructor(_user_id);
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), email) INTO _name FROM public.profiles WHERE id = _user_id;
  IF _name IS NULL THEN RAISE EXCEPTION 'User not found.'; END IF;

  PERFORM set_config('cms.account_cleanup', 'on', true);
  DELETE FROM auth.users WHERE id = _user_id;

  PERFORM public.log_activity('user', 'User deleted', _name, 'Account and login removed');
  RETURN jsonb_build_object('name', _name, 'classes_removed', 0);
END;
$function$
;

REVOKE EXECUTE ON FUNCTION public.admin_delete_user(_user_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(_user_id uuid) TO service_role;
