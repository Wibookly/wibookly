import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ttsService } from '@/lib/ttsService';
import { useAuth } from '@/lib/auth';

/** Best-effort browser detection from the UA string. */
function detectBrowser(ua: string) {
  let browser_name = 'Unknown';
  let browser_version = '';
  const tests: Array<[string, RegExp]> = [
    ['Edge', /Edg\/([\d.]+)/],
    ['Opera', /OPR\/([\d.]+)/],
    ['Chrome', /Chrome\/([\d.]+)/],
    ['Firefox', /Firefox\/([\d.]+)/],
    ['Safari', /Version\/([\d.]+).*Safari/],
  ];
  for (const [name, re] of tests) {
    const m = ua.match(re);
    if (m) { browser_name = name; browser_version = m[1]; break; }
  }
  let os_name = 'Unknown';
  if (/Windows/i.test(ua)) os_name = 'Windows';
  else if (/Android/i.test(ua)) os_name = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os_name = 'iOS';
  else if (/Mac OS X/i.test(ua)) os_name = 'macOS';
  else if (/Linux/i.test(ua)) os_name = 'Linux';
  const device_type = /Mobi|Android|iPhone|iPod/.test(ua)
    ? 'mobile'
    : /iPad|Tablet/.test(ua) ? 'tablet' : 'desktop';
  return { browser_name, browser_version, os_name, device_type };
}

/**
 * Reports the signed-in user's browser + in-browser TTS readiness to
 * `user_client_status`. Used by the admin Roles tab to show a per-user
 * green/orange/gray voice indicator and the browser they're on.
 */
export function useReportClientStatus() {
  const { user, profile } = useAuth();

  useEffect(() => {
    if (!user?.id) return;
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const meta = detectBrowser(ua);

    let lastPayload = '';
    let cancelled = false;
    let timer: number | null = null;

    const push = (override?: { tts_state?: string; tts_error?: string | null }) => {
      const snap = ttsService.getState();
      const tts_state =
        override?.tts_state ??
        (snap.modelState === 'ready' ? 'ready'
          : snap.modelState === 'loading' ? 'loading'
          : snap.modelState === 'error' ? 'error'
          : 'unused');
      const payload = {
        user_id: user.id,
        organization_id: profile?.organization_id ?? null,
        ...meta,
        user_agent: ua.slice(0, 500),
        tts_state,
        tts_error: override?.tts_error ?? snap.error ?? null,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const key = JSON.stringify({ ...payload, last_seen_at: '', updated_at: '' });
      if (key === lastPayload) {
        // Just heartbeat last_seen_at every few minutes
        void supabase.from('user_client_status')
          .update({ last_seen_at: payload.last_seen_at })
          .eq('user_id', user.id);
        return;
      }
      lastPayload = key;
      void supabase
        .from('user_client_status')
        .upsert(payload, { onConflict: 'user_id' });
    };

    push();
    const unsub = ttsService.subscribe(() => {
      if (cancelled) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => push(), 500);
    });
    const heartbeat = window.setInterval(() => push(), 5 * 60 * 1000);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      window.clearInterval(heartbeat);
      unsub?.();
    };
  }, [user?.id, profile?.organization_id]);
}
