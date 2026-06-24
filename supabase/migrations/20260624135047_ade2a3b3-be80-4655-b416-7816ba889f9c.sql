
CREATE OR REPLACE FUNCTION public.get_student_context(_username text, _pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_student record;
BEGIN
  SELECT s.id, s.username, s.group_id, g.name AS group_name, g.subject AS group_subject
  INTO v_student
  FROM students s
  JOIN groups g ON g.id = s.group_id
  WHERE lower(s.username) = lower(_username)
    AND (_pin = '' OR s.pin::text = _pin::text)
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
      WHERE lower(s.username) = lower(_username)
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
$function$;
