
-- 1) Profiles table (auto-created on signup)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Trigger to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', ''), NEW.email);
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2) Groups table
CREATE TABLE public.groups (
  id SERIAL PRIMARY KEY,
  teacher_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  usernames JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers can manage own groups" ON public.groups FOR ALL TO authenticated USING (auth.uid() = teacher_id) WITH CHECK (auth.uid() = teacher_id);
CREATE POLICY "Groups readable by anon for student login" ON public.groups FOR SELECT TO anon USING (true);

-- 3) Students table (no Supabase auth, custom login)
CREATE TABLE public.students (
  id SERIAL PRIMARY KEY,
  group_id INTEGER REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  username TEXT NOT NULL UNIQUE,
  pin TEXT NOT NULL DEFAULT '1234',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers can manage students via groups" ON public.students FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM public.groups WHERE groups.id = students.group_id AND groups.teacher_id = auth.uid())
);
CREATE POLICY "Students readable by anon for login" ON public.students FOR SELECT TO anon USING (true);

-- 4) Templates table
CREATE TABLE public.templates (
  id SERIAL PRIMARY KEY,
  teacher_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL DEFAULT 'Unbenannte Vorlage',
  description TEXT DEFAULT '',
  subject TEXT DEFAULT '',
  time_limit INTEGER DEFAULT 1200,
  anti_cheat BOOLEAN DEFAULT false,
  question_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  grading_scale JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers can manage own templates" ON public.templates FOR ALL TO authenticated USING (auth.uid() = teacher_id) WITH CHECK (auth.uid() = teacher_id);

-- 5) Assignments table
CREATE TABLE public.assignments (
  id SERIAL PRIMARY KEY,
  template_id INTEGER REFERENCES public.templates(id) ON DELETE SET NULL,
  group_id INTEGER REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  teacher_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'aktiv',
  time_limit INTEGER DEFAULT 1200,
  timing_mode TEXT DEFAULT 'countdown',
  anti_cheat BOOLEAN DEFAULT false,
  question_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  grading_scale JSONB NOT NULL DEFAULT '[]'::jsonb,
  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers can manage own assignments" ON public.assignments FOR ALL TO authenticated USING (auth.uid() = teacher_id) WITH CHECK (auth.uid() = teacher_id);
CREATE POLICY "Assignments readable by anon for students" ON public.assignments FOR SELECT TO anon USING (status = 'aktiv');

-- 6) Submissions table
CREATE TABLE public.submissions (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER REFERENCES public.assignments(id) ON DELETE CASCADE NOT NULL,
  student_id INTEGER REFERENCES public.students(id) ON DELETE CASCADE,
  username TEXT,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  score NUMERIC,
  total_points NUMERIC,
  ai_corrections JSONB DEFAULT '{}'::jsonb,
  manual_overrides JSONB DEFAULT '{}'::jsonb,
  reviewed BOOLEAN DEFAULT false,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers can read submissions for own assignments" ON public.submissions FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM public.assignments WHERE assignments.id = submissions.assignment_id AND assignments.teacher_id = auth.uid())
);
CREATE POLICY "Anon can insert submissions" ON public.submissions FOR INSERT TO anon WITH CHECK (true);
