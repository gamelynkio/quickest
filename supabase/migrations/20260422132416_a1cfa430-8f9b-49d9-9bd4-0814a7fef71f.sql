CREATE POLICY "Authenticated can read students" ON students 
FOR SELECT TO authenticated 
USING (true);