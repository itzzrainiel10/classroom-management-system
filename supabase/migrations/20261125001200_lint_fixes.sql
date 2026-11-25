-- Database health check (lint) fix: score_response calls helpers that the planner treats as STABLE,
-- so it must not claim to be IMMUTABLE. Behaviour and results are unchanged.
ALTER FUNCTION public.score_response(text, integer, integer, jsonb, jsonb) STABLE;
