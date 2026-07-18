# Admin, Integrations, Unanet & Chat updates

## 1. Admin dashboard nav reshuffle (`src/pages/AdminDashboard.tsx`)
- Rename the "M365 Users" tab to **Employees**.
- Move the **Roles** tab content inside the Employees tab (sub-section, so admins manage users + roles in one place).
- Reorder tabs so **Plans** sits immediately after Employees.
- Under each plan row in `PlansTab.tsx`, add two new feature toggles:
  - `egnyte_integration`
  - `unanet_integration`
  These already fit the existing `plan_features` pattern; toggling them grants the feature to users on that plan.

## 2. Fix Integrations admin page not opening
- Audit `src/components/admin/integrations/IntegrationsTab.tsx` and its sidebar. There's a runtime error preventing render — likely a missing group in `inventory.ts` or a broken import after recent edits. Fix so the page loads.

## 3. New "Apps" section on the Integrations page
- Add a new group `apps` in `src/components/admin/integrations/shared/inventory.ts` containing:
  - **Egnyte** (already partially wired via `tenant_integrations`)
  - **Unanet** (new)
- Each app expands to a detail pane with:
  - Cloud URL, Database name, API key fields (Unanet)
  - OAuth connect button (Egnyte, already exists)
  - Live status dot (green = connected + last probe OK, orange = configured but failing, red = not configured / failing).

## 4. Unanet connector (new)
- DB: extend `tenant_integrations` usage for `provider = 'unanet'` (config JSON stores `cloud_url`, `database`; encrypted `api_key` in `oauth_token_vault`).
- Edge functions:
  - `unanet-save-credentials` — validates + stores config/API key encrypted per-org.
  - `unanet-probe` — pings Unanet cloud with stored creds; updates `integration_health` row (`service_key = 'unanet'`) so the status dot reflects reality.
  - `unanet-search` — used by chat tool + dashboard queries.
- Admin UI: new `UnanetSettingsCard` inside the Apps → Unanet detail pane, with Save + Test buttons.

## 5. AI Chat attach (+) menu
- In `src/pages/AIChat.tsx` (or the chat page in use), add two toggles under the `+` menu:
  - **Egnyte context** (already exists) — keep.
  - **Unanet context** — new. When on, chat prepends Unanet results (projects, timesheets, resources) via `unanet-search`.
- Server: extend `agent-orchestrator` tool list with `unanet_search` gated by `has_feature('unanet_integration')`.

## 6. Unanet Dashboard page
- New `src/pages/UnanetDashboard.tsx` with the standard `PageHero` header ("Unanet Dashboard" + Unanet logo).
- Sidebar: add link under **AI Intelligence Report** group in `AppSidebar.tsx`, gated by `unanet_integration` feature.
- Content v1: summary tiles (Active projects, Utilization %, Open timesheets, Pending approvals) pulled via `unanet-search` edge function. Empty-state if not connected → CTA to Integrations → Apps → Unanet.
- Logo: fetch from unanet.com and save to `src/assets/unanet-logo.png`.

## 7. Secrets & config
- No global secrets required; Unanet creds are per-org (encrypted via existing vault pattern used for Egnyte/M365).
- Feature keys `egnyte_integration` and `unanet_integration` added to `constants/featureKeys.ts`.

## Technical notes
- Follow existing patterns: `integration_health` for status dots, `useIntegrationHealth` hook already aggregates per `service_key`, so Unanet will appear on the Integrations Monitor card automatically once probes write rows.
- No breaking DB migrations — reuse `tenant_integrations` + `oauth_token_vault`; only add `integration_definitions` row for Unanet and a feature key seed.
- All new edge functions verify JWT + org membership; API keys never leave the server.

## Out of scope for this pass
- Deep Unanet reporting (beyond the 4 summary tiles).
- Egnyte re-work — only surfaces it in the new Apps section; existing OAuth flow untouched.

Reply "go" and I'll implement in one pass, or tell me what to trim/expand.
