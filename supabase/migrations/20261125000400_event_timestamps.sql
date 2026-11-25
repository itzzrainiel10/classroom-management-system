-- Several notifications / log rows can be written in one transaction (e.g. a schedule change notifies a
-- whole section); clock_timestamp() keeps their order exact, unlike now() which is fixed per transaction.
ALTER TABLE public.notifications ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE public.activity_log ALTER COLUMN created_at SET DEFAULT clock_timestamp();
