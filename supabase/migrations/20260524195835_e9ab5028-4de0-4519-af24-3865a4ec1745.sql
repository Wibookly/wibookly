
-- 1. integration_health
create table if not exists public.integration_health (
  id uuid primary key default gen_random_uuid(),
  integration_key text not null unique,
  status text not null check (status in ('healthy','warning','failed','idle')),
  last_checked_at timestamptz not null default now(),
  latency_ms integer,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2. integration_settings
create table if not exists public.integration_settings (
  id uuid primary key default gen_random_uuid(),
  integration_key text not null,
  setting_key text not null,
  setting_value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique(integration_key, setting_key)
);

-- 3. system_flags
create table if not exists public.system_flags (
  flag_key text primary key,
  flag_value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

-- RLS
alter table public.integration_health enable row level security;
alter table public.integration_settings enable row level security;
alter table public.system_flags enable row level security;

create policy "integration_health admin read"
  on public.integration_health for select to authenticated
  using (has_role(auth.uid(), 'admin'::app_role));
create policy "integration_health admin write"
  on public.integration_health for all to authenticated
  using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));

create policy "integration_settings admin read"
  on public.integration_settings for select to authenticated
  using (has_role(auth.uid(), 'admin'::app_role));
create policy "integration_settings admin write"
  on public.integration_settings for all to authenticated
  using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));

create policy "system_flags admin read"
  on public.system_flags for select to authenticated
  using (has_role(auth.uid(), 'admin'::app_role));
create policy "system_flags admin write"
  on public.system_flags for all to authenticated
  using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));

-- updated_at trigger
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_integration_health_touch on public.integration_health;
create trigger trg_integration_health_touch before update on public.integration_health
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_integration_settings_touch on public.integration_settings;
create trigger trg_integration_settings_touch before update on public.integration_settings
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_system_flags_touch on public.system_flags;
create trigger trg_system_flags_touch before update on public.system_flags
  for each row execute function public.touch_updated_at();

-- Realtime
alter publication supabase_realtime add table public.integration_health;

-- Seed
insert into public.integration_health (integration_key, status, message) values
  ('microsoft', 'idle', 'Not yet probed'),
  ('ms-sso', 'idle', 'Not yet probed'),
  ('ms-oauth', 'idle', 'Not yet probed'),
  ('ms-admin-consent', 'idle', 'Not yet probed'),
  ('outlook-mail', 'idle', 'Not yet probed'),
  ('calendar', 'idle', 'Not yet probed'),
  ('onedrive', 'idle', 'Not yet probed'),
  ('sharepoint', 'idle', 'Not yet probed'),
  ('teams-graph', 'idle', 'Not yet probed'),
  ('graph-webhooks', 'idle', 'Not yet probed'),
  ('teams-bot', 'idle', 'Not yet probed'),
  ('google', 'idle', 'Stub — no production callers'),
  ('g-oauth', 'idle', 'Stub'),
  ('g-gmail', 'idle', 'Stub'),
  ('g-calendar', 'idle', 'Stub'),
  ('g-drive', 'idle', 'Stub'),
  ('llm-gateway', 'idle', 'Not yet probed'),
  ('openai', 'idle', 'Not yet probed'),
  ('openai-chat', 'idle', 'Not yet probed'),
  ('openai-embed', 'idle', 'Not yet probed'),
  ('openai-whisper', 'idle', 'Not yet probed'),
  ('anthropic', 'idle', 'Not yet probed'),
  ('anthropic-claude', 'idle', 'Not yet probed'),
  ('lovable-ai', 'idle', 'Not yet probed'),
  ('lovable-gemini', 'idle', 'Not yet probed'),
  ('deepgram', 'idle', 'Not yet probed'),
  ('deepgram-nova3', 'idle', 'Not yet probed'),
  ('supabase', 'idle', 'Not yet probed'),
  ('sb-auth', 'idle', 'Not yet probed'),
  ('sb-storage', 'idle', 'Not yet probed'),
  ('sb-realtime', 'idle', 'Not yet probed'),
  ('sb-cron', 'idle', 'Not yet probed'),
  ('sb-pgmq', 'idle', 'Not yet probed'),
  ('lovable-email', 'idle', 'Not yet probed'),
  ('lovable-email-tx', 'idle', 'Not yet probed'),
  ('feat-ai-email-agent', 'idle', 'Composite feature'),
  ('feat-meeting-copilot', 'idle', 'Composite feature'),
  ('feat-ai-chat', 'idle', 'Composite feature'),
  ('feat-daily-brief', 'idle', 'Composite feature'),
  ('feat-rag', 'idle', 'Composite feature')
on conflict (integration_key) do nothing;
