// Device detection runs once at startup. The TTS service uses it to pick
// the starting tier of the cascade:
//   Tier 1  Kokoro       (desktop/laptop) — best voice, ~86MB
//   Tier 2  KittenTTS    (mobile/tablet)  — ~25MB INT8
//   Tier 3  speechSynth  (anywhere)        — zero download, always works
// The cascade in ttsService.ts auto-falls down if a tier fails or times out.

function detect() {
  if (typeof navigator === 'undefined') {
    return { isIOS: false, isAndroid: false, isMobile: false, preferredTier: 1 as 1 | 2 };
  }
  const ua = navigator.userAgent || '';
  // iPadOS 13+ reports as desktop Safari — catch it via maxTouchPoints.
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    ((navigator as any).platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isMobile = isIOS || isAndroid;
  const preferredTier: 1 | 2 = isMobile ? 2 : 1;
  return { isIOS, isAndroid, isMobile, preferredTier };
}

const info = detect();

try {
  console.log('[tts] device:',
    info.isIOS ? 'iOS' : info.isAndroid ? 'Android' : 'desktop',
    '— starting tier:', info.preferredTier);
} catch { /* ignore */ }

export const deviceEngine = info;
export const preferredTier = info.preferredTier;
// Legacy export (still imported by useKokoroTTS) — true only when starting on Tier 1.
export const useKokoroEngine = info.preferredTier === 1;
