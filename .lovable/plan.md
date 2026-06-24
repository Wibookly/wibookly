## 1. Daily Brief — "Today's Schedule" upgrades

**Page (`src/pages/AIDailyBrief.tsx` + new `CalendarPanel.tsx`)**
- Replace the static "today only" schedule block with a new `CalendarPanel` that has:
  - Range toggle: **Today / This Week / This Month** (defaults to Today).
  - Live fetch from Microsoft 365 via existing connection (Graph `/me/calendarview?startDateTime=…&endDateTime=…`) through a new edge function `calendar-events` (so the token vault stays server-side). Returns subject, start, end, location, organizer, attendees count, isOnlineMeeting, webLink.
  - "Refresh", "Print" (opens a clean print-only view), and "Include in email" toggle (persists per-user via `daily_brief_schedules.include_calendar_in_email`).
  - Grouped by day with time, color-coded status (Now / Upcoming / Past).
- Print view: `/daily-brief/print` route that renders Today's Schedule + action items branded InboxIQ.

**Daily Brief email (`supabase/functions/send-daily-brief/index.ts`)**
- Reuse `calendar-events` server-side to fetch today's events for that user's connection.
- Append a "Today's Schedule" HTML section before action items when the new `include_calendar_in_email` flag is on.

**Migration**
- `ALTER TABLE daily_brief_schedules ADD COLUMN include_calendar_in_email boolean NOT NULL DEFAULT true;`

## 2. AI Chat — "Remind me" popup → Outlook event + Daily Brief task

**`src/pages/AIChat.tsx`**
- Detect phrases `remind me`, `schedule`, `set a reminder` in the user's submitted message (regex, case-insensitive).
- Open a new `ReminderDialog` component with: title (prefilled from message), date, time, duration (default 30m), notes, attendee email (optional).
- On confirm: call new edge function `create-reminder` which:
  1. Creates a Microsoft Graph calendar event on the user's connected calendar via `POST /me/events`.
  2. Inserts a `daily_brief_tasks` row (kind = 'reminder') linked to that event id so it appears in Daily Brief action items.
- Chat thread gets an assistant message confirming the reminder with date/time + link to event.

## 3. AI Activity panel rename + new No-Reply Tracker Report

**`src/pages/AIActivityDashboard.tsx`**
- Rename header to **"AI Intelligence Reports"**.
- Add a tab bar with two tabs:
  1. **AI Activity** (existing content moved into the tab).
  2. **No-Reply Tracker** (new `NoReplyTrackerReport.tsx`).

**`NoReplyTrackerReport.tsx`**
- Pulls from `follow_up_trackers` joined with `email_messages`/`email_threads` for subject + recipients.
- Columns: Sent At · Recipient · Subject · BCC alias (e.g. `3@…`) · Expected reply by · Status badge (Pending · Missed 1 · Missed 2 · Missed 3 · Replied · Completed · Cancelled) · Replied at.
- Filters: date preset (Today / Week / Month / Custom range) · status multi-select · recipient search.
- Actions: **Export CSV** and **Print**.
- Status mapping uses the existing tracker fields (`reminder_count`, `status`, `replied_at`, `cancelled_at`).

## 4. Backend pieces

New edge functions (all `verify_jwt = false`, validate JWT in code, use Outlook connector pattern already in repo):
- `calendar-events` — GET events between start/end for caller's primary M365 connection.
- `create-reminder` — POST event to Graph + insert `daily_brief_tasks`.

Reuse existing `oauth_token_vault` decrypt helper (`_shared/token-vault.ts` pattern already used by `m365-sync-connection`).

## 5. Out of scope (confirm if needed)

- Google Calendar support for the new calendar features (M365 only this pass — matches current product focus).
- Recurring reminders / RRULE — single events only for v1.

## Technical notes

- All new components use existing shadcn primitives and design tokens; no hardcoded colors.
- Print view uses `@media print` only, no separate library.
- CSV export uses the same `csvEscape` pattern as `ActivityReportTab`.
- The remind-me detection runs client-side before send; the actual message still posts to chat so the assistant log stays consistent.
