// Service worker: coordinates tab capture via an offscreen document.
importScripts("config.js");

const OFFSCREEN_PATH = "offscreen.html";

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument?.()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ["USER_MEDIA"],
    justification: "Capture meeting tab audio for live transcription.",
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "IQ_START_CAPTURE") {
      try {
        const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
        if (!tab) return sendResponse({ error: "No active tab" });
        const streamId = await new Promise((resolve, reject) => {
          chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (id) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(id);
          });
        });
        await ensureOffscreen();
        await chrome.storage.local.set({
          iq_capture: {
            active: true,
            sessionId: msg.sessionId,
            meetingTitle: msg.meetingTitle,
            token: msg.token,
            startedAt: Date.now(),
          },
        });
        chrome.runtime.sendMessage({
          target: "offscreen",
          type: "OFFSCREEN_START",
          streamId,
          sessionId: msg.sessionId,
          token: msg.token,
          supabaseUrl: INBOXIQ_CONFIG.supabaseUrl,
          supabaseAnonKey: INBOXIQ_CONFIG.supabaseAnonKey,
        });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ error: e?.message || "capture failed" });
      }
    } else if (msg?.type === "IQ_STOP_CAPTURE") {
      chrome.runtime.sendMessage({ target: "offscreen", type: "OFFSCREEN_STOP" });
      await chrome.storage.local.set({ iq_capture: { active: false } });
      sendResponse({ ok: true });
    }
  })();
  return true; // async
});
