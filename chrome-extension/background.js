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

chrome.runtime.onMessageExternal.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type !== "EXT_SET_SESSION" || !msg?.session?.access_token) {
      return sendResponse({ ok: false, reason: "invalid_message" });
    }

    try {
      await chrome.storage.local.set({
        iq_token: msg.session.access_token,
        iq_session: msg.session,
      });
      sendResponse({ ok: true });
    } catch (e) {
      sendResponse({ ok: false, reason: e?.message || "storage_failed" });
    }
  })();

  return true;
});

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
          includeMic: true,
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
    } else if (msg?.type === "IQ_GET_CAPTURE_STATE") {
      const { iq_capture } = await chrome.storage.local.get("iq_capture");
      sendResponse({ ok: true, active: !!iq_capture?.active, sessionId: iq_capture?.sessionId || null });
    }
  })();
  return true; // async
});
