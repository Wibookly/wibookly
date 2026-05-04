# Energy Forward AI — Teams App Manifest

Files in this folder make up the Microsoft Teams app package.

## Package the app

Zip the three files (no parent folder) into `energyforward-ai.zip`:

```
manifest.json
color.png      (192x192)
outline.png    (32x32)
```

## Deployment steps

1. **Bot credentials** — in Supabase secrets:
   - `TEAMS_BOT_APP_ID` = `7ef83b20-0a5b-4ce9-b8fc-01dbe29943a2`
   - `TEAMS_BOT_APP_PASSWORD` = client secret from Azure Portal → Azure Bot resource → *Manage Microsoft App ID and password* → New client secret
   - `MICROSOFT_TENANT_ID` = your EnergyForward tenant ID

2. **Edge function** — already deployed at:
   `https://<project>.supabase.co/functions/v1/teams-bot`

3. **Azure Bot messaging endpoint** — Azure Portal → Azure Bot → Configuration → Messaging endpoint = the URL above.

4. **Upload to Teams** — Teams Admin Center → Manage apps → *Upload new app* → select `energyforward-ai.zip` → approve tenant-wide.

5. **Smoke test** — `POST` to `/functions/v1/teams-bot/test-simulation` with no body. Expected: `{ ok: true, ... }` and a row in `agent_messages` with `channel='teams'`.
