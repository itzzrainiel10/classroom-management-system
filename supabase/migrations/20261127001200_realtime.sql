-- Live updates for the mobile app: Supabase Realtime sends a change event for these tables
-- (only for rows each person is allowed to see — row-level security still applies), and the app
-- quietly refreshes the open screen.
DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'semesters', 'renewals', 'sections', 'classes', 'class_students', 'class_schedules', 'instructor_schedules',
    'quizzes', 'quiz_attempts', 'assignments', 'announcements', 'attendance_sessions', 'attendance_records',
    'notifications', 'profiles', 'instructor_profiles'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
