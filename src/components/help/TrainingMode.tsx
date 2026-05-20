import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { GraduationCap } from 'lucide-react';
import { TRAINING_HINTS } from '@/config/training-hints';

/**
 * Training mode — turns the whole app into an interactive tutorial.
 *
 * When enabled (via the PageGuide pill), every element with a `data-tour`
 * attribute gets a dashed glow outline. Hovering an element shows a small
 * floating tooltip with the title / body / action defined in
 * `src/config/training-hints.ts`.
 *
 * The state is intentionally global (window event + body data attribute)
 * so any page can opt in for free just by adding `data-tour` attributes.
 */

const STORAGE_KEY = 'inboxiq-training-mode';
export const TRAINING_MODE_TOGGLE_EVENT = 'inboxiq:training-mode-toggle';

export function isTrainingModeEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setTrainingMode(enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(
    new CustomEvent(TRAINING_MODE_TOGGLE_EVENT, { detail: { enabled } }),
  );
}

export function useTrainingMode(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState(isTrainingModeEnabled);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ enabled: boolean }>).detail;
      setEnabled(!!detail?.enabled);
    };
    window.addEventListener(TRAINING_MODE_TOGGLE_EVENT, handler);
    return () => window.removeEventListener(TRAINING_MODE_TOGGLE_EVENT, handler);
  }, []);
  return [enabled, setTrainingMode];
}

interface HoverState {
  key: string;
  rect: DOMRect;
}

/**
 * Global overlay. Mounts once in AppLayout. Listens for pointer events on
 * `[data-tour]` elements while training mode is on, and renders a floating
 * tooltip + a glowing ring around the hovered element.
 */
export function TrainingModeOverlay() {
  const [enabled, setEnabled] = useState(isTrainingModeEnabled);
  const [hover, setHover] = useState<HoverState | null>(null);
  const rafRef = useRef<number | null>(null);

  // Subscribe to enable/disable
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ enabled: boolean }>).detail;
      setEnabled(!!detail?.enabled);
      if (!detail?.enabled) setHover(null);
    };
    window.addEventListener(TRAINING_MODE_TOGGLE_EVENT, handler);
    return () => window.removeEventListener(TRAINING_MODE_TOGGLE_EVENT, handler);
  }, []);

  // Toggle a body data-attribute so CSS in index.css can paint the
  // dashed outlines on every [data-tour] element.
  useEffect(() => {
    if (enabled) document.body.dataset.trainingMode = '1';
    else delete document.body.dataset.trainingMode;
    return () => { delete document.body.dataset.trainingMode; };
  }, [enabled]);

  // Pointer tracking
  useEffect(() => {
    if (!enabled) return;
    const onOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-tour]') as
        | HTMLElement
        | null;
      if (!el) return;
      const key = el.getAttribute('data-tour');
      if (!key || !TRAINING_HINTS[key]) return;
      setHover({ key, rect: el.getBoundingClientRect() });
    };
    const onOut = (e: MouseEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      if (related?.closest?.('[data-tour]')) return;
      setHover(null);
    };
    const onScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        setHover((prev) => {
          if (!prev) return prev;
          const el = document.querySelector(
            `[data-tour="${CSS.escape(prev.key)}"]`,
          ) as HTMLElement | null;
          if (!el) return null;
          return { key: prev.key, rect: el.getBoundingClientRect() };
        });
      });
    };
    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [enabled]);

  const dismiss = useCallback(() => setTrainingMode(false), []);

  if (!enabled) return null;

  const hint = hover ? TRAINING_HINTS[hover.key] : null;

  // Position tooltip: prefer below the element, fall back to above.
  const tooltipStyle: React.CSSProperties | null = (() => {
    if (!hover) return null;
    const { rect } = hover;
    const margin = 12;
    const tipWidth = 320;
    const top = rect.bottom + margin;
    const wantBelow = top + 140 < window.innerHeight;
    const left = Math.max(
      12,
      Math.min(
        rect.left + rect.width / 2 - tipWidth / 2,
        window.innerWidth - tipWidth - 12,
      ),
    );
    return {
      position: 'fixed',
      left,
      top: wantBelow ? top : rect.top - margin - 140,
      width: tipWidth,
      zIndex: 9999,
    };
  })();

  // Spotlight ring around the hovered element.
  const ringStyle: React.CSSProperties | null = (() => {
    if (!hover) return null;
    const pad = 6;
    return {
      position: 'fixed',
      left: hover.rect.left - pad,
      top: hover.rect.top - pad,
      width: hover.rect.width + pad * 2,
      height: hover.rect.height + pad * 2,
      borderRadius: 10,
      pointerEvents: 'none',
      boxShadow:
        '0 0 0 2px hsl(var(--primary)), 0 0 0 8px hsl(var(--primary) / 0.18), 0 12px 40px -10px hsl(var(--primary) / 0.6)',
      zIndex: 9998,
      transition: 'all 120ms ease-out',
    };
  })();

  return createPortal(
    <>
      {/* Top banner so users know they're in training mode */}
      <div
        className="fixed top-3 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-1.5 text-xs font-semibold shadow-lg ring-2 ring-primary/40"
        style={{
          boxShadow:
            '0 0 0 4px hsl(var(--primary) / 0.18), 0 10px 30px -10px hsl(var(--primary) / 0.5)',
        }}
      >
        <GraduationCap className="h-3.5 w-3.5" />
        <span>Training mode — hover any highlighted control</span>
        <button
          type="button"
          onClick={dismiss}
          className="ml-2 rounded-full bg-primary-foreground/15 hover:bg-primary-foreground/25 px-2 py-0.5 text-[10px] uppercase tracking-wide"
        >
          Exit
        </button>
      </div>

      {ringStyle && <div style={ringStyle} />}

      {hint && tooltipStyle && (
        <div
          style={tooltipStyle}
          className="rounded-xl border bg-popover text-popover-foreground shadow-2xl p-3.5 animate-in fade-in-0 zoom-in-95"
        >
          <div className="flex items-center gap-2 mb-1.5">
            {hint.action && (
              <span className="inline-flex items-center rounded-full bg-primary/15 text-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                {hint.action}
              </span>
            )}
            <p className="text-sm font-semibold leading-tight">{hint.title}</p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {hint.body}
          </p>
        </div>
      )}
    </>,
    document.body,
  );
}
