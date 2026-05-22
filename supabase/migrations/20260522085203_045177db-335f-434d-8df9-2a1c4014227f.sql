-- 1) profiles
DROP POLICY IF EXISTS "Service role can read all profiles" ON public.profiles;

-- 2) submissions: drop public select
DROP POLICY IF EXISTS "Anyone can read submissions" ON public.submissions;

-- 3) submissions anon update restriction
DROP POLICY IF EXISTS "allow_anon_correction_requests" ON public.submissions;

CREATE OR REPLACE FUNCTION public.enforce_anon_submission_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'anon' THEN
    IF NEW.score IS DISTINCT FROM OLD.score
       OR NEW.grade IS DISTINCT FROM OLD.grade
       OR NEW.answers IS DISTINCT FROM OLD.answers
       OR NEW.cheat_log IS DISTINCT FROM OLD.cheat_log
       OR NEW.ai_corrections IS DISTINCT FROM OLD.ai_corrections
       OR NEW.manual_overrides IS DISTINCT FROM OLD.manual_overrides
       OR NEW.released IS DISTINCT FROM OLD.released
       OR NEW.reviewed IS DISTINCT FROM OLD.reviewed
       OR NEW.total_points IS DISTINCT FROM OLD.total_points
       OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id
       OR NEW.student_id IS DISTINCT FROM OLD.student_id
       OR NEW.username IS DISTINCT FROM OLD.username
       OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
      RAISE EXCEPTION 'Anon users may only modify correction_requests';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_anon_submission_update ON public.submissions;
CREATE TRIGGER trg_enforce_anon_submission_update
BEFORE UPDATE ON public.submissions
FOR EACH ROW EXECUTE FUNCTION public.enforce_anon_submission_update();

CREATE POLICY "Anon can update only correction_requests"
ON public.submissions
FOR UPDATE
TO anon
USING (true)
WITH CHECK (true);

-- 4) students
DROP POLICY IF EXISTS "Students readable by anon for login" ON public.students;

-- 5) groups
DROP POLICY IF EXISTS "Groups readable by anon for student login" ON public.groups;

-- 6) assignments
DROP POLICY IF EXISTS "Assignments readable by anon for students" ON public.assignments;

CREATE OR REPLACE FUNCTION public.get_assignment_for_student(_assignment_id integer)
RETURNS TABLE (
  id integer,
  title text,
  group_id integer,
  status text,
  timing_mode text,
  time_limit integer,
  anti_cheat boolean,
  require_seb boolean,
  grading_scale jsonb,
  detected_rules jsonb,
  custom_rules text,
  window_start timestamptz,
  window_end timestamptz,
  lobby_started_at timestamptz,
  lobby_end_at timestamptz,
  paused_at timestamptz,
  question_data jsonb,
  makeup_usernames text[],
  parent_assignment_id integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id, a.title, a.group_id, a.status, a.timing_mode, a.time_limit,
    a.anti_cheat, a.require_seb, a.grading_scale, a.detected_rules, a.custom_rules,
    a.window_start, a.window_end, a.lobby_started_at, a.lobby_end_at, a.paused_at,
    (
      SELECT jsonb_agg(
        (q - 'correctAnswer' - 'correct_answer' - 'solution' - 'answer' - 'expectedAnswer')
      )
      FROM jsonb_array_elements(a.question_data) q
    ) AS question_data,
    a.makeup_usernames, a.parent_assignment_id
  FROM public.assignments a
  WHERE a.id = _assignment_id
    AND a.status = ANY (ARRAY['aktiv','beendet']);
END;
$$;

REVOKE ALL ON FUNCTION public.get_assignment_for_student(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_assignment_for_student(integer) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_active_assignments_for_group(_group_id integer)
RETURNS TABLE (
  id integer, title text, status text, timing_mode text, time_limit integer,
  require_seb boolean, window_start timestamptz, window_end timestamptz,
  lobby_started_at timestamptz, lobby_end_at timestamptz, paused_at timestamptz,
  makeup_usernames text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, title, status, timing_mode, time_limit, require_seb,
         window_start, window_end, lobby_started_at, lobby_end_at, paused_at,
         makeup_usernames
  FROM public.assignments
  WHERE group_id = _group_id AND status = ANY (ARRAY['aktiv','beendet']);
$$;

REVOKE ALL ON FUNCTION public.list_active_assignments_for_group(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_active_assignments_for_group(integer) TO anon, authenticated;

-- 7) lobby_presence
DROP POLICY IF EXISTS "Anyone can delete lobby presence" ON public.lobby_presence;
DROP POLICY IF EXISTS "Anyone can update lobby presence" ON public.lobby_presence;

CREATE OR REPLACE FUNCTION public.lobby_heartbeat(_assignment_id integer, _username text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.lobby_presence
     SET last_seen = now()
   WHERE assignment_id = _assignment_id AND username = _username;
$$;

CREATE OR REPLACE FUNCTION public.lobby_leave(_assignment_id integer, _username text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.lobby_presence
   WHERE assignment_id = _assignment_id AND username = _username;
$$;

REVOKE ALL ON FUNCTION public.lobby_heartbeat(integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lobby_leave(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lobby_heartbeat(integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lobby_leave(integer, text) TO anon, authenticated;

CREATE POLICY "Teachers manage lobby presence for own assignments"
ON public.lobby_presence
FOR ALL
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.assignments a
  WHERE a.id = lobby_presence.assignment_id AND a.teacher_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.assignments a
  WHERE a.id = lobby_presence.assignment_id AND a.teacher_id = auth.uid()
));

-- 8) get_student_submission RPC
CREATE OR REPLACE FUNCTION public.get_student_submission(
  _assignment_id integer, _username text, _pin text
)
RETURNS SETOF public.submissions
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.username = _username AND s.pin = _pin
  ) THEN
    RAISE EXCEPTION 'Invalid credentials';
  END IF;

  RETURN QUERY
  SELECT * FROM public.submissions
  WHERE assignment_id = _assignment_id
    AND username = _username
    AND released = true;
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_submission(integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_submission(integer, text, text) TO anon, authenticated;

-- 9) Storage test-media DELETE
DROP POLICY IF EXISTS "Authenticated users can delete" ON storage.objects;

CREATE POLICY "Owners can delete own test-media files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'test-media'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 10) SECURITY DEFINER function privileges
REVOKE ALL ON FUNCTION public.get_server_time() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_server_time() TO anon, authenticated;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'student_login'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.student_login(text, text) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.student_login(text, text) TO anon, authenticated';
  END IF;
END $$;