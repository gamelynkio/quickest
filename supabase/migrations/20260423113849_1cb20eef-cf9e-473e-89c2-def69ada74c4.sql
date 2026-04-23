CREATE POLICY "Service role can read all profiles"
ON public.profiles FOR SELECT
USING (true);