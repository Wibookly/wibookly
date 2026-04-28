create table if not exists public.support_issues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  user_email text not null,
  subject text not null,
  description text not null,
  page_url text,
  user_agent text,
  status text not null default 'open',
  admin_notes text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_issues_org_idx on public.support_issues(organization_id, created_at desc);
create index if not exists support_issues_user_idx on public.support_issues(user_id, created_at desc);

alter table public.support_issues enable row level security;

create policy "users insert own issues"
on public.support_issues for insert
to authenticated
with check (
  user_id = auth.uid()
  and organization_id = public.get_user_organization_id(auth.uid())
);

create policy "users view own issues"
on public.support_issues for select
to authenticated
using (user_id = auth.uid());

create policy "admins view org issues"
on public.support_issues for select
to authenticated
using (
  organization_id = public.get_user_organization_id(auth.uid())
  and public.has_role_in_org(auth.uid(), 'admin'::app_role, organization_id)
);

create policy "admins update org issues"
on public.support_issues for update
to authenticated
using (
  organization_id = public.get_user_organization_id(auth.uid())
  and public.has_role_in_org(auth.uid(), 'admin'::app_role, organization_id)
)
with check (
  organization_id = public.get_user_organization_id(auth.uid())
  and public.has_role_in_org(auth.uid(), 'admin'::app_role, organization_id)
);

create trigger support_issues_set_updated_at
before update on public.support_issues
for each row execute function public.update_updated_at_column();