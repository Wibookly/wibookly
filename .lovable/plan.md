## No Reply Tracker — lifecycle, stop alias & layout cleanup

### What you asked for

1. **Hard cap on reminders.** Default = 3. After the 3rd missed nudge with no reply, the tracker stops automatically — no more drafts, no more reminder emails. The email stays in the **No Reply Tracker** category so you can still see it and act manually.
2. **Manual stop via BCC.** Send a new email on the same thread (or any time) with BCC `stop@yourdomain.com` (we'll also accept `0@yourdomain.com`). InboxIQ cancels all open trackers for that conversation, moves the original message out of the "Follow-up" Outlook folder back to the **Inbox**, and removes the **No Reply Tracker** label so its normal category takes over again.
3. **Manual re-trigger.** Sending a fresh BCC like `2@yourdomain.com` on a new email in the same thread re-arms the tracker with a new due date and resets the reminder counter to zero.
4. **Clearer page copy.** Rewrite the master-toggle description so the full lifecycle (BCC → due date → label → draft → up to N nudges → auto-stop / manual stop) is spelled out in one place. Add a dedicated "Lifecycle & how to stop" card under Step 2.
5. **Inbox audit clarification.** Keep the manual range picker (useful for one-off back-fills), but remove the redundant **Run scan now** button at the bottom of the page — the background scan already runs every 15 min and the daily 24-hour audit covers the routine case. Also auto-trigger one quiet scan when the page is opened, so the data is fresh without a button click.

### How it will work (technical)

- **DB migration**
  - Add `cancellation_alias` (text) and `cancelled_at` (timestamptz) to `follow_up_trackers`.
  - Add `stop_aliases` to `follow_up_settings` (text[], default `{stop,0}`) so we can extend without code changes.
  - New RPC `cancel_trackers_for_conversation(connection_id, conversation_id, alias)` used by the cron.

- **Edge function `cron-follow-ups`**
  - During the Sent-Items scan, in addition to parsing `N@domain` as a trigger, parse `stop@domain` and `0@domain` as **cancel signals**. For any matching message with a `conversationId`, cancel all `pending`/`drafted`/`missed` trackers for that conversation: set `status='cancelled'`, move the original message from the "Follow-up" folder back to Inbox, and clear the **No Reply Tracker** label on that message in Outlook.
  - `processMissedReminders` already respects `reminder_max_count`; we'll also mark the tracker `status='exhausted'` once `reminder_count >= reminder_max_count` so the UI can show it clearly and the row stops being re-evaluated.

- **UI `FollowUpReminderSettings.tsx`**
  - Rewrite Step 1 description to summarize the lifecycle in plain English and call out the two ways to stop (auto after N nudges, or BCC `stop@domain`).
  - Add a small "Lifecycle & how to stop" info card under Step 2 with the exact BCC examples (`stop@domain`, `0@domain`) and a copy-to-clipboard chip.
  - Remove the bottom row containing the **Run scan now** button and the duplicate "Background scan runs every 15 min…" caption (we'll keep one concise version inside the master-toggle card).
  - On mount, fire one silent `cron-follow-ups` invocation (no toast) so the dashboard is always up to date when opened.
  - Keep the **Inbox audit** card as-is — it's the right tool for ad-hoc back-fills over custom date ranges.

### Files touched

- `supabase/migrations/<new>.sql` — schema + RPC
- `supabase/functions/cron-follow-ups/index.ts` — stop-alias handling + exhausted status
- `src/components/follow-up/FollowUpReminderSettings.tsx` — copy rewrite, new lifecycle card, remove bottom button, auto-refresh on mount
