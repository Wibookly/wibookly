// Offscreen document: holds the MediaStream, chunks audio, posts to InboxIQ
// for transcription and ingestion. We send ~6-second WebM/Opus chunks to the
// `transcribe-audio` edge function and forward the resulting text to
// `meeting-copilot-ingest`.

let mediaStream = null;
let recorder = null;
let context = null;
let chunkTimer = null;
let buffer = [];
let cfg = null;

async function transcribeBlob(blob) {
  const buf = await blob.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  const res = await fetch(`${cfg.supabaseUrl}/functions/v1/transcribe-audio`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: cfg.supabaseAnonKey,
      Authorization: `Bearer ${cfg.token}`,
    },
    body: JSON.stringify({ audio: b64, mimeType: blob.type }),
  });
  if (!res.ok) throw new Error(`transcribe ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return (data.text || data.transcript || "").trim();
}

async function ingestLine(text) {
  if (!text) return;
  await fetch(`${cfg.supabaseUrl}/functions/v1/meeting-copilot-ingest`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: cfg.supabaseAnonKey,
      Authorization: `Bearer ${cfg.token}`,
    },
    body: JSON.stringify({
      sessionId: cfg.sessionId,
      lines: [{ speaker: "Other", text, spoken_at: new Date().toISOString() }],
      requestSuggestion: true,
    }),
  });
}

async function flushChunk() {
  if (buffer.length === 0) return;
  const blob = new Blob(buffer, { type: recorder?.mimeType || "audio/webm" });
  buffer = [];
  try {
    const text = await transcribeBlob(blob);
    if (text) await ingestLine(text);
  } catch (e) {
    console.warn("InboxIQ chunk failed", e);
  }
}

async function start(streamId) {
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
    },
    video: false,
  });

  // Keep tab audio audible to the user.
  context = new AudioContext();
  const src = context.createMediaStreamSource(mediaStream);
  src.connect(context.destination);

  recorder = new MediaRecorder(mediaStream, { mimeType: "audio/webm;codecs=opus" });
  recorder.ondataavailable = (e) => { if (e.data.size) buffer.push(e.data); };
  recorder.start(1000);

  chunkTimer = setInterval(flushChunk, 6000);
}

function stop() {
  clearInterval(chunkTimer); chunkTimer = null;
  try { recorder?.stop(); } catch (_) {}
  try { mediaStream?.getTracks().forEach((t) => t.stop()); } catch (_) {}
  try { context?.close(); } catch (_) {}
  recorder = null; mediaStream = null; context = null;
  flushChunk();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== "offscreen") return;
  if (msg.type === "OFFSCREEN_START") {
    cfg = {
      sessionId: msg.sessionId, token: msg.token,
      supabaseUrl: msg.supabaseUrl, supabaseAnonKey: msg.supabaseAnonKey,
    };
    start(msg.streamId).catch((e) => console.error("InboxIQ start failed", e));
  } else if (msg.type === "OFFSCREEN_STOP") {
    stop();
  }
});
