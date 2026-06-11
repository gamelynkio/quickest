-- ============================================================
-- QuickTest: Saubere Schüler-RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_student_context(_username text, _pin text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student record;
BEGIN
  SELECT s.id, s.username, s.group_id, g.name AS group_name, g.subject AS group_subject
  INTO v_student
  FROM students s
  JOIN groups g ON g.id = s.group_id
  WHERE lower(s.username) = lower(_username) AND s.pin::text = _pin::text
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'invalid_credentials');
  END IF;

  RETURN jsonb_build_object(
    'student', jsonb_build_object(
      'id', v_student.id,
      'username', v_student.username,
      'group_id', v_student.group_id,
      'groups', jsonb_build_object(
        'name', v_student.group_name,
        'subject', v_student.group_subject
      )
    ),
    'assignments', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', a.id,
        'title', a.title,
        'status', a.status,
        'timing_mode', COALESCE(a.timing_mode, 'lobby'),
        'time_limit', a.time_limit,
        'require_seb', a.require_seb,
        'anti_cheat', a.anti_cheat,
        'lobby_started_at', CASE
          WHEN a.lobby_end_at IS NOT NULL AND a.lobby_end_at < now() THEN NULL
          ELSE a.lobby_started_at
        END,
        'lobby_end_at', a.lobby_end_at,
        'paused_at', a.paused_at,
        'window_start', a.window_start,
        'window_end', a.window_end,
        'makeup_usernames', a.makeup_usernames,
        'parent_assignment_id', a.parent_assignment_id,
        'group_id', a.group_id
      )), '[]'::jsonb)
      FROM assignments a
      WHERE a.group_id = v_student.group_id
        AND a.status = 'aktiv'
    ),
    'submissions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'assignment_id', s.assignment_id,
        'username', s.username,
        'score', s.score,
        'total_points', s.total_points,
        'grade', s.grade,
        'released', s.released,
        'submitted_at', s.submitted_at,
        'ai_corrections', s.ai_corrections,
        'answers', s.answers,
        'correction_requests', s.correction_requests,
        'not_participated', s.not_participated
      )), '[]'::jsonb)
      FROM submissions s
      JOIN assignments a ON a.id = s.assignment_id
      WHERE lower(s.username) = lower(_username)
        AND a.group_id = v_student.group_id
    ),
    'all_group_assignments', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', a.id,
        'title', a.title,
        'parent_assignment_id', a.parent_assignment_id
      )), '[]'::jsonb)
      FROM assignments a
      WHERE a.group_id = v_student.group_id
        AND a.parent_assignment_id IS NOT NULL
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_context(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_context(text, text) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.lobby_action(
  _username text,
  _pin text,
  _assignment_id integer,
  _action text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM students WHERE lower(username) = lower(_username) AND pin::text = _pin::text
  ) THEN RETURN false; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM assignments WHERE id = _assignment_id AND status = 'aktiv'
  ) THEN RETURN false; END IF;

  IF _action = 'join' THEN
    INSERT INTO lobby_presence(assignment_id, username, last_seen)
    VALUES (_assignment_id, _username, now())
    ON CONFLICT (assignment_id, username) DO UPDATE SET last_seen = now();

  ELSIF _action = 'heartbeat' THEN
    UPDATE lobby_presence
    SET last_seen = now()
    WHERE assignment_id = _assignment_id AND lower(username) = lower(_username);

  ELSIF _action = 'leave' THEN
    DELETE FROM lobby_presence
    WHERE assignment_id = _assignment_id AND lower(username) = lower(_username);
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.lobby_action(text, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lobby_action(text, text, integer, text) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.get_assignment_status(_assignment_id integer)
RETURNS TABLE(
  id integer, status text, timing_mode text, time_limit integer,
  lobby_started_at timestamptz, lobby_end_at timestamptz,
  paused_at timestamptz, require_seb boolean, anti_cheat boolean,
  window_start timestamptz, window_end timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    a.id, a.status, COALESCE(a.timing_mode, 'lobby'), a.time_limit,
    CASE WHEN a.lobby_end_at IS NOT NULL AND a.lobby_end_at < now() THEN NULL
         ELSE a.lobby_started_at END,
    a.lobby_end_at, a.paused_at, a.require_seb, a.anti_cheat,
    a.window_start, a.window_end
  FROM assignments a
  WHERE a.id = _assignment_id;
$$;

REVOKE ALL ON FUNCTION public.get_assignment_status(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_assignment_status(integer) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.get_assignment_for_student(_assignment_id integer)
RETURNS SETOF public.assignments
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.assignments%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM assignments
  WHERE id = _assignment_id
    AND status = ANY(ARRAY['aktiv','beendet']);
  IF NOT FOUND THEN RETURN; END IF;

  v_row.question_data := (
    SELECT COALESCE(jsonb_agg(
      CASE q->>'type'
        WHEN 'task' THEN
          (q - 'correctAnswer' - 'correctAnswers' - 'correct_answer') ||
          CASE WHEN q->'questions' IS NOT NULL THEN
            jsonb_build_object('questions',
              (SELECT jsonb_agg(sq - 'correctAnswer' - 'correctAnswers' - 'correct_answer')
               FROM jsonb_array_elements(q->'questions') sq))
          ELSE '{}'::jsonb END
        WHEN 'section' THEN
          (q - 'correctAnswer' - 'correctAnswers' - 'correct_answer') ||
          CASE WHEN q->'tasks' IS NOT NULL THEN
            jsonb_build_object('tasks',
              (SELECT jsonb_agg(
                (t - 'correctAnswer' - 'correctAnswers' - 'correct_answer') ||
                CASE WHEN t->'questions' IS NOT NULL THEN
                  jsonb_build_object('questions',
                    (SELECT jsonb_agg(sq - 'correctAnswer' - 'correctAnswers' - 'correct_answer')
                     FROM jsonb_array_elements(t->'questions') sq))
                ELSE '{}'::jsonb END
              ) FROM jsonb_array_elements(q->'tasks') t))
          ELSE '{}'::jsonb END
        ELSE q - 'correctAnswer' - 'correctAnswers' - 'correct_answer'
      END
    ), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(v_row.question_data, '[]'::jsonb)) q
  );

  RETURN NEXT v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.get_assignment_for_student(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_assignment_for_student(integer) TO anon, authenticated;