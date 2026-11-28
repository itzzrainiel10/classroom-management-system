ALTER TABLE public.announcement_messages
  ADD COLUMN mentioned_user_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];

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
        SELECT p.id AS user_id, COALESCE(NULLIF(btrim(p.full_name), ''), p.email) AS full_name
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

REVOKE EXECUTE ON FUNCTION public.announcement_mention_options(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.announcement_mention_options(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_announcement_message_mentions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _class_id uuid;
  _section_id uuid;
  _instructor_id uuid;
  _mentioned_id uuid;
  _deduplicated_mentions uuid[];
BEGIN
  SELECT a.class_id, c.section_id, c.instructor_id
    INTO _class_id, _section_id, _instructor_id
    FROM public.announcements a
    JOIN public.classes c ON c.id = a.class_id
    WHERE a.id = NEW.announcement_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Announcement not found';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT mentioned_id), ARRAY[]::uuid[])
    INTO _deduplicated_mentions
    FROM unnest(COALESCE(NEW.mentioned_user_ids, ARRAY[]::uuid[])) AS mentions(mentioned_id);
  NEW.mentioned_user_ids := _deduplicated_mentions;

  FOREACH _mentioned_id IN ARRAY NEW.mentioned_user_ids
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM public.profiles p
        WHERE p.id = _mentioned_id
          AND p.status = 'active'
          AND (
            p.id = _instructor_id
            OR EXISTS (
              SELECT 1
                FROM public.class_students cs
                WHERE cs.class_id = _class_id
                  AND lower(trim(cs.email)) = lower(trim(p.email))
                  AND (_section_id IS NULL OR p.section_id = _section_id)
            )
          )
    ) THEN
      RAISE EXCEPTION 'Mentioned user is not an active member of this class section';
    END IF;
  END LOOP;

  RETURN NEW;
END
$function$;

CREATE TRIGGER announcement_messages_validate_mentions
  BEFORE INSERT ON public.announcement_messages
  FOR EACH ROW EXECUTE FUNCTION public.validate_announcement_message_mentions();

CREATE OR REPLACE FUNCTION public.notify_announcement_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _class_id uuid;
  _section_id uuid;
  _instructor_id uuid;
  _announcement_title text;
  _class_code text;
  _section text;
  _recipient uuid;
  _is_mentioned boolean;
  _mentioned_ids uuid[];
BEGIN
  _mentioned_ids := COALESCE(NEW.mentioned_user_ids, ARRAY[]::uuid[]);
  SELECT a.class_id, c.section_id, c.instructor_id, a.title, c.code, c.section
    INTO _class_id, _section_id, _instructor_id, _announcement_title, _class_code, _section
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
        AND p.id <> _instructor_id
        AND p.status = 'active'
        AND (_section_id IS NULL OR p.section_id = _section_id)
  LOOP
    _is_mentioned := _recipient = ANY(_mentioned_ids);
    PERFORM public.notify(
      _recipient,
      CASE WHEN _is_mentioned THEN 'announcement_mention' ELSE 'announcement_message' END,
      CASE WHEN _is_mentioned THEN 'You were mentioned in a class message' ELSE 'New message on a class announcement' END,
      CASE
        WHEN _is_mentioned THEN format('%s mentioned you in "%s" · %s%s', NEW.author_name, _announcement_title, _class_code, CASE WHEN nullif(btrim(_section), '') IS NULL THEN '' ELSE ' · ' || btrim(_section) END)
        ELSE format('%s replied to "%s" in %s%s', NEW.author_name, _announcement_title, _class_code, CASE WHEN nullif(btrim(_section), '') IS NULL THEN '' ELSE ' · ' || btrim(_section) END)
      END
    );
  END LOOP;

  IF _instructor_id <> NEW.author_id AND _instructor_id = ANY(_mentioned_ids) THEN
    PERFORM public.notify(
      _instructor_id,
      'announcement_mention',
      'You were mentioned in a class message',
      format('%s mentioned you in "%s" · %s%s', NEW.author_name, _announcement_title, _class_code, CASE WHEN nullif(btrim(_section), '') IS NULL THEN '' ELSE ' · ' || btrim(_section) END)
    );
  END IF;

  RETURN NEW;
END
$function$;
