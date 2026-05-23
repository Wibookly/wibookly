# Meeting Copilot Redesign Plan

Major restructure of `/meeting-copilot` and the live session view based on your feedback.

## 1. Main page (`src/pages/MeetingCopilot.tsx`)

**Remove**
- The red-bordered "What Meeting Copilot knows about you" profile card. Replace with a single small line:
  *"Using your profile from My Profile & Signature →"* (link to Settings).

**Copilot Behavior card — make collapsible**
- Wrap in `<Collapsible>` (shadcn), collapsed by default with a one-line summary chip ("Auto-join ON · Conversational · Auto-draft ON").
- Keep all 3 toggles + suggestion-style picker inside.
- Under **Auto-draft follow-up**, add helper text:
  *"Drafts are saved to your `0. AI Draft` follow-up category in Outlook for review before sending."*
- Add a new sub-section **Notifications** (like the Cluely screenshot):
  - Scheduled meetings (1 min before)
  - Auto-detected meetings
- Add a new sub-section **Audio Settings**:
  - Microphone source dropdown
  - "Test Microphone" button → opens a compact inline panel with a live waveform (Web Audio API analyser, animated bars like ChatGPT voice mode)
  - Same for Speaker test (tone + bars)
- Add a new sub-section **Shortcuts**:
  - List of keyboard shortcuts ("Ask a question", "Quick answer", "End session")
  - Each editable (input to rebind), stored in `meeting_copilot_settings`.

**Per-meeting tone override**
- On each Upcoming Meeting row add a small dropdown: tone = Concise / Conversational / Strategic (defaults to global setting). Stored in `meeting_copilot_preferences`.

## 2. Upcoming Meetings → Pre-meeting prep

When user clicks a meeting card, navigate to **new page** `/meeting-copilot/prep/:meetingId`:
- Header: meeting subject, time, attendees
- AI-generated **Prep Brief** (new edge function `meeting-copilot-prep`):
  - Pulls meeting subject + body + any attached files (via Graph `/me/events/{id}?$expand=attachments`)
  - Pulls related prior emails with same attendees
  - Generates: context summary, **questions you should ask**, **likely questions you'll be asked + suggested answers**, talking points
- "Join meeting" button (launches live session with prep loaded as context)

## 3. Live session redesign (`LiveCopilotSession.tsx`)

Remove the visible live transcript from the main area (still captured silently). New layout:

```text
┌────────────────────────────────────────────────────┐
│  Prep summary (from step 2) — collapsible top bar  │
├──────────────────────┬─────────────────────────────┤
│  WHAT TO ASK         │  WHAT TO ANSWER             │
│  (AI-detected        │  (AI-detected when someone  │
│   opportunities to   │   asks YOU a question —     │
│   ask smart Qs)      │   pops with suggested reply)│
└──────────────────────┴─────────────────────────────┘
   [ tiny mic indicator + End session ]
```

- Use `google/gemini-3-flash-preview` with intent routing already in `meeting-copilot-suggestion`.
- When the AI detects a direct question to the user (heuristic: question mark + 2nd-person + recent silence), it pushes an "answer" suggestion into the right column with a subtle pulse.
- Transcript still accessible via a small "View transcript" drawer button (not in main view).

## 4. Database (small migration)

- Add `shortcuts jsonb`, `notify_scheduled bool`, `notify_detected bool`, `microphone_device_id text` to `meeting_copilot_settings`.
- Add `tone_override text` to `meeting_copilot_preferences`.

## 5. Files

**Edit**
- `src/pages/MeetingCopilot.tsx` — remove profile card, collapsible behavior, notifications, audio, shortcuts, per-meeting tone, navigate to prep on click.
- `src/components/meeting/LiveCopilotSession.tsx` — two-column "Ask / Answer" layout, hide transcript, ChatGPT-style mic waveform.
- `supabase/functions/meeting-copilot-suggestion/index.ts` — better answer-detection heuristic.

**Create**
- `src/pages/MeetingPrep.tsx` + route
- `src/components/meeting/AudioTestPanel.tsx` (waveform + bars)
- `src/components/meeting/ShortcutsEditor.tsx`
- `supabase/functions/meeting-copilot-prep/index.ts`
- Migration for new columns.

## Notes / open questions

- Drafts category: I'll use your existing `0. AI Draft` category convention (per project memory).
- Shortcuts will only fire while the live session window is focused (browser limitation — no global OS hotkeys without a desktop app).
- Speaker test will play a short test tone since browsers don't expose live speaker output levels.

Approve and I'll build it.