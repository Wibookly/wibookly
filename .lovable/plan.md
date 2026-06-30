
This is a large multi-part request. I'll break it into tracked tasks so nothing is missed. Please confirm before I build.

## Tasks

### 1. Flagged Email Tracker — export parity
- PDF, Excel, and Email-to-me exports must mirror the exact on-screen table (all columns, all rows for each recipient — including the 4–5 emails waiting on the same person), not a summarized view.
- Same column order, same row order, same status badges, repeating header on every page.

### 2. Read / Unread indicator in tracker
- Add an envelope icon (✉ closed = unread, ✉ open = read) before the subject in every row.
- Click the icon to toggle read/unread — syncs to Outlook via Graph (`isRead` PATCH on the message).
- State reflected in PDF/Excel/Email exports (icon or "Read"/"Unread" text column).

### 3. Calendar tile — time on one line
- Fix "10:30 AM" wrapping (AM drops to second line). Render time as a single non-wrapping line (e.g. `whitespace-nowrap`, widen the time gutter).

### 4. "Handled for you" semantics
- Confirm it counts ONLY emails where an AI draft was actually sent (status = sent by AI). Rename label if clearer: "Sent by AI".
- Audit the count source so it matches reality.

### 5. The Helm — reorder + AI-driven triage
New section order on The Helm:
```text
1. Top Priorities          (must-do today — overdue from prior days + hard deadlines)
2. Today                   (NEW — due today, AI-prioritized by email content, not by sender)
3. Your Decisions          (pending items awaiting your call)
4. Operations Ledger       (everything else: Overdue / FYI / AI-Handled tabs)
```
- New "Today" section: AI reads email body + thread context and ranks what truly needs a reply today.
- AI re-indexes on each Helm sync; classification rationale visible on hover.

### 6. Helm AI controls in Admin
- Surface the Helm triage rules in the Admin dashboard (which AI model, scoring weights, tier thresholds) so an admin can review/edit.
- Show "last indexed at" and allow manual re-index.

### 7. Helm as a plan-gated feature
- Add `helm` to the plan feature matrix (same pattern as `email_agent`, `ai_chat`).
- Admin can enable/disable per plan and per user.
- Sidebar hides The Helm link when the feature is off.

### 8. AI model selector
- Add per-user setting: choose AI model used by Helm/triage/drafts (e.g. `google/gemini-2.5-flash` default, plus Claude Sonnet 4.5, GPT-5-mini, etc.).
- Stored on `user_profiles` or `agent_settings`; respected by `helm-sync-mail`, `helm-draft-reply`, triage edge functions.

## Technical notes

- Exports: refactor `flag-report-email`, the PDF generator, and Excel export to share one `buildTrackerRows()` that returns the same dataset the UI table uses (per-message, not per-recipient).
- Read state: extend `helm_items` / `tracked_emails` with `is_read` mirrored from Graph; PATCH `/me/messages/{id}` `{ isRead }` on toggle.
- Helm triage: extend `helm-sync-mail` scorer with a "due today" detector (parses dates, urgency phrases, thread age) and writes a new `tier = 'today'`. Add `today` bucket to `TheHelm.tsx`.
- Plans: insert `helm` row into the feature catalog migration; update `useFeatureAccess` consumers; gate `/helm` route via `FeatureRoute`.
- Model selector: add `preferred_ai_model` column; pass through to `llm-gateway` calls in helm/draft functions.

Please confirm and I'll implement in this order: 3 (quick fix) → 1, 2 (tracker) → 4 → 5 (Helm reorg) → 7 (plan gating) → 6 (admin controls) → 8 (model selector).
