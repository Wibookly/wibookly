## What you'll see

### 1. AI-drafted replies actually read the thread
Right now the draft opens as a near-empty `Hi Agent, … Best, arahimi`. I'll fix `helm-draft-reply` so it always:
- Loads the **full Outlook thread** (`/me/messages/{id}?$expand=...` + `conversationId` lookup) for that email.
- Passes the cleaned thread history + subject + sender context into the LLM.
- Returns a real, contextual reply in your voice (using your saved tone + signature).
- The same call is reused when you click **Shorter / More formal / Warmer / More firm / Bullet points** or type into "Tell the AI how to change this reply" — it re-drafts against the same thread, not against a blank slate.
- Your manual edits are preserved when you press Apply on a tone change unless you ask for a full rewrite.

### 2. Helm section cleanup
On the home page:
- **Remove** the standalone "Drafted for you" tile (it duplicates Today's Big 3).
- **Keep**: Today's Big 3, Your decisions, Overdue — waiting on your reply, FYI — no reply needed.
- **Rename + repurpose** "Handled for you" → **Handled by your AI agent** with a clear list of what the agent filed / auto-replied / booked in the last 24h (click to expand the full log).

### 3. Calendar — current week + focus-time approvals
The calendar card on The Helm becomes two stacked panels:

```text
┌─ This week's meetings ────────────────┐
│  Mon  09:00  Standup        (Outlook) │
│  Mon  14:00  Client review            │
│  Tue  10:00  1:1 with Sam             │
│  …                                    │
└───────────────────────────────────────┘
┌─ AI focus-time recommendations ───────┐
│  Move "Client review" Mon 14:00 → 16:00│
│  Reason: opens 90-min focus block Tue AM│
│  [ Current ] vs [ Proposed ]   side-by-side
│                                       │
│  [ Approve all ]  [ Approve selected ]│
└───────────────────────────────────────┘
```

When you click **Approve**:
1. The event is **PATCHed in your Outlook calendar** to the new time.
2. A **notification email** is automatically sent to internal attendees in your voice ("Quick shift: moving our X from … to …, hope that still works").
3. The "Proposed" row turns green with a ✓ and the new time appears in the top panel on refresh.
4. External-attendee meetings still require your explicit OK (per your earlier rule — auto-internal, ask-external).

A small **"Sent notifications"** sub-list appears under each approved move showing exactly who was emailed and when, so you have an audit trail right on the home page.

## Technical notes

- `supabase/functions/helm-draft-reply/index.ts` — load conversation via Graph `?$select=…&$expand=…` and walk `conversationId` for the last 5 messages; feed to LLM as `<thread>` context; honor `tone` + `instruction` params; never return the empty greeting-only template.
- `src/pages/TheHelm.tsx` — delete the "Drafted for you" `<section>` block (~lines 768–786); rename "Handled for you" → "Handled by your AI agent" and expand its detail list; keep Overdue + FYI as-is.
- Calendar refactor — replace the existing calendar card with two stacked panels driven by `helm-sync-calendar` (current week) and `helm-plan-week` (proposed). Approval re-uses the existing `mode: 'approve_external'` for external and adds an internal auto-apply path that's already in `helm-plan-week`; surface the per-attendee email log via `activity_log` rows tagged `note_sent`.
- No DB schema changes required.

## Out of scope (ask if you want them)
- Drag-to-reschedule on the calendar.
- Rich text formatting in the draft editor.
