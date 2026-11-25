-- Administrators (web admin portal). Granted by hand, never through sign-up:
--   INSERT INTO public.user_roles (user_id, role)
--   SELECT id, 'admin' FROM auth.users WHERE email = 'someone@cvsu.edu.ph';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'admin';
