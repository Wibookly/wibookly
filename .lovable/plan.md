## What I'll fix

### 1. Daily Brief checklist — "Completed" section at the bottom
Currently when you check an item, it stays in place with a strikethrough and a 60% opacity. You want a clear visual split: open items on top, a **"Completed today"** section below them that holds every item you ticked off during this session. Items only disappear when you reload/close the brief.

**Change:** `src/components/daily-brief/TodoChecklistCard.tsx`
- Split `ordered` into `openItems` and `doneItems`.
- Render two lists with a labeled divider ("Completed — N") between them.
- Keep the existing toggle behavior (writes `status=done` to `daily_brief_tasks`); add a subtle green left-border + check icon for completed rows so they read as "done", not "muted/error".
- No DB or business-logic changes.

### 2. Schedule date/time picker — easier to use
The current "Schedule on calendar" dialog (in `ActionItemsPanel.tsx`) uses a basic native date/time input. I'll replace it with:
- Calendar popover (shadcn `Calendar`) for date selection.
- A clean time picker with quick-pick slots (9:00, 10:00, 11:00, 1:00 PM, 2:00 PM, 3:00 PM, 4:00 PM) plus a custom time field.
- Duration buttons (15 / 30 / 45 / 60 min).
- Reuse the existing `log-calendar-event` call — no backend change.

### 3. Teams meeting URL missing inside the event
When scheduling with Teams enabled, the generated Teams join URL isn't being inserted into the event body. I'll check `supabase/functions/log-calendar-event/index.ts`:
- Ensure `isOnlineMeeting: true` + `onlineMeetingProvider: 'teamsForBusiness'` are set on the Graph create call.
- After creation, refetch the event with `$select=onlineMeeting,body,webLink` and, if needed, append the `joinUrl` into the body HTML so it shows inside the event.

### 4. No-reply tracker sending after business hours
Right now `cron-follow-ups` (or `audit-inbox-followups`) sends regardless of `availability_hours`. I'll:
- Load the owner's `availability_hours` row before sending.
- Skip + reschedule any send that falls outside business hours (move to next business-day start in the user's timezone).
- Add a `skipped_reason` to the tracker log so you can see why.

### 5. No-reply tracker report not showing sent items
`NoReplyTrackerReport.tsx` likely filters by a status that excludes `sent`/`replied`. I'll:
- Verify the query against `follow_up_trackers` and remove the over-restrictive filter.
- Add a "Sent follow-ups" tab/section with sent_at, recipient, and reply status so every dispatched email shows up.

## Out of scope
- No schema changes unless step 4/5 actually require a new column (I'll only add `skipped_reason` if missing).
- No changes to other pages.

## Verification
- Visual check of the brief checklist and schedule dialog via Playwright screenshots.
- Tail edge-function logs after triggering a follow-up to confirm the business-hours gate.
- Query `follow_up_trackers` to confirm sent rows appear in the report.

Approve and I'll implement in this order: 1 → 2 → 3 → 5 → 4.