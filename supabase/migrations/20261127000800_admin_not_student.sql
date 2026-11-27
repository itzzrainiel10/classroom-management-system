-- An administrator can never also be a student (any path: role change, invitation, Google sign-in).

-- Existing overlap: drop the student role from admin accounts (and any automatic class enrollments).
DELETE FROM public.class_students cs
USING public.profiles p
WHERE lower(cs.email) = lower(p.email) AND cs.auto
  AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role::text = 'admin');
UPDATE public.profiles p SET section_id = NULL
WHERE section_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role::text = 'admin');
DELETE FROM public.user_roles s
WHERE s.role::text = 'student' AND EXISTS (SELECT 1 FROM public.user_roles a WHERE a.user_id = s.user_id AND a.role::text = 'admin');

CREATE OR REPLACE FUNCTION public.trg_admin_not_student()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role::text = 'student' AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.user_id AND role::text = 'admin') THEN
    RAISE EXCEPTION 'An administrator account can''t be a student. Use a separate account for the student.';
  END IF;
  IF NEW.role::text = 'admin' THEN
    -- Becoming an administrator ends any student role.
    DELETE FROM public.user_roles WHERE user_id = NEW.user_id AND role::text = 'student';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trg_admin_not_student() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS admin_not_student ON public.user_roles;
CREATE TRIGGER admin_not_student BEFORE INSERT OR UPDATE OF role ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.trg_admin_not_student();
