/**
 * In-page training hints. Each key maps to a `data-tour` attribute already
 * placed on an element somewhere in the app. When the user enables
 * "Training mode" from the floating page-guide pill, every element with a
 * matching `data-tour` gets a dashed glow outline and a hover tooltip
 * explaining what it does and what the user should do with it.
 *
 * To add a hint to a new control: put `data-tour="my-key"` on the element
 * and add an entry here. No other wiring is required.
 */

export interface TrainingHint {
  /** Short label shown at the top of the hover tooltip. */
  title: string;
  /** 1–2 sentences. Plain text. */
  body: string;
  /** Optional action verb shown as a colored chip. */
  action?: string;
}

export const TRAINING_HINTS: Record<string, TrainingHint> = {
  // ── Chat / AI Assistant ─────────────────────────────────────────────
  'chat-new': {
    title: 'Start a new chat',
    body: 'Opens a fresh conversation. Your previous chats stay saved in the list below.',
    action: 'Click',
  },
  'chat-capacity': {
    title: 'Context capacity',
    body: 'Shows how much of the AI model’s memory window the current conversation is using. When it fills up, start a new chat.',
  },
  'chat-attach': {
    title: 'Attach files',
    body: 'Add PDFs, docs, images or spreadsheets so the AI can read them as part of your question.',
    action: 'Click',
  },
  'chat-mic': {
    title: 'Voice input',
    body: 'Hold to dictate your question. We transcribe it locally with Whisper and drop the text in the box.',
    action: 'Hold',
  },
  'chat-web': {
    title: 'Web search',
    body: 'Let the assistant look things up on the live web before answering. Best for news, prices or anything time-sensitive.',
    action: 'Toggle',
  },
  'chat-deep': {
    title: 'Deep research',
    body: 'Triggers a slower, multi-step reasoning pass — useful for long questions where accuracy matters more than speed.',
    action: 'Toggle',
  },
  'chat-input': {
    title: 'Ask anything',
    body: 'Type your question and press Enter. Shift+Enter inserts a new line. The assistant can see your inbox, calendar and uploaded docs.',
    action: 'Type',
  },
};

export type TrainingHintKey = keyof typeof TRAINING_HINTS;
