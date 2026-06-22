-- =========================================================
-- The Career Architect — database schema
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query).
-- Safe to re-run: uses "if not exists" / "drop policy if exists".
-- =========================================================

-- ---------- Agent (recruiter) profiles ----------
create table if not exists public.agent_profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  company     text,
  email       text,
  website     text,
  about       text,
  verified    boolean not null default false,  -- flipped true by an admin once vetted
  created_at  timestamptz not null default now()
);

-- ---------- Job listings ----------
create table if not exists public.jobs (
  id              uuid primary key default gen_random_uuid(),
  agent_id        uuid not null references auth.users(id) on delete cascade,
  title           text not null,
  company         text not null,
  location        text,
  work_mode       text,            -- Remote | Hybrid | On-site
  employment_type text,            -- Full-time | Contract | Part-time | Internship
  category        text,            -- Engineering | Data | Design | Marketing | ...
  experience      text,            -- Entry | Mid | Senior | Lead
  salary_min      integer,
  salary_max      integer,
  salary_currency text default 'USD',
  visa_sponsorship boolean default false,
  description     text not null,
  apply_url       text,
  status          text not null default 'published',  -- published | draft | closed
  created_at      timestamptz not null default now()
);

create index if not exists jobs_status_created_idx on public.jobs (status, created_at desc);
create index if not exists jobs_agent_idx on public.jobs (agent_id);

-- ---------- Row Level Security ----------
alter table public.agent_profiles enable row level security;
alter table public.jobs           enable row level security;

-- Profiles: anyone can read (so the job board can show employer name/verified),
-- but you can only create/edit YOUR OWN profile row.
drop policy if exists "profiles read"   on public.agent_profiles;
drop policy if exists "profiles insert" on public.agent_profiles;
drop policy if exists "profiles update" on public.agent_profiles;
create policy "profiles read"   on public.agent_profiles for select using (true);
create policy "profiles insert" on public.agent_profiles for insert with check (auth.uid() = id);
create policy "profiles update" on public.agent_profiles for update using (auth.uid() = id);

-- Jobs: anyone can read PUBLISHED jobs; agents manage only their own.
drop policy if exists "jobs public read"  on public.jobs;
drop policy if exists "jobs owner read"   on public.jobs;
drop policy if exists "jobs insert"       on public.jobs;
drop policy if exists "jobs update"       on public.jobs;
drop policy if exists "jobs delete"       on public.jobs;
create policy "jobs public read" on public.jobs for select using (status = 'published');
create policy "jobs owner read"  on public.jobs for select using (auth.uid() = agent_id);
create policy "jobs insert"      on public.jobs for insert with check (auth.uid() = agent_id);
create policy "jobs update"      on public.jobs for update using (auth.uid() = agent_id);
create policy "jobs delete"      on public.jobs for delete using (auth.uid() = agent_id);

-- ---------- Convenience view: jobs joined with verified employer flag ----------
-- security_invoker = on → the view respects the caller's RLS (so it only ever
-- returns published jobs to the public, matching the policy above).
create or replace view public.jobs_public with (security_invoker = on) as
  select j.*, p.verified as employer_verified, p.company as employer_company, p.website as employer_website
  from public.jobs j
  left join public.agent_profiles p on p.id = j.agent_id
  where j.status = 'published';

-- Make sure the browser (anon) and signed-in recruiters can read the view.
grant select on public.jobs_public to anon, authenticated;

-- ---------- Admins ----------
create table if not exists public.admins (
  id          uuid primary key references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.admins enable row level security;
drop policy if exists "admins self read" on public.admins;
create policy "admins self read" on public.admins for select using (auth.uid() = id);

-- Helper: is the current user an admin? (security definer so it can read admins under RLS)
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.admins where id = auth.uid());
$$;

-- Admins can verify recruiters and moderate any job.
drop policy if exists "profiles admin update" on public.agent_profiles;
create policy "profiles admin update" on public.agent_profiles for update using (public.is_admin());
drop policy if exists "jobs admin all" on public.jobs;
create policy "jobs admin all" on public.jobs for all using (public.is_admin()) with check (public.is_admin());

-- ---------- Assessment submissions (admin-visible) ----------
create table if not exists public.assessments (
  id          uuid primary key default gen_random_uuid(),
  full_name   text,
  email       text,
  field       text,
  data        jsonb,
  created_at  timestamptz not null default now()
);
alter table public.assessments enable row level security;
drop policy if exists "assessments admin read" on public.assessments;
create policy "assessments admin read" on public.assessments for select using (public.is_admin());
-- (inserts come from the server via the service role, which bypasses RLS)

-- ---------- AI knowledge library ----------
-- Structured knowledge extracted from every resume/assessment. The more rows,
-- the richer the context fed back to the AI tools. Written by the server
-- (service role); readable by admins.
create table if not exists public.knowledge_library (
  id          uuid primary key default gen_random_uuid(),
  source_type text not null,           -- resume | assessment | job
  title       text,
  summary     text,
  extraction  jsonb,
  tags        text[],
  created_at  timestamptz not null default now()
);
create index if not exists knowledge_created_idx on public.knowledge_library (created_at desc);
create index if not exists knowledge_tags_idx on public.knowledge_library using gin (tags);
alter table public.knowledge_library enable row level security;
drop policy if exists "knowledge admin read" on public.knowledge_library;
create policy "knowledge admin read" on public.knowledge_library for select using (public.is_admin());

-- ---------- Bootstrap your first admin ----------
-- After you sign up (via admin.html or agent.html), run THIS with your email to
-- grant yourself admin (run it as the postgres role in the SQL editor):
--   insert into public.admins (id) select id from auth.users where email = 'you@example.com';
