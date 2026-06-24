## 1. No-Reply Tracker — missing emails

**Why it's empty:** The hourly scan (`cron-follow-ups`) only processes connections where `follow_up_settings.is_enabled = true`. Some of your accounts have it OFF, and the report shows trackers across all connections so any miss is obvious. The scan also skips emails whose BCC alias is not purely numeric — `1@energyforward.com` is fine, but plain `audit@…` or `test@…` isn't picked up.

**Fix:**
- Add a "Scan my Sent now" button on the AI Intelligence Reports → No-Reply Tracker tab that calls `cron-follow-ups` for the active connection on demand (no need to wait 15 min).
- After a manual scan, show a toast with "Found N new tracked emails / 0 new".
- Add a small banner on the tab when the active connection has `is_enabled = false`, with a one-click "Enable tracking" that flips the flag.
- Surface the latest scan timestamp ("Last scanned 4 min ago").

## 2. Daily Brief — Remind me / Schedule buttons broken

Today the "Remind me" and "Schedule" buttons on each action item just flip a database flag — no popup, nothing on the calendar.

**Fix:** Wire both buttons to the same `ReminderDialog` already used in AI Chat, pre-filled with the item title, sender, and a sensible default time (tomorrow 9 AM for Remind, next free 30-min slot today/tomorrow for Schedule). Confirming the dialog calls `create-reminder`, which already (a) posts the event to Outlook calendar and (b) writes a `daily_brief_tasks` row so it surfaces in the brief.

## 3. AI Chat — Send email & schedule meetings by voice/text

Add two new tools to `agent-orchestrator` so the chat agent can take action, not just read:

**`send_email`** — sends through Microsoft Graph `/me/sendMail`. Inputs: `to[]`, `cc[]`, `bcc[]`, `subject`, `body` (HTML), `reply_to_message_id?`. The agent first calls `search_outlook_mail` or a new lightweight `search_contacts` tool to resolve names → addresses from your recent correspondents, then drafts, then asks for confirmation before sending. Confirmation is a one-line "Send this email to X? Yes / Edit / Cancel" rendered as quick-reply chips.

**`book_meeting`** — books an Outlook event. Inputs: `subject`, `attendees[]`, `duration_minutes`, `preferred_window` (e.g. "Thursday afternoon"), `location_or_online`. The tool first calls Graph `/me/calendar/getSchedule` for the user + attendees over the preferred window, picks the earliest slot with **no conflicts on anyone's calendar**, and creates a Teams online meeting. It never overwrites an existing event — if no free slot exists, it returns the top 3 alternative windows for the agent to propose back.

**`search_contacts`** — small helper: searches `/me/people` and recent message senders so "email Ali about the budget" resolves to the right address without you typing it.

Add prompt rules so the agent:
- Always shows the draft + recipients and asks confirmation before `send_email` fires.
- For booking, summarizes the chosen slot ("Thursday June 26, 2:00–2:30 PM, all three attendees free") and asks confirmation before `book_meeting` fires.
- Refuses to send to external domains the first time without explicit "yes, send externally" confirmation.

Two starter prompt chips added to the AI Chat composer:
- ✉️ "Send an email" → seeds `Draft an email to <name> about <topic>. I'll review before sending.`
- 📅 "Schedule a meeting" → seeds `Schedule a 30-min meeting with <name> sometime <window>. Don't double-book anyone.`

## 4. Files changed

- `supabase/functions/agent-orchestrator/index.ts` — add `send_email`, `book_meeting`, `search_contacts` tools + confirmation prompt rules.
- `supabase/functions/cron-follow-ups/index.ts` — accept `{ mode: "manual", connection_id }` for on-demand scan.
- `src/components/reports/NoReplyTrackerReport.tsx` — "Scan now" button, "Tracking disabled" banner, last-scan timestamp.
- `src/components/daily-brief/ActionItemsPanel.tsx` — open `ReminderDialog` from Remind / Schedule.
- `src/pages/Chat.tsx` — two new starter chips above the composer.

## 5. Out of scope (this pass)

- Sending from any account other than your active Microsoft 365 connection.
- Recurring meetings or multi-day events.
- Calendars other than Outlook (Google Calendar later).
