-- 1. Profiles Table (Persistent Clinical Profile)
CREATE TABLE public.profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  age INTEGER NOT NULL,
  height_cm NUMERIC NOT NULL,
  hashimoto_diagnosed BOOLEAN DEFAULT FALSE,
  thyroidectomy_status TEXT CHECK (thyroidectomy_status IN ('none', 'partial', 'total')) DEFAULT 'none',
  has_cardiac_disease BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Lab Logs Table (Dynamic Serial Observations)
CREATE TABLE public.lab_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  test_date DATE NOT NULL DEFAULT CURRENT_DATE,
  weight_kg NUMERIC NOT NULL,
  waist_cm NUMERIC,
  dexa_lbm_kg NUMERIC,
  dose_administered_mcg NUMERIC NOT NULL,
  tsh NUMERIC NOT NULL,
  free_t4 NUMERIC NOT NULL,
  free_t3 NUMERIC NOT NULL,
  anti_tpo NUMERIC,
  anti_tg NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own profile" ON public.profiles FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users access own lab logs" ON public.lab_logs FOR ALL USING (auth.uid() = user_id);