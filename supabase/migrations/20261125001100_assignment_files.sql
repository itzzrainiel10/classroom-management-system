-- File attachments on assignments (handouts, instructions, templates).
-- Files live in the private "assignment-files" bucket at  <class_id>/<assignment_id>/<file>.
-- Upload/delete: the class's instructor. Download: that instructor, students enrolled in the class, administrators.

ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.assignments DROP CONSTRAINT IF EXISTS assignments_attachments_array;
ALTER TABLE public.assignments ADD CONSTRAINT assignments_attachments_array CHECK (jsonb_typeof(attachments) = 'array');

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'assignment-files', 'assignment-files', false, 26214400, -- 25 MB per file
  ARRAY[
    'application/pdf',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif',
    'application/zip', 'application/x-zip-compressed'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- The class id is the first folder of the file path; NULL (never a match) if it isn't a UUID.
CREATE OR REPLACE FUNCTION public.assignment_file_class(_name text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN split_part(_name, '/', 1)::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

DROP POLICY IF EXISTS "Instructors upload assignment files" ON storage.objects;
CREATE POLICY "Instructors upload assignment files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'assignment-files' AND public.is_class_instructor(public.assignment_file_class(name)));

DROP POLICY IF EXISTS "Instructors delete assignment files" ON storage.objects;
CREATE POLICY "Instructors delete assignment files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'assignment-files' AND public.is_class_instructor(public.assignment_file_class(name)));

DROP POLICY IF EXISTS "Class members read assignment files" ON storage.objects;
CREATE POLICY "Class members read assignment files" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'assignment-files' AND (
      public.is_class_instructor(public.assignment_file_class(name))
      OR public.is_class_student(public.assignment_file_class(name))
      OR public.is_admin()
    )
  );
