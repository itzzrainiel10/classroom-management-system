-- Rooms are either a lecture room or a laboratory (used when scheduling classes).
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS room_type text NOT NULL DEFAULT 'lecture'
  CHECK (room_type IN ('lecture', 'laboratory'));

-- Existing rooms named like "Computer Lab 3" / "Laboratory 2" start as laboratories.
UPDATE public.rooms SET room_type = 'laboratory' WHERE name ~* '\mlab' AND room_type = 'lecture';
