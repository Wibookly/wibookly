import { useEffect, useState } from 'react';
import { ttsService, type TtsState } from '@/lib/ttsService';

/** Temporary diagnostic page for TTS playback. Remove after debugging. */
export default function TtsTest() {
  const [snap, setSnap] = useState<TtsState>(() => ttsService.getState());
  useEffect(() => ttsService.subscribe(setSnap), []);
  useEffect(() => { ttsService.preload(); }, []);

  return (
    <div className="p-8 space-y-4 text-foreground">
      <h1 className="text-xl font-bold">TTS Test</h1>
      <pre data-testid="tts-state" className="text-xs bg-muted p-2 rounded">
        {JSON.stringify(snap, null, 2)}
      </pre>
      <button
        data-testid="tts-speak"
        className="px-4 py-2 rounded bg-primary text-primary-foreground"
        onClick={() => ttsService.speak('Hello, this is a playback test of the voice system.', 'am_adam', 'test-1')}
      >
        Speak test
      </button>
    </div>
  );
}
