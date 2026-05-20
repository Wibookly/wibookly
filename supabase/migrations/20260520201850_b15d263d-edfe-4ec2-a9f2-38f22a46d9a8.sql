
create table if not exists public.tool_diagnostics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  organization_id uuid,
  connection_id uuid,
  conversation_id uuid,
  tool text not null,
  status text not null,
  error_kind text,
  error_message text,
  duration_ms integer,
  created_at timestamptz not null default now()
);
create index if not exists idx_tool_diagnostics_user_created on public.tool_diagnostics(user_id, created_at desc);
create index if not exists idx_tool_diagnostics_tool_kind on public.tool_diagnostics(tool, error_kind, created_at desc);
alter table public.tool_diagnostics enable row level security;

drop policy if exists "Users read own tool_diagnostics" on public.tool_diagnostics;
create policy "Users read own tool_diagnostics" on public.tool_diagnostics
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "Admins read all tool_diagnostics" on public.tool_diagnostics;
create policy "Admins read all tool_diagnostics" on public.tool_diagnostics
  for select to authenticated using (public.has_role(auth.uid(), 'admin'::app_role));

create table if not exists public.extraction_regression_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  connection_id uuid,
  source_type text not null,
  external_id text,
  file_name text,
  status text not null,
  error_kind text,
  error_message text,
  duration_ms integer,
  created_at timestamptz not null default now()
);
create index if not exists idx_extraction_regression_created on public.extraction_regression_log(created_at desc);
alter table public.extraction_regression_log enable row level security;

drop policy if exists "Users read own regression log" on public.extraction_regression_log;
create policy "Users read own regression log" on public.extraction_regression_log
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "Admins read all regression log" on public.extraction_regression_log;
create policy "Admins read all regression log" on public.extraction_regression_log
  for select to authenticated using (public.has_role(auth.uid(), 'admin'::app_role));
