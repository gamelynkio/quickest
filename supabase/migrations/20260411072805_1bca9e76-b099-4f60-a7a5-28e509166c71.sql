ALTER TABLE templates ADD COLUMN IF NOT EXISTS grading_mode text DEFAULT 'standard';
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS grading_mode text DEFAULT 'standard';