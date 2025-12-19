-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- USERS Table
create table public.users (
  id uuid primary key default uuid_generate_v4(),
  figma_id text unique not null,
  email text,
  full_name text,
  avatar_url text,
  role text default 'FREE' check (role in ('FREE', 'TRIAL', 'PAID', 'ADMIN')),
  subscription_expiry timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  access_token text,
  refresh_token text
);

-- AUDIT LOGS Table
create table public.audit_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id),
  action text not null,
  details jsonb,
  created_at timestamptz default now()
);

-- RLS Policies (Row Level Security)
alter table public.users enable row level security;

-- Allow users to read their own data
create policy "Users can read own data" 
  on public.users for select 
  using (auth.uid() = id);

-- Service role (backend) has full access (implicit)

-- AUTH CODES Table (For Polling Strategy)
create table public.auth_codes (
  code text primary key,
  user_id uuid references public.users(id),
  created_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '5 minutes')
);

ALTER TABLE public.users 
ADD COLUMN access_token text,
ADD COLUMN refresh_token text;