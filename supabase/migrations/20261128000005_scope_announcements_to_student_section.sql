CREATE OR REPLACE FUNCTION public.can_access_class_announcement(_class_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.is_class_instructor(_class_id)
    OR (
      public.is_class_student(_class_id)
      AND EXISTS (
        SELECT 1
          FROM public.classes c
          JOIN public.profiles p ON p.id = auth.uid()
          WHERE c.id = _class_id
            AND (c.section_id IS NULL OR p.section_id = c.section_id)
      )
    )
$function$;

REVOKE EXECUTE ON FUNCTION public.can_access_class_announcement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_class_announcement(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Read announcements" ON public.announcements;
CREATE POLICY "Read announcements"
  ON public.announcements AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.can_access_class_announcement(class_id));

DROP POLICY IF EXISTS "Class members read announcement messages" ON public.announcement_messages;
CREATE POLICY "Class members read announcement messages"
  ON public.announcement_messages AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.announcements a
        WHERE a.id = announcement_id
          AND public.can_access_class_announcement(a.class_id)
    )
  );

DROP POLICY IF EXISTS "Class members send announcement messages" ON public.announcement_messages;
CREATE POLICY "Class members send announcement messages"
  ON public.announcement_messages AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1
        FROM public.announcements a
        WHERE a.id = announcement_id
          AND public.can_access_class_announcement(a.class_id)
    )
  );

CREATE OR REPLACE FUNCTION public.notify_announcement_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _class_id uuid;
  _section_id uuid;
  _announcement_title text;
  _class_code text;
  _section text;
  _recipient uuid;
BEGIN
  SELECT a.class_id, c.section_id, a.title, c.code, c.section
    INTO _class_id, _section_id, _announcement_title, _class_code, _section
    FROM public.announcements a
    JOIN public.classes c ON c.id = a.class_id
    WHERE a.id = NEW.announcement_id
      AND c.archived_at IS NULL;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  FOR _recipient IN
    SELECT DISTINCT p.id
      FROM public.class_students cs
      JOIN public.profiles p ON lower(trim(p.email)) = lower(trim(cs.email))
      WHERE cs.class_id = _class_id
        AND p.id <> NEW.author_id
        AND p.status = 'active'
        AND (_section_id IS NULL OR p.section_id = _section_id)
  LOOP
    PERFORM public.notify(
      _recipient,
      'announcement_message',
      'New message on a class announcement',
      format(
        '%s replied to "%s" in %s%s',
        NEW.author_name,
        _announcement_title,
        _class_code,
        CASE WHEN nullif(btrim(_section), '') IS NULL THEN '' ELSE ' · ' || btrim(_section) END
      )
    );
  END LOOP;

  RETURN NEW;
END
$function$;
