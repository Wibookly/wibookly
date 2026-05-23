// src/pages/ExtensionAuth.tsx
//
// Drop this file into your Lovable project under src/pages/ExtensionAuth.tsx
// and register the route in src/App.tsx:
//
//   <Route path="/extension-auth" element={<ExtensionAuth />} />
//
// This page is opened by the InboxIQ Chrome extension when the user clicks
// "Sign in with InboxIQ" inside the side panel. The flow:
//
//   1. Extension opens https://inboxiq.energyforward.com/extension-auth?ext_id=<id>
//   2. If user is already signed in to the web app, we immediately post the
//      Supabase session to the extension via chrome.runtime.sendMessage and close.
//   3. If not signed in, we redirect to /auth (your normal Microsoft SSO).
//      The user signs in, Microsoft redirects back through microsoft-sso-callback,
//      which lands them back at this page (because we preserve the ext_id in
//      sessionStorage), at which point step 2 fires.

import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const SS_KEY = "inboxiq_ext_id";

export default function ExtensionAuth() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"checking" | "signed-in" | "signed-out" | "posting" | "done" | "error">("checking");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Preserve ext_id across the OAuth redirect (Microsoft → microsoft-sso-callback → here)
  useEffect(() => {
    const fromUrl = params.get("ext_id");
    if (fromUrl) sessionStorage.setItem(SS_KEY, fromUrl);
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const extId = params.get("ext_id") || sessionStorage.getItem(SS_KEY);
        if (!extId) {
          setErrorMsg("Missing extension id. Please launch this page from the InboxIQ extension.");
          setStatus("error");
          return;
        }

        // Check session
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        if (!data.session) {
          // Not signed in — send the user through normal Microsoft SSO.
          // They'll come back to this same URL after callback.
          setStatus("signed-out");
          // Slight delay so user sees the message
          setTimeout(() => {
            navigate(`/auth?return_to=${encodeURIComponent(window.location.pathname + window.location.search)}`);
          }, 600);
          return;
        }

        if (cancelled) return;

        // Signed in — post the session to the extension
        setStatus("posting");
        const payload = {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at,
          user: data.session.user
        };

        // chrome.runtime.sendMessage to the specific extension id.
        // This works because the extension's manifest lists this domain in
        // `externally_connectable.matches`.
        const w = window as unknown as {
          chrome?: {
            runtime?: {
              sendMessage: (id: string, message: unknown, callback?: (response: unknown) => void) => void;
            };
          };
        };

        if (!w.chrome?.runtime?.sendMessage) {
          setErrorMsg("The InboxIQ extension wasn't detected in this browser. Make sure it's installed and enabled, then try again.");
          setStatus("error");
          return;
        }

        await new Promise<void>((resolve, reject) => {
          w.chrome!.runtime!.sendMessage(
            extId,
            { type: "EXT_SET_SESSION", session: payload },
            (response: unknown) => {
              const r = response as { ok?: boolean; reason?: string } | undefined;
              if (r?.ok) resolve();
              else reject(new Error(r?.reason || "Extension did not acknowledge."));
            }
          );
        });

        sessionStorage.removeItem(SS_KEY);
        setStatus("done");
        // Auto-close the tab after 1.5s
        setTimeout(() => { try { window.close(); } catch (_) { /* may not be allowed */ } }, 1500);
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : String(e);
        setErrorMsg(m);
        setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [params, navigate]);

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.ef}>EF</div>
        <div style={styles.title}>InboxIQ Meeting Copilot</div>

        {status === "checking" && <p style={styles.muted}>Checking your session…</p>}

        {status === "signed-out" && (
          <p style={styles.muted}>Redirecting you to sign in with Microsoft…</p>
        )}

        {status === "posting" && (
          <p style={styles.muted}>Connecting the extension…</p>
        )}

        {status === "done" && (
          <>
            <p style={styles.success}>✓ Extension connected.</p>
            <p style={styles.muted}>You can close this tab. Open the side panel from the Chrome toolbar to start using the Copilot.</p>
          </>
        )}

        {status === "error" && (
          <>
            <p style={styles.error}>Couldn&apos;t complete the handshake.</p>
            <p style={styles.muted}>{errorMsg}</p>
            <button onClick={() => window.location.reload()} style={styles.btn}>Try again</button>
          </>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    background: "linear-gradient(135deg, #5B21B6 0%, #8B5CF6 50%, #EC4899 100%)",
    padding: "24px"
  },
  card: {
    maxWidth: 420,
    width: "100%",
    background: "#FFFFFF",
    borderRadius: 16,
    padding: 28,
    boxShadow: "0 20px 60px rgba(15,21,53,0.25)",
    textAlign: "center",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
  },
  ef: {
    width: 48,
    height: 48,
    borderRadius: 12,
    background: "linear-gradient(135deg, #5B21B6 0%, #EC4899 100%)",
    color: "#fff",
    display: "grid",
    placeItems: "center",
    fontWeight: 700,
    margin: "0 auto 16px"
  },
  title: {
    fontSize: 20,
    fontWeight: 600,
    color: "#050B26",
    marginBottom: 16
  },
  muted: { color: "#5D6585", lineHeight: 1.5 },
  success: { color: "#16A34A", fontWeight: 600, marginBottom: 8 },
  error: { color: "#DC2626", fontWeight: 600, marginBottom: 8 },
  btn: {
    marginTop: 16,
    padding: "10px 18px",
    background: "linear-gradient(135deg, #5B21B6 0%, #EC4899 100%)",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontWeight: 600,
    cursor: "pointer"
  }
};
