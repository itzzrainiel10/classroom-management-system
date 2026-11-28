CREATE OR REPLACE FUNCTION public.notify_announcement_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _class_id uuid;
  _announcement_title text;
  _class_code text;
  _section text;
  _recipient uuid;
BEGIN
  SELECT a.class_id, a.title, c.code, c.section
    INTO _class_id, _announcement_title, _class_code, _section
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
      JOIN public.user_roles r ON r.user_id = p.id AND r.role::text = 'student'
      WHERE cs.class_id = _class_id
        AND p.id <> NEW.author_id
        AND p.status = 'active'
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

CREATE TRIGGER announcement_messages_notify_students
  AFTER INSERT ON public.announcement_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_announcement_message();
