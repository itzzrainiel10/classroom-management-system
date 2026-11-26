-- Subject + Class become one flow: scheduling a Subject for a Section with an Instructor automatically
-- creates that instructor's Class (one per subject · section · instructor) and enrolls the section's
-- students. Students who join / change section follow automatically; renaming a subject or section
-- renames its classes. Classes made by hand (no subject/section link) keep working as before.

ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS section_id uuid REFERENCES public.sections(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS classes_subject_section_instructor
  ON public.classes (subject_id, section_id, instructor_id) WHERE subject_id IS NOT NULL AND section_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS classes_section ON public.classes (section_id);

-- Enrollments added automatically from the section (removed again if the student changes section).
ALTER TABLE public.class_students ADD COLUMN IF NOT EXISTS auto boolean NOT NULL DEFAULT false;

/* The instructor's class for a subject in a section (created if missing), with the section's students enrolled. */
CREATE OR REPLACE FUNCTION public.ensure_schedule_class(_subject uuid, _section uuid, _instructor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cls uuid;
  _sub public.subjects;
  _sec public.sections;
BEGIN
  SELECT * INTO _sub FROM public.subjects WHERE id = _subject;
  SELECT * INTO _sec FROM public.sections WHERE id = _section;
  IF _sub.id IS NULL OR _sec.id IS NULL OR _instructor IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO _cls FROM public.classes WHERE subject_id = _subject AND section_id = _section AND instructor_id = _instructor;
  IF _cls IS NULL THEN
    INSERT INTO public.classes (instructor_id, code, title, section, description, subject_id, section_id)
    VALUES (_instructor, _sub.code, _sub.name, _sec.name, COALESCE(_sub.description, ''), _subject, _section)
    RETURNING id INTO _cls;
  END IF;

  INSERT INTO public.class_students (class_id, email, full_name, auto)
  SELECT _cls, lower(p.email), p.full_name, true
  FROM public.profiles p
  WHERE p.section_id = _section AND p.email <> '' AND public.has_role(p.id, 'student')
  ON CONFLICT (class_id, email) DO NOTHING;
  RETURN _cls;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ensure_schedule_class(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_schedule_class()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ensure_schedule_class(NEW.subject_id, NEW.section_id, NEW.instructor_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS schedule_class ON public.instructor_schedules;
CREATE TRIGGER schedule_class AFTER INSERT OR UPDATE OF subject_id, section_id, instructor_id ON public.instructor_schedules
  FOR EACH ROW EXECUTE FUNCTION public.trg_schedule_class();

/* A student's section decides their automatic classes. */
CREATE OR REPLACE FUNCTION public.sync_student_section_classes(_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _p public.profiles;
BEGIN
  SELECT * INTO _p FROM public.profiles WHERE id = _user;
  IF _p.id IS NULL OR _p.email = '' THEN RETURN; END IF;
  -- leave automatic classes of other sections
  DELETE FROM public.class_students cs
  USING public.classes c
  WHERE cs.class_id = c.id AND cs.auto AND lower(cs.email) = lower(_p.email)
    AND c.section_id IS NOT NULL AND c.section_id IS DISTINCT FROM _p.section_id;
  -- join the automatic classes of the current section (students only)
  IF _p.section_id IS NOT NULL AND public.has_role(_p.id, 'student') THEN
    INSERT INTO public.class_students (class_id, email, full_name, auto)
    SELECT c.id, lower(_p.email), _p.full_name, true FROM public.classes c
    WHERE c.section_id = _p.section_id AND c.subject_id IS NOT NULL
    ON CONFLICT (class_id, email) DO NOTHING;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_student_section_classes(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_profile_section_classes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.section_id IS DISTINCT FROM OLD.section_id THEN
    PERFORM public.sync_student_section_classes(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profile_section_classes ON public.profiles;
CREATE TRIGGER profile_section_classes AFTER INSERT OR UPDATE OF section_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_profile_section_classes();

-- The student role is often granted just after the profile is created (sign-up / approval).
CREATE OR REPLACE FUNCTION public.trg_role_section_classes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.sync_student_section_classes(COALESCE(NEW.user_id, OLD.user_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS role_section_classes ON public.user_roles;
CREATE TRIGGER role_section_classes AFTER INSERT OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.trg_role_section_classes();

/* Renames follow. */
CREATE OR REPLACE FUNCTION public.trg_subject_rename_classes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code OR NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.classes SET code = NEW.code, title = NEW.name WHERE subject_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subject_rename_classes ON public.subjects;
CREATE TRIGGER subject_rename_classes AFTER UPDATE ON public.subjects FOR EACH ROW EXECUTE FUNCTION public.trg_subject_rename_classes();

CREATE OR REPLACE FUNCTION public.trg_section_rename_classes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.classes SET section = NEW.name WHERE section_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS section_rename_classes ON public.sections;
CREATE TRIGGER section_rename_classes AFTER UPDATE ON public.sections FOR EACH ROW EXECUTE FUNCTION public.trg_section_rename_classes();

/* Existing schedules get their classes now. */
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT subject_id, section_id, instructor_id FROM public.instructor_schedules LOOP
    PERFORM public.ensure_schedule_class(r.subject_id, r.section_id, r.instructor_id);
  END LOOP;
END $$;
