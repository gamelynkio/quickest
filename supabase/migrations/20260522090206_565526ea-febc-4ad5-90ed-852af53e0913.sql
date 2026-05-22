CREATE OR REPLACE FUNCTION public.student_login(_username text, _pin text)
RETURNS TABLE(id bigint, username text, group_id bigint, group_name text, group_subject text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id::bigint, s.username, s.group_id::bigint, g.name, g.subject
  FROM students s
  JOIN groups g ON g.id = s.group_id
  WHERE lower(s.username) = lower(_username)
    AND s.pin::text = _pin::text
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.student_login(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.student_login(text,text) TO anon, authenticated;