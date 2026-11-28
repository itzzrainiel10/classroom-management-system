CREATE OR REPLACE FUNCTION public.announcement_mention_options(_announcement_id uuid)
RETURNS TABLE(user_id uuid, full_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.announcements a
      WHERE a.id = _announcement_id
        AND public.can_access_class_announcement(a.class_id)
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT options.user_id, options.full_name
      FROM (
        SELECT p.id AS user_id,
               COALESCE(NULLIF(btrim(cs.full_name), ''), NULLIF(btrim(p.full_name), ''), p.email) AS full_name
          FROM public.announcements a
          JOIN public.classes c ON c.id = a.class_id
          JOIN public.class_students cs ON cs.class_id = c.id
          JOIN public.profiles p ON lower(trim(p.email)) = lower(trim(cs.email))
          WHERE a.id = _announcement_id
            AND p.id <> auth.uid()
            AND p.status = 'active'
            AND (c.section_id IS NULL OR p.section_id = c.section_id)
        UNION
        SELECT p.id AS user_id, COALESCE(NULLIF(btrim(p.full_name), ''), p.email) AS full_name
          FROM public.announcements a
          JOIN public.classes c ON c.id = a.class_id
          JOIN public.profiles p ON p.id = c.instructor_id
          WHERE a.id = _announcement_id
            AND p.id <> auth.uid()
            AND p.status = 'active'
      ) AS options
      ORDER BY options.full_name;
END
$function$;
