CREATE POLICY "Authenticated users can upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'test-media');

CREATE POLICY "Anyone can read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'test-media');

CREATE POLICY "Authenticated users can delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'test-media');