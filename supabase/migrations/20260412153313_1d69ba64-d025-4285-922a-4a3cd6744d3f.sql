DROP POLICY IF EXISTS "Assignments readable by anon for students" ON assignments;

CREATE POLICY "Assignments readable by anon for students" ON assignments
  FOR SELECT TO anon
  USING (status IN ('aktiv', 'beendet'));