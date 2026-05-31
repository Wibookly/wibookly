## Goal

Three connected pieces in the Admin Dashboard:

1. **User Activity report** — admins see per-user AI usage with filters, charts, and export
2. **Department data** — pull `department` from Microsoft 365 onto each user so reports can group by department
3. **Multi-tier admin roles** — Super Admin (you), Org Admin, Department Admin — each scoped to what they can see

---

## 1. Roles model

Add a new app-level role enum used across the admin UI:

- `super_admin` — `arahimi@energyforward.com` (existing bypass stays)
- `org_admin` — full visibility across one organization (today's hardcoded "admin")
- `dept_admin` — visibility restricted to one or more departments inside an org
- `member` — regular user

Database changes (migration, separate step for approval):

- Extend `app_role` enum with `org_admin`, `dept_admin` (keep `admin`, `member` as aliases for back-compat)
- Add `user_roles.department` (text, nullable) so a `dept_admin` row can point to one department; allow multiple rows per user for users who admin multiple departments
- Helper RPCs (SECURITY DEFINER):
  - `is_org_admin(_user, _org)` 
  - `is_dept_admin(_user, _org, _dept)`
  - `admin_visible_user_ids(_user)` — returns the set of `user_id`s the caller may report on (super → all, org_admin → their org, dept_admin → their dept(s))

All new admin reporting RPCs gate on `admin_visible_user_ids` so a department admin can never read outside their scope.

---

## 2. Department sync from Microsoft 365

- Add `user_profiles.department` (text, nullable) and `user_profiles.job_title_m365` (text, nullable) — kept separate from the user-edited `title`
- Extend the existing M365 user discovery edge function to request `department,jobTitle,officeLocation` via Graph `/users?$select=...`
- On every discovery / re-sync, upsert `department` onto `user_profiles` matched by email
- Backfill: re-run discovery once after deploy so existing users get a department

For users that never log in via M365 (e.g. Google accounts), the admin UI exposes a small inline editor on the Users tab to set department manually.

---

## 3. User Activity report (new Admin tab)

New tab in `/admin` → **Activity**. Source of truth is the existing `ai_usage_logs` table (already tracks `user_id`, `action`, `tokens_in/out`, `cost_usd`, `created_at`, model, provider).

UI layout:

```text
┌──────────────────────────────────────────────────────────┐
│ Filters: [Date range ▾]  [Department ▾]  [User ▾]  [Export CSV] │
├──────────────────────────────────────────────────────────┤
│  KPI strip: Active users · Total actions · Tokens · $   │
├──────────────────────────────────────────────────────────┤
│  Chart 1: Activity over time (stacked area by action)   │
│  Chart 2: Top 10 users (bar)                            │
│  Chart 3: Breakdown by feature (donut)                  │
├──────────────────────────────────────────────────────────┤
│  Per-user table:                                         │
│   User · Dept · Drafts · Auto-replies · Chats · Briefs   │
│   · Emails sent · Tokens · Cost · Last active            │
└──────────────────────────────────────────────────────────┘
```

Features tracked (mapped from `ai_usage_logs.action`):
- `ai_draft` → AI drafts created
- `ai_auto_reply` → auto-replies sent
- `ai_chat` → chat messages
- `daily_brief` → daily briefs generated
- `email_agent`, `meeting_copilot`, `follow_up_reminder` → counted separately

Date filter presets: Today, 7 days, 14 days, 30 days, Custom range.

Department filter is populated from distinct `user_profiles.department` values the caller can see.

Export: server-side RPC returns CSV of the filtered, scoped rows so a dept admin's export only contains their department.

Charts: Recharts (already used in the project — `src/components/charts/`).

---

## 4. Role management UI

New section in `/admin` → **Roles**:

- Table of all users in the org with current role(s) and department(s)
- Inline assign: Org Admin / Dept Admin (+ department picker) / Member
- Only `super_admin` can grant `org_admin`
- `org_admin` can grant `dept_admin` within their org
- Last-admin protection (already enforced by `check_last_admin_role` trigger) stays

---

## Technical notes

- All new tables/columns get explicit `GRANT`s and RLS scoped to `auth.uid()` via the new helper RPCs
- Reporting RPCs return aggregates only; never expose raw row data outside the caller's scope
- Existing super-admin bypass (`is_super_admin`) is preserved everywhere
- Charts use the existing Recharts setup; no new deps
- CSV export is generated in an edge function so we don't pull large datasets into the browser

---

## Build order (separate PRs/turns)

1. Migration: extend `app_role`, add `user_roles.department`, add `user_profiles.department`/`job_title_m365`, helper RPCs, reporting RPCs
2. Edge function: extend M365 discovery to sync department, add `activity-report-export` for CSV
3. Frontend: Admin → **Activity** tab (filters, KPIs, charts, table, export)
4. Frontend: Admin → **Roles** tab (assign org/dept admin)
5. Backfill department via one-shot re-discovery

---

## Questions before I start

1. **Department source of truth** — should I overwrite `department` on every M365 re-sync, or only fill it in when blank (so admins can manually correct it)?
2. **Dept Admin scope** — should a dept admin see *only* their department, or their department + any sub-departments / multiple departments they're assigned to? (Plan currently supports multiple.)
3. **Export format** — CSV only, or also XLSX?
4. **"Auto-sent" emails** — you mentioned tracking auto-sent emails. Per the project constraint *AI drafts must NOT auto-send*, the only auto-send path today is `ai_auto_reply`. Confirm that's what you want counted, or are you tracking something else (e.g. drafts the user later sent manually)?
