## Daily Brief Overhaul — Unified Action Items, Carry-Over Tasks, Print-Ready Layout

### 1. Restructure the Daily Brief page (`src/pages/AIDailyBrief.tsx`)
- **Remove** the standalone "Email Highlights" card (content already lives in the Action Plan).
- Keep the page order: **Your Action Items → Priority Tips → Daily Brief Schedule**.
- Reorganize **Action Items** into two collapsible sub-sections:
  - 📧 **Emails** (items where `source = email`)
  - 📅 **Calendar** (items where `source = calendar` / meeting)
  - Auto-expanded when items exist; auto-collapsed (and showing "No email items today" / "No calendar items today") when empty.
- Each action item gets a small action toolbar:
  - **Mark Done**, **Snooze to tomorrow**, **Add Reminder**, **Schedule on Calendar** (uses availability hours to suggest a slot).

### 2. Carry-over / persistence (new table `daily_brief_tasks`)
- Store every generated action item with: `user_id, connection_id, brief_date, source (email|calendar|todo), context, action, why, estimated_minutes, status (open|done|snoozed|scheduled), carried_from_date, calendar_event_id, reminder_at`.
- RLS + GRANT for `authenticated` and `service_role`.
- When `ai-daily-brief` runs, **carry forward all `open` items from previous days** and merge them with newly generated ones (dedupe by context+action hash).
- Mark items `done` only when the user clicks Mark Done (or detected reply/meeting completion later).

### 3. Calendar / reminder integration
- "Add Reminder" → creates a `follow_up_trackers` entry tied to the item (uses existing infra).
- "Schedule on Calendar" → opens a dialog that proposes a slot from `availability_hours`, then creates the event via the existing Microsoft/Google calendar edge function and stores `calendar_event_id` on the task.
- AI prompt updated to add a `recommendation` field per item: `reminder` | `schedule` | `none` with a suggested duration, so the UI can pre-select the right CTA.

### 4. Email = Page parity
- `send-daily-brief` and the PDF generator are rewritten to render **exactly** the same Action Plan structure (Emails section, Calendar section, Carry-over badge, recommendations) as the web page — single shared template object so they cannot drift.

### 5. Print layout (handlePrint in `AIDailyBrief.tsx`)
- Each section starts on its own printed page with a header:
  `InboxIQ Daily Brief · {Section Name} · {Date} · Page X of Y`
- Sections supported: **Action Items – Emails**, **Action Items – Calendar**, **To-Do List**, **Priority Tips**, **Schedule**.
- CSS `@page { size: Letter; margin: 0.5in }` + `break-before: page` per section, `break-inside: avoid` per item. If a section overflows, page number auto-increments and the header repeats.

### 6. Concise content
- Tighten AI prompt: each item ≤ 2 sentences for `context`, 1 sentence for `action`, 1 short sentence for `why`. No filler.

### Technical notes
- New file: `supabase/migrations/<ts>_daily_brief_tasks.sql`
- Edited: `src/pages/AIDailyBrief.tsx`, `supabase/functions/ai-daily-brief/index.ts`, `supabase/functions/send-daily-brief/index.ts`
- New small component: `src/components/daily-brief/ActionItemRow.tsx` (shared between web + print)
- Reuses existing `availability_hours`, `follow_up_trackers`, calendar OAuth tokens — no new secrets.

Approve to proceed and I'll implement in one pass.
