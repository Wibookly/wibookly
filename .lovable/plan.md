
# Follow-Up Flag Tracker + Graph Preflight + Sidebar Rename

This is a large rework. I want to confirm scope before building so nothing gets half-done.

## What changes

### 1. Replace BCC tracker with Outlook Follow-Up Flag
- Remove the BCC `followup+Nd@…` ingestion path and any shared-mailbox / interval-whitelist logic.
- New trigger: user flags a sent email in Outlook with a due date (primary) OR applies a `FollowUp` / `FollowUp 5d` category (fallback).
- Subscribe to `/me/mailFolders('sentitems')/messages` (created+updated) per user with a delta-poll fallback every 2–5 min.
- For each flagged/categorized sent message, upsert into a new `tracked_emails` table (keyed on `internet_message_id`) with `trigger_type`, `follow_up_at`, `attempts`, `status`.
- Handle flag changes: completed/removed → cancel; due date changed → update.

### 2. No-reply check + draft generation (cron every 15 min)
- For each `pending` row past `follow_up_at`:
  - Check conversation for replies from anyone other than the user (after `sent_at`).
  - Ignore auto-replies (`Auto-Submitted: auto-replied`, `X-Auto-Response-Suppress`, "Automatic reply"/"Out of Office" subjects).
  - Re-read flag; if completed/removed → cancel.
  - Else if `attempts < 2`: generate polite follow-up via `createReply` + PATCH body, leave as **draft** (never auto-send). Schedule attempt 2 `FOLLOWUP_GAP_DAYS` (default 3) later. After attempt 2 → `exhausted`.
- LLM prompt: 3–6 sentences, warm, restate ask, no clichés, HTML body only.

### 3. Graph Access Preflight (Connection Health panel in Settings)
On-demand + auto after Microsoft connect. Probes in order, with cleanup:
1. `GET /me` + decoded scopes
2. Confirm `Mail.Read`, `Mail.ReadWrite`, `offline_access` present (else FAIL + Reconnect)
3. `GET sentitems/messages?$select=…,flag,categories,conversationId` (proves flag read)
4. `GET /me/messages?$filter=conversationId eq '…'` (proves reply detection)
5. Create + delete a test subscription on Sent Items (WARN if webhook validation fails in env)
6. `createReply` then `DELETE` the draft (proves Mail.ReadWrite write)

Result UI: green/red/amber checklist, raw Graph error under each failure, overall verdict. Log every probe to a new `graph_health` table. Never sends email; always cleans up.

### 4. UI / sidebar rename + move (from screenshot)
- Page header "AI Activity" → **"AI Intelligence Report"**.
- Sidebar item "No Reply Tracker" → **"Flagged Email Tracker"** and moved out of `AI Intelligence` group into `AI Activity` group, positioned between **AI Activity** and **My Daily Brief**.
- The page itself: remove the "No-Reply Tracker" tab from inside AI Intelligence Report; promote it to its own route. Update tracker dashboard columns to: recipient, subject, trigger (flag date / category), follow_up_at, status, attempts.
- Remove "BCC this address" onboarding copy; new How-To card with the two gestures.
- Settings: `FOLLOWUP_GAP_DAYS` field + toggle for 2nd attempt; Connection Health panel.

## Database changes (new migration)
- `tracked_emails` (user_id, connection_id, graph_message_id, internet_message_id UNIQUE, conversation_id, recipient_address, subject, sent_at, trigger_type, follow_up_at, attempts, status, last_checked_at, …) with RLS scoped to `auth.uid()`, GRANTs.
- `graph_health` (user_id, probe, status, detail jsonb, checked_at) with RLS.
- Keep `follow_up_trackers` table for now (read-only / legacy) but stop writing to it; old report screens removed. I will NOT drop it in this migration to avoid data loss — say the word and I'll add a drop in a follow-up.

## Edge functions
- New: `graph-preflight` (runs probes, writes `graph_health`, cleans up).
- New: `flag-tracker-ingest` (webhook receiver + delta poll worker for Sent Items).
- New: `flag-followup-cron` (15-min job: reply check + draft generation).
- Remove/retire: the BCC parsing path in `cron-follow-ups` and any "followup+Nd" routing in `graph-mail-webhook`. Existing `email-compose` tracker-insert hook also removed.

## Out of scope (confirm if you want these too)
- Backfilling existing already-flagged sent emails on first connect (I'd default to **yes, last 30 days**).
- Auto-deleting the legacy `follow_up_trackers` table and its UI references (I'll hide them; deletion later).
- Multi-mailbox per user — keeps current per-connection model.

## Order of work
1. Migration (`tracked_emails`, `graph_health`).
2. `graph-preflight` function + Connection Health UI panel.
3. `flag-tracker-ingest` (subscription create on connect + delta-poll fallback + webhook handler).
4. `flag-followup-cron` + draft generator.
5. Sidebar rename/move + new route + cleaned dashboard.
6. Remove BCC code paths and old onboarding copy.

Approve and I'll start with the migration.
