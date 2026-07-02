
## 1. Flagged Email Tracker — replied row cleanup
File: `src/pages/FlaggedEmailTracker.tsx`
- Remove the green "Replied · queue cleared / No follow-ups sent" long pill and the two extra history lines on replied rows.
- Keep only the compact right-side **Replied** status badge (the small pill on the far right).

## 2. Focus rules — new model (per-day type + time block)
Files: `src/pages/TheHelm.tsx` (FocusRulesCard), `supabase/functions/helm-plan-week/index.ts`, migration on `helm_focus_rules`.

Per selected day, user picks:
- **Type**: `Focus` or `Personal` (renamed from "appointment")
- **Length**: 30m / 45m / 60m / 90m / 120m
- **Time block** (3-hour bands, pick one or multiple):
  - Early morning 7–10 AM
  - Late morning 10 AM–1 PM
  - Afternoon 1–4 PM
  - Late afternoon 4–7 PM

Planner searches only within the chosen band(s) for a free gap of the requested length. If no gap in any chosen band → mark day as "no space – blocked" (red dot, no card added).

Store as JSONB `day_plan` on `helm_focus_rules`:
```
{ mon: { type:'focus', length:30, blocks:['am_early','pm_late'] }, ... }
```

## 3. Duplicate prevention (hard)
- Before proposing any block for a day, load that day's existing calendar events **and** existing focus/personal blocks (both real and previously proposed).
- If a block of the same type already exists that day → **do not add another**. Instead surface an inline orange note on the calendar day: "Existing Focus at 1:30 PM – AI kept it, no duplicate added."
- No "Approve new / Merge" links anywhere — decision is automatic.

## 4. AI overlay panel cleanup
File: `src/pages/TheHelm.tsx` (CalendarView header + overlay strip)
- Remove **Database saved: 30m** pill.
- Remove **Approve new** / **Merge** action links on the orange conflict banners.
- Remove the green "Your schedule is good — AI does not see a better reorganization…" line **only when it comes from the reorganize path**; keep the generic green success line for other AI messages.
- Rule-change debounce stays at 2s (down from 3s per request), then auto-syncs. No manual sync button.

## 5. Calendar rendering fixes
File: `src/pages/TheHelm.tsx`, `src/index.css`
- Extend visible grid so 6 PM row is fully rendered (add trailing padding row / bump grid height so the last hour label + card fit).
- Business hours locked 8 AM–6 PM shown fully; scroll only for out-of-hours rows.

## 6. AI-sent emails use profile signature
Files: `supabase/functions/helm-draft-reply/index.ts`, `supabase/functions/helm-send-reply/index.ts`
- On draft generation, append the user's stored HTML signature from `profiles.signature_html` (already used by the manual composer) — do NOT let the model invent one.
- On send, if the outgoing body has no signature marker, append the profile signature block before sending via Graph.

## Technical notes
- Migration: `alter table helm_focus_rules add column if not exists day_plan jsonb default '{}'::jsonb;` — keep old columns for backward read, write to `day_plan` going forward.
- `helm-plan-week` reads `day_plan` first, falls back to legacy shape.
- Duplicate check runs server-side in `helm-plan-week` and client-side in `TheHelm.tsx` overlay render.
- No changes to Flagged Tracker cron / send logic — only the row UI.

Confirm and I'll build.
