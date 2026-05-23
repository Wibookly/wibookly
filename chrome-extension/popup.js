// Popup: lets the user choose an active InboxIQ session and start/stop capture.

if (typeof INBOXIQ_CONFIG === "undefined") {
  throw new Error("InboxIQ extension config failed to load.");
}

const $ = (id) => document.getElementById(id);

async function getAuthToken() {
  const { iq_token } = await chrome.storage.local.get("iq_token");
  return iq_token || null;
}

async function api(path, opts = {}) {
  const token = await getAuthToken();
  const headers = {
    "content-type": "application/json",
    apikey: INBOXIQ_CONFIG.supabaseAnonKey,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers || {}),
  };
  const res = await fetch(`${INBOXIQ_CONFIG.supabaseUrl}${path}`, { ...opts, headers });
  return res;
}

async function loadSessions() {
  const token = await getAuthToken();
  $("signed-in").classList.toggle("hidden", !token);
  $("signed-out").classList.toggle("hidden", !!token);
  if (!token) return;

  const res = await api(
    "/rest/v1/meeting_sessions?status=eq.active&order=started_at.desc&limit=10&select=id,meeting_title,started_at",
  );
  if (!res.ok) {
    $("status").textContent = `Couldn’t load sessions (${res.status}). Open InboxIQ and sign in again.`;
    $("start").disabled = true;
    return;
  }
  const data = res.ok ? await res.json() : [];
  const sel = $("session");
  sel.innerHTML = "";
  if (!data.length) {
    const opt = document.createElement("option");
    opt.textContent = "No active session — open Meeting Copilot in InboxIQ";
    opt.disabled = true;
    sel.appendChild(opt);
    $("start").disabled = true;
  } else {
    data.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.meeting_title || "Untitled meeting";
      sel.appendChild(opt);
    });
    $("start").disabled = false;
  }
}

async function openHandshakePage() {
  const url = new URL(`${INBOXIQ_CONFIG.appUrl}/extension-auth`);
  url.searchParams.set("ext_id", chrome.runtime.id);
  await chrome.tabs.create({ url: url.toString() });
}

async function refreshState() {
  const { iq_capture } = await chrome.storage.local.get("iq_capture");
  const active = !!iq_capture?.active;
  $("dot").classList.toggle("on", active);
  $("dot").classList.toggle("off", !active);
  $("start").disabled = active;
  $("stop").disabled = !active;
  $("status").textContent = active
    ? `Capturing • ${iq_capture.meetingTitle || "session"}`
    : "Idle";
}

$("open-app").addEventListener("click", () => {
  chrome.tabs.create({ url: INBOXIQ_CONFIG.appUrl + "/meeting-copilot" });
});

$("connect-extension")?.addEventListener("click", async () => {
  $("status").textContent = "Opening InboxIQ sign-in…";
  await openHandshakePage();
});

$("start").addEventListener("click", async () => {
  const sessionId = $("session").value;
  const meetingTitle = $("session").selectedOptions[0]?.textContent || "";
  const token = await getAuthToken();
  if (!sessionId || !token) return;
  $("status").textContent = "Requesting tab audio…";
  chrome.runtime.sendMessage(
    { type: "IQ_START_CAPTURE", sessionId, meetingTitle, token },
    (resp) => {
      if (chrome.runtime.lastError) {
        $("status").textContent = chrome.runtime.lastError.message;
      } else if (resp?.error) {
        $("status").textContent = resp.error;
      } else {
        refreshState();
      }
    },
  );
});

$("stop").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "IQ_STOP_CAPTURE" }, () => refreshState());
});

// On open: try to pull the InboxIQ session token from the app tab.
(async () => {
  const tabs = await chrome.tabs.query({
    url: [`${INBOXIQ_CONFIG.appUrl}/*`, "https://*.lovable.app/*", "https://*.lovableproject.com/*"],
  });
  if (tabs[0]) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => {
          for (const k of Object.keys(localStorage)) {
            if (k.startsWith("sb-") && k.endsWith("-auth-token")) {
              try {
                const v = JSON.parse(localStorage.getItem(k));
                return v?.access_token || null;
              } catch (_) {}
            }
          }
          return null;
        },
      });
      if (result) await chrome.storage.local.set({ iq_token: result });
    } catch (_) { /* user may not be signed in */ }
  }
  await loadSessions();
  await refreshState();
})();
