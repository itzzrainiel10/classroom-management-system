CREATE TABLE public.announcement_message_reactions (
  announcement_id uuid NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.announcement_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX announcement_message_reactions_thread
  ON public.announcement_message_reactions (announcement_id, message_id);

ALTER TABLE public.announcement_message_reactions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.announcement_message_reactions FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.announcement_message_reactions TO authenticated;
GRANT ALL ON TABLE public.announcement_message_reactions TO service_role;

CREATE POLICY "Class members read announcement message reactions"
  ON public.announcement_message_reactions AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.announcement_messages m
        JOIN public.announcements a ON a.id = m.announcement_id
        WHERE m.id = announcement_message_reactions.message_id
          AND m.announcement_id = announcement_message_reactions.announcement_id
          AND public.can_access_class_announcement(a.class_id)
    )
  );

CREATE POLICY "Class members add own announcement message reactions"
  ON public.announcement_message_reactions AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    announcement_message_reactions.user_id = auth.uid()
    AND EXISTS (
      SELECT 1
        FROM public.announcement_messages m
        JOIN public.announcements a ON a.id = m.announcement_id
        WHERE m.id = announcement_message_reactions.message_id
          AND m.announcement_id = announcement_message_reactions.announcement_id
          AND public.can_access_class_announcement(a.class_id)
    )
  );

CREATE POLICY "Class members delete own announcement message reactions"
  ON public.announcement_message_reactions AS PERMISSIVE FOR DELETE TO authenticated
  USING (
    announcement_message_reactions.user_id = auth.uid()
    AND EXISTS (
      SELECT 1
        FROM public.announcement_messages m
        JOIN public.announcements a ON a.id = m.announcement_id
        WHERE m.id = announcement_message_reactions.message_id
          AND m.announcement_id = announcement_message_reactions.announcement_id
          AND public.can_access_class_announcement(a.class_id)
    )
  );

ALTER PUBLICATION supabase_realtime ADD TABLE public.announcement_message_reactions;
