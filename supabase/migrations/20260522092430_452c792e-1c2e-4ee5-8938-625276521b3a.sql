DROP FUNCTION IF EXISTS public.get_assignment_for_student(integer);

CREATE OR REPLACE FUNCTION public.get_assignment_for_student(_assignment_id integer)
RETURNS SETOF public.assignments
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.assignments%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.assignments
  WHERE id = _assignment_id
    AND status = ANY(ARRAY['aktiv','beendet']);
  IF NOT FOUND THEN RETURN; END IF;

  v_row.question_data := (
    SELECT jsonb_agg(
      CASE
        WHEN q->>'type' = 'task' THEN
          (q - 'correctAnswer' - 'correctAnswers') ||
          CASE WHEN q->'questions' IS NOT NULL THEN
            jsonb_build_object('questions',
              (SELECT jsonb_agg(sq - 'correctAnswer' - 'correctAnswers')
               FROM jsonb_array_elements(q->'questions') sq))
          ELSE '{}'::jsonb END
        WHEN q->>'type' = 'section' THEN
          (q - 'correctAnswer' - 'correctAnswers') ||
          CASE WHEN q->'tasks' IS NOT NULL THEN
            jsonb_build_object('tasks',
              (SELECT jsonb_agg(
                t - 'correctAnswer' - 'correctAnswers' ||
                CASE WHEN t->'questions' IS NOT NULL THEN
                  jsonb_build_object('questions',
                    (SELECT jsonb_agg(sq - 'correctAnswer' - 'correctAnswers')
                     FROM jsonb_array_elements(t->'questions') sq))
                ELSE '{}'::jsonb END
              ) FROM jsonb_array_elements(q->'tasks') t))
          ELSE '{}'::jsonb END
        ELSE q - 'correctAnswer' - 'correctAnswers'
      END
    ) FROM jsonb_array_elements(v_row.question_data) q
  );

  RETURN NEXT v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.get_assignment_for_student(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_assignment_for_student(integer) TO anon, authenticated;