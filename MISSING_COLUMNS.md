# AI Usage Tab — Schema Gap Report

The prompt for the new **AI Usage** admin tab assumed a specific shape for `public.ai_usage_logs`. The current table has a different shape, so per the spec I stopped before building the UI rather than invent placeholder values or run a migration unprompted.

Also note: `/admin/control-panel` was retired in a prior change — the new tab would live in `/admin` (AdminDashboard) immediately after the **Plans** tab. Confirm placement when we proceed.

---

## Current `ai_usage_logs` columns

| Column | Type | Nullable |
|---|---|---|
| id | uuid | no |
| user_id | uuid | yes |
| organization_id | uuid | no |
| provider | text | no |
| model | text | no |
| action | text | no |
| prompt_tokens | int | no (default 0) |
| completion_tokens | int | no (default 0) |
| total_tokens | int | yes (generated) |
| cost_usd | numeric | no (default 0) |
| metadata | jsonb | no (default `{}`) |
| created_at | timestamptz | no |

## Expected by spec

| Column | Status | Notes |
|---|---|---|
| id | ✅ present | |
| user_id | ✅ present | |
| organization_id | ✅ present | |
| domain_id | ❌ **missing** | FK → `allowed_domains(id)` |
| group_id | ❌ **missing** | FK → `permission_groups(id)` |
| feature_id | ⚠️ name mismatch | exists as `action` (text). Rename or alias? |
| model | ✅ present | |
| input_tokens | ⚠️ name mismatch | exists as `prompt_tokens` |
| output_tokens | ⚠️ name mismatch | exists as `completion_tokens` |
| cost | ⚠️ name mismatch | exists as `cost_usd` |
| status | ❌ **missing** | needed for success/blocked/error pill |
| block_reason | ❌ **missing** | |
| error_message | ❌ **missing** | |
| latency_ms | ❌ **missing** | |
| created_at | ✅ present | |

## Decisions needed before building

1. **Add the 6 missing columns** (`domain_id`, `group_id`, `status`, `block_reason`, `error_message`, `latency_ms`) via migration? They will be `NULL` for all historical rows.
2. **Rename vs alias** the 4 mismatched columns? Two options:
   - **A.** Adapt the UI to read existing names (`prompt_tokens`, `completion_tokens`, `cost_usd`, `action`). Zero migration risk, no rewrites in producers.
   - **B.** Rename columns to match the spec. Touches every edge function that writes to `ai_usage_logs` (`llm-gateway`, `ai-assistant-chat`, `draft-email`, `agent-loop`, `process-ai-emails`, etc.) — higher risk.
3. **Producers** — to populate `status`/`block_reason`/`error_message`/`latency_ms`/`group_id`/`domain_id` going forward, the writer in `_shared/enforce-limits.ts` (and `llm-gateway`) needs to be updated. Want that included in the same migration PR, or as a follow-up?
4. **Realtime publication** — `ai_usage_logs` is not currently in `supabase_realtime`. Add it (`ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_usage_logs;` + `REPLICA IDENTITY FULL`)?
5. **Tab placement** — confirm: add as new top-level tab in `/admin` AdminDashboard, after **Plans**. (`/admin/control-panel` no longer exists.)

## Recommended path (my suggestion)

- Option **A** for naming (adapt UI, no renames) — minimizes blast radius.
- Add the 6 truly-missing columns, all nullable, no defaults that would lie.
- Backfill `group_id` / `domain_id` from `user_profiles` join in the same migration.
- Add `ai_usage_logs` to `supabase_realtime` with `REPLICA IDENTITY FULL`.
- Update `_shared/enforce-limits.ts` to populate new columns going forward (separate task).
- Then build the AI Usage tab against the adapted column names.

Reply with answers to the 5 questions above (or just "go with the recommended path") and I'll run the migration and build the tab in the next pass.
