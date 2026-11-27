-- Announcements show who posted them. Students can't read other people's profiles, so the
-- poster's name is stamped onto the announcement by the database when it is written.

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS posted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS author_name text NOT NULL DEFAULT '';

-- Existing announcements: credit the class's instructor (before the trigger exists).
UPDATE public.announcements a
SET posted_by = c.instructor_id,
    author_name = COALESCE(NULLIF(p.full_name, ''), p.email, '')
FROM public.classes c
LEFT JOIN public.profiles p ON p.id = c.instructor_id
WHERE c.id = a.class_id AND a.posted_by IS NULL;

CREATE OR REPLACE FUNCTION public.trg_announcement_author()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Always the signed-in poster; never a value sent by the app.
    NEW.posted_by := COALESCE(auth.uid(), (SELECT instructor_id FROM public.classes WHERE id = NEW.class_id));
  ELSE
    NEW.posted_by := OLD.posted_by;
  END IF;
  NEW.author_name := COALESCE((SELECT COALESCE(NULLIF(full_name, ''), email) FROM public.profiles WHERE id = NEW.posted_by), '');
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trg_announcement_author() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS announcements_author ON public.announcements;
CREATE TRIGGER announcements_author BEFORE INSERT OR UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.trg_announcement_author();
