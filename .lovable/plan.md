# Home Page Redesign — "Glance-First" Executive Home

Rebuild the Home surface (currently `TheHelm`) as a glance-first, modular command center backed by an AI daily digest and per-user widget preferences. Depth stays on dedicated pages — Home only summarizes.

## Scope of change

- New `/home` route rendering the glance-first layout. Existing `TheHelm` page stays untouched (kept as `/helm` fallback for now); the sidebar's Home link points to `/home`.
- New `/brief` page for the full daily brief with a date selector.
- Categories page: add a "Show on home" pin toggle per category (only allowed page-level edit besides router).
- New Cinnamon theme (11th palette) added to `ThemePicker` following existing palette structure.
- New backend: `home_preferences` + `daily_digests` tables, `show_on_home` column on categories, `generate-daily-digest` edge function on pg_cron.

## Database (single migration)

- `public.home_preferences (user_id, org_id, widget_id, enabled, sort_order, item_limit, updated_at)` with unique (user_id, widget_id). RLS: user owns row + org match.
- `public.daily_digests (user_id, org_id, digest_date, urgency_level, headline, subline, narrative, top_priority jsonb, meetings jsonb, commitments jsonb, client_signals jsonb, counts jsonb, full_brief_md, dismissed_at, created_at)` unique (user_id, digest_date). RLS same pattern.
- `alter table public.email_categories add column show_on_home boolean default false` (locate real category table name during implementation — likely `categories`).
- GRANTs to `authenticated` + `service_role` per project conventions.

## Frontend

- `src/config/homeWidgetRegistry.ts` — `CORE_WIDGETS` list per spec plus helper to merge dynamically-pinned categories.
- `src/pages/Home.tsx` — greeting header + `GlanceCard` + ordered sections + "Customize home" dialog at the bottom.
- `src/components/home/` — `GlanceCard`, `HomeSection` wrapper, `NeedsReplyWidget`, `TodayWidget`, `CommitmentsWidget`, `WaitingOnWidget`, `CategoryWidget`, `CustomizeHomeDialog`.
- `src/pages/Brief.tsx` — full brief markdown + date picker reading `daily_digests`.
- `src/pages/Categories.tsx` — add pin toggle (Show on home) that upserts category flag + `home_preferences` row.
- `src/App.tsx` — register `/home`, `/brief`; point Home nav to `/home`.
- All colors via semantic tokens (no hex). Reuse Card, Button, Badge, Avatar, Skeleton, Dialog, Switch. Sentence case, locale timestamps.

## Data + hooks

- `useHomePreferences()` — fetches + seeds defaults from `CORE_WIDGETS` on first load, exposes optimistic toggle mutation.
- `useDailyDigest()` — today's digest row + manual refresh calling the edge function.
- Widgets reuse existing queries:
  - Needs reply → existing tracked/classified emails (`requires_human`, priority score) via existing hook.
  - Today → existing calendar hook used by `TheHelm`.
  - Commitments / Waiting on → existing follow-up tables.
  - Category → filter latest emails by category id.

## Theme: Cinnamon

Extend `src/components/ThemePicker.tsx` and the shared theme CSS with a `cinnamon` palette using HSL tokens per spec. Add a dark variant with dark warm-brown bg + cream fg + preserved cinnamon primary. No hex in components; all values written to CSS variables so every widget inherits.

## Edge function `generate-daily-digest`

- Deno function under `supabase/functions/generate-daily-digest/`.
- Gathers overnight classified emails, handled count, today's meetings + prep notes, open commitments both directions, stalled follow-ups with per-sender silence baselines.
- Single LLM call via existing `callLLM()` gateway with strict JSON schema; strips code fences; upserts into `daily_digests`.
- Fallback row on LLM failure (`urgency_level='calm'`, counts-only headline, empty sections).
- Scheduled via pg_cron at 07:30 through `pg_net` (uses insert tool, not migration, per project rules).
- Also callable per-user (manual refresh from GlanceCard tap on timestamp).

## Behavior rules

- Glance card urgency: `calm` collapsed / `attention` collapsed with primary border + dot / `urgent` auto-expanded destructive border, records `dismissed_at` when user collapses so it stays collapsed for the day.
- Every `HomeSection` shows last-fetch timestamp (tap to refetch that widget only via React Query).
- Every section footer link deep-links with `routeFilter` query params; destination pages must read + apply them (adjust `Inbox`/tracker/calendar pages minimally to honor query params on arrival).
- "Customize home" dialog: switches bound to `home_preferences.enabled`, optimistic save, no drag reorder yet.
- Loading = Skeletons; empty = friendly one-liner, no CTAs.

## Technical notes

- Category table real name confirmed at implementation (add `show_on_home` there — memory already mentions it exists; if so, skip the ALTER).
- RLS org-match uses existing helper (likely `public.user_org_id()` or membership check) — mirror the pattern used by `categories` policies.
- Cron scheduling SQL runs via `supabase--insert` (contains project URL + anon key), not migration.
- No changes to classification, follow-up engine internals, or Graph sync.
- Existing `TheHelm` route/logic untouched to avoid regressions; sidebar just repoints.

## Out of scope

- Drag-to-reorder widgets (column exists for later).
- Role-based default templates.
- Any change to Graph sync, classification engine, or follow-up internals.
