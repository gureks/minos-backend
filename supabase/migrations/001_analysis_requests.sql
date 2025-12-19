-- ANALYSIS REQUESTS Table
-- Stores detailed logs of every LLM analysis request
create table public.analysis_requests (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id),
  file_key text not null,
  comment_id text not null,
  comment_text text not null,
  node_id text,
  node_image text,             -- Base64 optimized string
  llm_response text,
  metadata jsonb,              -- Extra details: crop coords, timing, raw node props
  status text default 'success',
  error_message text,
  created_at timestamptz default now()
);

-- Index for faster lookups by user or file
create index idx_analysis_user on public.analysis_requests(user_id);
create index idx_analysis_file on public.analysis_requests(file_key);
