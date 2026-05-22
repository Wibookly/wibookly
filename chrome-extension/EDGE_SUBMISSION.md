# Submitting InboxIQ Meeting Copilot to Microsoft Edge Add-ons

The package at `public/inboxiq-meeting-copilot-edge.zip` is ready to upload.
The same ZIP also works on Chrome and all other Chromium browsers — start with Edge.

---

## 1. One-time setup (≈ 10 minutes, free)

1. Go to https://partner.microsoft.com/dashboard/microsoftedge/overview
2. Sign in with your Microsoft account (use your `@energyforward.com` work account).
3. Accept the **Microsoft Edge Add-ons Developer Agreement**. No credit card required.
4. Set the publisher display name to **InboxIQ** (or **EnergyForward AI**).

## 2. Create the listing

Click **New extension** → **Upload package** → select
`public/inboxiq-meeting-copilot-edge.zip`.

Fill in the listing with the values below (copy/paste).

### Store listing
- **Name**: `InboxIQ Meeting Copilot`
- **Short description (≤ 132 chars)**:
  `Live meeting transcript + AI suggestions for Teams, Zoom, Meet, and Webex. Audio stays on your machine — no bot joins.`
- **Detailed description**:
  ```
  InboxIQ Meeting Copilot turns your browser into a real-time meeting assistant.

  • Live transcript — captures the tab audio of your Teams, Zoom, Google Meet,
    or Webex call and transcribes it as it happens.
  • AI suggestions — surfaces what to say next, follow-up questions, and
    action items inside your InboxIQ workspace.
  • Post-meeting summary — full transcript, decisions, and action items
    appear automatically in InboxIQ.
  • No bot joins the call. Other attendees see nothing.
  • Audio is processed in real time and never stored. Only the text
    transcript is sent to your private InboxIQ account over HTTPS.

  Requires a free InboxIQ account at https://inboxiq.energyforward.com.
  ```
- **Category**: `Productivity`
- **Languages**: `English (United States)`
- **Website**: `https://inboxiq.energyforward.com`
- **Privacy policy URL**: `https://inboxiq.energyforward.com/privacy` *(make sure this page exists)*
- **Support contact**: `support@energyforward.com`

### Screenshots (required: at least 1, 1280×800 PNG)
Take these from a real session:
1. The Meeting Copilot page in InboxIQ with a live transcript scrolling.
2. The extension popup with "Capturing • <meeting title>" status.
3. A finished session detail with summary + action items.

### Icons
Already inside the ZIP (`icons/icon-16.png`, `icon-32.png`, `icon-128.png`).
Edge also wants a **300×300** Store logo — render one from the InboxIQ "IQ" mark.

## 3. Permissions justification (Edge reviewers will ask)

Paste these in the "Notes for certification" box:

> **`tabCapture`** — Required to capture audio of the user's own meeting tab
> (Teams / Zoom / Meet / Webex) for live transcription. Capture is only
> initiated when the user clicks "Start capture" in the extension popup.
>
> **Host permissions for teams.microsoft.com, zoom.us, meet.google.com,
> webex.com** — Limited to the meeting domains where tab capture is offered.
> No data is read from page DOM; only audio of the active tab is captured.
>
> **Host permission for inboxiq.energyforward.com** — Used only to read the
> user's existing InboxIQ session token from `localStorage` so the extension
> can post the transcript to their authenticated account. No other site data
> is accessed.
>
> **`offscreen`** — Required by Manifest V3 to host the MediaRecorder
> (service workers cannot record audio).
>
> **`storage`, `activeTab`, `scripting`** — Standard permissions for
> persisting the chosen session ID and reading the auth token from the
> active InboxIQ tab.

## 4. Privacy / data handling

In **Privacy → Data collection**, declare:
- ✅ Authentication information (only: existing InboxIQ session token, never a password)
- ✅ Web content (only: live audio of the user's own meeting tab, processed in real time, not stored)
- ❌ Personal identifiers / location / financial / health / etc.

## 5. Submit

Click **Submit for certification**. Review usually takes **3–7 business days**.
You'll get an email when approved with the public listing URL —
something like `https://microsoftedge.microsoft.com/addons/detail/<id>`.

## 6. Wire the live link into InboxIQ

Once approved, edit `src/pages/MeetingCopilot.tsx` and set:
```ts
const EDGE_STORE_URL: string | null = 'https://microsoftedge.microsoft.com/addons/detail/<your-id>';
```
The **Add to Microsoft Edge** button will then go straight to the store.

## 7. Updates

To ship a new version:
1. Bump `version` in `chrome-extension/manifest.json` (e.g. `1.0.1`).
2. Re-zip: `cd chrome-extension && nix run nixpkgs#zip -- -r ../public/inboxiq-meeting-copilot-edge.zip . -x "*.DS_Store"`
3. In the Edge Partner dashboard, click **Update** and upload the new ZIP.
   Subsequent reviews are typically < 24 h.
