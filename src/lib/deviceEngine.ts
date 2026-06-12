// One-time device detection. Decides whether read-aloud uses the in-browser
// Kokoro model (desktop/laptop) or the OS-native window.speechSynthesis voice
// (mobile/tablet). Kokoro cannot load reliably on iPhone/iPad Safari.

function detect() {
  if (typeof navigator === 'undefined') {
    return { isIOS: false, isAndroid: false, isMobile: false, useKokoro: true };
  }
  const ua = navigator.userAgent || '';
  // iPadOS 13+ reports as desktop Safari — catch it via maxTouchPoints.
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    ((navigator as any).platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isMobile = isIOS || isAndroid;
  // Mobile/tablet -> built-in voice; desktop/laptop -> Kokoro.
  const useKokoro = !isMobile;
  return { isIOS, isAndroid, isMobile, useKokoro };
}

const info = detect();

try {
  console.log('[tts] device detection:',
    info.isIOS ? 'iOS' : info.isAndroid ? 'Android' : 'desktop',
    '— engine:', info.useKokoro ? 'kokoro' : 'speechSynthesis');
} catch { /* ignore */ }

export const deviceEngine = info;
export const useKokoroEngine = info.useKokoro;
