// Offscreen document: holds the MediaStream, chunks audio, posts to InboxIQ
// for transcription and ingestion. We send ~6-second WebM/Opus chunks to the
// `transcribe-audio` edge function and forward the resulting text to
// `meeting-copilot-ingest`.

let mediaStream = null;
let inputStreams = [];
let recorder = null;
let context = null;
let chunkTimer = null;
let buffer = [];
let cfg = null;

async function transcribeBlob(blob) {
  const buf = await blob.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  const res = await fetch(`${cfg.supabaseUrl}/functions/v1/voice-to-text`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: cfg.supabaseAnonKey,
      Authorization: `Bearer ${cfg.token}`,
    },
    body: JSON.stringify({ audio: b64, mime_type: blob.type || recorder?.mimeType || "audio/webm" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw new Error(data?.error || `transcribe ${res.status}`);
  return (data.text || data.transcript || "").trim();
}

async function ingestLine(text) {
  if (!text) return;
  const res = await fetch(`${cfg.supabaseUrl}/functions/v1/meeting-copilot-ingest`, {
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
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw new Error(data?.error || `ingest ${res.status}`);
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

async function start(streamId, includeMic = false) {
  const tabStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
    },
    video: {
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
    },
  });

  inputStreams = [tabStream];
  context = new AudioContext();
  const destination = context.createMediaStreamDestination();

  const tabSource = context.createMediaStreamSource(tabStream);
  tabSource.connect(destination);
  tabSource.connect(context.destination);

  if (includeMic) {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      inputStreams.push(micStream);
      const micSource = context.createMediaStreamSource(micStream);
      micSource.connect(destination);
    } catch (e) {
      console.warn("InboxIQ microphone capture unavailable", e);
    }
  }

  mediaStream = destination.stream;

  const preferredMimeTypes = ["audio/webm;codecs=opus", "audio/webm", "video/webm;codecs=vp8,opus", "video/webm"];
  const recorderMime = preferredMimeTypes.find((type) => MediaRecorder.isTypeSupported(type)) || "audio/webm";
  recorder = new MediaRecorder(mediaStream, { mimeType: recorderMime });
  recorder.ondataavailable = (e) => { if (e.data.size) buffer.push(e.data); };
  recorder.start(1000);

  chunkTimer = setInterval(flushChunk, 6000);
}

function stop() {
  clearInterval(chunkTimer); chunkTimer = null;
  try { recorder?.stop(); } catch (_) {}
  try { inputStreams.forEach((s) => s?.getTracks().forEach((t) => t.stop())); } catch (_) {}
  try { mediaStream?.getTracks().forEach((t) => t.stop()); } catch (_) {}
  try { context?.close(); } catch (_) {}
  recorder = null; mediaStream = null; context = null; inputStreams = [];
  flushChunk();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== "offscreen") return;
  if (msg.type === "OFFSCREEN_START") {
    cfg = {
      sessionId: msg.sessionId, token: msg.token,
      supabaseUrl: msg.supabaseUrl, supabaseAnonKey: msg.supabaseAnonKey,
    };
    start(msg.streamId, !!msg.includeMic).catch((e) => console.error("InboxIQ start failed", e));
  } else if (msg.type === "OFFSCREEN_STOP") {
    stop();
  }
});
