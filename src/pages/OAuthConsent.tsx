import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { InboxIQLogo } from "@/components/app/InboxIQLogo";

// Typed wrapper — supabase.auth.oauth namespace is beta and may not be in
// the generated types yet.
type OAuthClient = {
  name?: string;
  client_name?: string;
  client_uri?: string;
};
type AuthorizationDetails = {
  client?: OAuthClient;
  redirect_url?: string;
  redirect_to?: string;
  scopes?: string[];
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const oauth: any = (supabase.auth as any).oauth;

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Missing authorization_id");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/auth?return_to=" + encodeURIComponent(next);
        return;
      }
      if (!oauth?.getAuthorizationDetails) {
        setError("OAuth server not available in this client.");
        return;
      }
      const { data, error: err } = await oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (err) {
        setError(err.message);
        return;
      }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data as AuthorizationDetails);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error: err } = approve
      ? await oauth.approveAuthorization(authorizationId)
      : await oauth.denyAuthorization(authorizationId);
    if (err) {
      setBusy(false);
      setError(err.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  const clientName = details?.client?.client_name ?? details?.client?.name ?? "an app";

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-md bg-card border border-border rounded-xl p-8 space-y-6 shadow-lg">
        <div className="flex justify-center">
          <InboxIQLogo />
        </div>
        {error ? (
          <div className="space-y-2">
            <h1 className="text-lg font-semibold">Could not load this authorization</h1>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        ) : !details ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading authorization…
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <h1 className="text-lg font-semibold">Connect {clientName} to InboxIQ</h1>
              <p className="text-sm text-muted-foreground">
                {clientName} is requesting access to use InboxIQ tools as you. You can revoke this access at any time.
              </p>
              {details.scopes && details.scopes.length > 0 && (
                <ul className="text-xs text-muted-foreground list-disc pl-5 pt-2">
                  {details.scopes.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" disabled={busy} onClick={() => decide(false)}>
                Deny
              </Button>
              <Button disabled={busy} onClick={() => decide(true)}>
                {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Approve
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
