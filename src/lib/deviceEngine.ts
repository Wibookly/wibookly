// Lightweight device detection. TTS now runs entirely on the hosted Kokoro
// server, so we no longer pick a "tier" — this just exposes basic flags
// for any UI that wants to branch on form factor.

function detect() {
  if (typeof navigator === 'undefined') {
    return { isIOS: false, isAndroid: false, isMobile: false };
  }
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    ((navigator as any).platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isMobile = isIOS || isAndroid;
  return { isIOS, isAndroid, isMobile };
}

export const deviceEngine = detect();
