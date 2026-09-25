# Nikkore Inbox Meeting Copilot — Chrome Extension

Captures the audio of your current meeting tab (Teams / Zoom Web / Google Meet / Webex), transcribes it in real time, and pushes lines into the **Live Copilot** session you opened in Nikkore Inbox. No bot joins the meeting; other attendees see nothing.

## Load in Chrome (developer mode)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked** and select this `chrome-extension/` folder.
4. Pin the extension to the toolbar.

> Replace `icons/icon-16.png`, `icons/icon-32.png`, `icons/icon-128.png` with your real artwork before publishing. Placeholders are not included.

## Use it

1. Sign in to Nikkore Inbox (https://inboxiq.energyforward.com) in any tab.
2. Open **Meeting Copilot** in Nikkore Inbox and click **Open Copilot** on the live meeting — this creates an active session.
3. Switch to your meeting tab (Teams / Zoom Web / Meet / Webex).
4. Click the Nikkore Inbox extension icon → pick the session → **Start capture**.
5. Watch the transcript and AI suggestions appear in Nikkore Inbox in real time.
6. Click **Stop** when the meeting ends, then **End & Summarize** in Nikkore Inbox.

## How it works

- The popup grabs the current Nikkore Inbox session token from `localStorage` of the open Nikkore Inbox tab.
- `background.js` requests a `tabCapture` media stream ID for the active meeting tab and hands it to an offscreen document.
- `offscreen.js` records 6-second Opus chunks and posts them (base64) to the `voice-to-text` edge function (OpenAI Whisper).
- Transcribed text is forwarded to `meeting-copilot-ingest`, which writes a `meeting_transcripts` row and (optionally) triggers `meeting-copilot-suggestion`.
- Audio is never persisted — only transcript text is stored, scoped to your account via RLS.

## Privacy

- Audio is processed in real time and discarded; nothing is saved on disk.
- Only the text transcript leaves your machine, encrypted in transit (HTTPS).
- The extension uses no third-party servers. All requests go directly to your Nikkore Inbox backend.

## Config

Edit `config.js` if you point at a different Nikkore Inbox deployment:

```js
self.INBOXIQ_CONFIG = {
  appUrl: "https://inboxiq.energyforward.com",
  supabaseUrl: "...",
  supabaseAnonKey: "...",
};
```
