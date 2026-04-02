ALTER TABLE templates ADD COLUMN IF NOT EXISTS share_active boolean DEFAULT false;
DROP POLICY "Anyone can read shared templates" ON templates;
CREATE POLICY "Anyone can read shared templates" ON templates FOR SELECT USING (share_active = true AND share_token IS NOT NULL);