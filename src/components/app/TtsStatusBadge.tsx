import { useEffect, useState } from 'react';
import { Loader2, Volume2, AlertCircle } from 'lucide-react';
import { ttsService, type TtsState } from '@/lib/ttsService';

/**
 * Per-user, browser-local indicator confirming the in-browser Kokoro TTS
 * model has finished downloading and is ready to read messages aloud.
 * Visible only to the signed-in user in their own browser (not server state).
 */
export function TtsStatusBadge() {
  const [snap, setSnap] = useState<TtsState>(() => ttsService.getState());

  useEffect(() => ttsService.subscribe(setSnap), []);

  // Hide while idle OR while the model is still downloading — users only want
  // a confirmation that the voice is ready (or that something failed).
  if (snap.modelState === 'idle' || snap.modelState === 'loading') return null;

  const { color, bg, border, icon, label, title } = (() => {
    if (snap.modelState === 'ready') {
      return {
        color: 'var(--success, #16a34a)',
        bg: 'color-mix(in srgb, var(--success, #16a34a) 12%, transparent)',
        border: 'color-mix(in srgb, var(--success, #16a34a) 35%, transparent)',
        icon: <Volume2 className="w-3.5 h-3.5" />,
        label: 'Voice ready',
        title: 'Read-aloud is ready in this browser. Click ▶ on any chat message.',
      };
    }
    return {
      color: 'var(--danger, #dc2626)',
      bg: 'color-mix(in srgb, var(--danger, #dc2626) 12%, transparent)',
      border: 'color-mix(in srgb, var(--danger, #dc2626) 35%, transparent)',
      icon: <AlertCircle className="w-3.5 h-3.5" />,
      label: 'Voice error',
      title: snap.error || 'Voice model failed to load.',
    };
  })();

  return (
    <div
      title={title}
      className="hidden sm:inline-flex items-center gap-1.5 px-2.5 h-8 rounded-full text-xs font-medium"
      style={{ background: bg, border: `1px solid ${border}`, color }}
    >
      {icon}
      <span>{label}</span>
    </div>
  );
}
