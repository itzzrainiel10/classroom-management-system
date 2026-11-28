CREATE TABLE public.announcement_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  announcement_id uuid NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_name text NOT NULL DEFAULT 'Class member',
  message text NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 2000),
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX announcement_messages_thread ON public.announcement_messages USING btree (announcement_id, created_at);

CREATE OR REPLACE FUNCTION public.set_announcement_message_author()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.author_id := auth.uid();
  SELECT COALESCE(NULLIF(btrim(full_name), ''), 'Class member')
    INTO NEW.author_name
    FROM public.profiles
    WHERE id = auth.uid();
  NEW.author_name := COALESCE(NEW.author_name, 'Class member');
  RETURN NEW;
END
$function$;

CREATE TRIGGER announcement_messages_author
  BEFORE INSERT ON public.announcement_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_announcement_message_author();

ALTER TABLE public.announcement_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Class members read announcement messages"
  ON public.announcement_messages AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.announcements a
      WHERE a.id = announcement_id
        AND (public.is_class_instructor(a.class_id) OR public.is_class_student(a.class_id))
    )
  );

CREATE POLICY "Class members send announcement messages"
  ON public.announcement_messages AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.announcements a
      WHERE a.id = announcement_id
        AND (public.is_class_instructor(a.class_id) OR public.is_class_student(a.class_id))
    )
  );

REVOKE ALL ON TABLE public.announcement_messages FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.announcement_messages TO authenticated;
GRANT ALL ON TABLE public.announcement_messages TO service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE public.announcement_messages;
