import { useEffect, useState } from 'react';
import { Volume2, AlertCircle, Download } from 'lucide-react';
import { ttsService, type TtsState } from '@/lib/ttsService';

/**
 * Per-user, browser-local indicator confirming the in-browser Kokoro TTS
 * model has finished downloading and is ready to read messages aloud.
 * Shows live download percentage while the model is being fetched.
 *
 * `compact` renders an icon-only pill suitable for the mobile header.
 */
export function TtsStatusBadge({ compact = false }: { compact?: boolean } = {}) {
  const [snap, setSnap] = useState<TtsState>(() => ttsService.getState());

  useEffect(() => ttsService.subscribe(setSnap), []);

  if (snap.modelState === 'idle') return null;

  const pct = Math.max(0, Math.min(100, Math.round(snap.progress || 0)));

  const { color, bg, border, icon, label, title } = (() => {
    if (snap.modelState === 'loading') {
      return {
        color: 'var(--warning, #d97706)',
        bg: 'color-mix(in srgb, var(--warning, #d97706) 12%, transparent)',
        border: 'color-mix(in srgb, var(--warning, #d97706) 35%, transparent)',
        icon: <Download className="w-3.5 h-3.5 animate-pulse" />,
        label: `Voice ${pct}%`,
        title: `Downloading voice model… ${pct}% (one-time; cached for next visits).`,
      };
    }
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

  if (compact) {
    return (
      <div
        title={title}
        aria-label={label}
        className={`inline-flex items-center justify-center gap-1 rounded-full ${snap.modelState === 'loading' ? 'px-2 h-8 text-[10px] font-semibold' : 'w-8 h-8'}`}
        style={{ background: bg, border: `1px solid ${border}`, color }}
      >
        {icon}
        {snap.modelState === 'loading' && <span>{pct}%</span>}
      </div>
    );
  }

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
