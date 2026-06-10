import { useEffect, useState } from 'react';
import { ttsService, type TtsState } from '@/lib/ttsService';
import { Loader2, Volume2 } from 'lucide-react';

/**
 * Subtle, non-blocking pill that shows while the Kokoro TTS model is
 * preloading in the background. Disappears once the model is ready.
 */
export function TtsPreloadIndicator() {
  const [s, setS] = useState<TtsState>(() => ttsService.getState());
  useEffect(() => ttsService.subscribe(setS), []);

  if (s.modelState !== 'loading') return null;

  return (
    <div className="fixed bottom-3 right-3 z-40 pointer-events-none">
      <div className="flex items-center gap-2 rounded-full bg-background/80 backdrop-blur border border-border px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
        <Loader2 className="w-3 h-3 animate-spin" />
        <Volume2 className="w-3 h-3" />
        <span>Preparing voice…</span>
      </div>
    </div>
  );
}
