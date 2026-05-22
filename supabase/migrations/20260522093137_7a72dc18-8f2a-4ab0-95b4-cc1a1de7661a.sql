CREATE OR REPLACE FUNCTION public.get_assignment_status(_assignment_id integer)
RETURNS TABLE(
  id integer, status text, timing_mode text, time_limit integer,
  lobby_started_at timestamptz, lobby_end_at timestamptz,
  paused_at timestamptz, require_seb boolean, anti_cheat boolean,
  window_start timestamptz, window_end timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, status, timing_mode, time_limit,
         lobby_started_at, lobby_end_at, paused_at,
         require_seb, anti_cheat, window_start, window_end
  FROM public.assignments
  WHERE id = _assignment_id
    AND status = ANY(ARRAY['aktiv','beendet']);
$$;
REVOKE ALL ON FUNCTION public.get_assignment_status(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_assignment_status(integer) TO anon, authenticated;