-- Start and end dates of the current semester. Official schedules repeat weekly between these dates;
-- the mobile app shows them and stops listing classes once the semester has ended.
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS semester_start date,
  ADD COLUMN IF NOT EXISTS semester_end date;
ALTER TABLE public.app_settings DROP CONSTRAINT IF EXISTS app_settings_semester_dates;
ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_semester_dates
  CHECK ((semester_start IS NULL AND semester_end IS NULL) OR (semester_start IS NOT NULL AND semester_end IS NOT NULL AND semester_end > semester_start));
