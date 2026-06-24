import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  HELP_ARTICLES,
  type HelpArticle,
  type HelpStep,
} from '@/config/help-content';
import {
  START_GUIDED_TOUR_EVENT,
  type StartGuidedTourDetail,
} from './events';
import { TOUR_REGISTRY } from '@/components/onboarding/tours/index';


/**
 * Full-screen guided tour overlay.
 *
 * - Listens for `START_GUIDED_TOUR_EVENT` and runs through an article's steps.
 * - Each step can have an optional `target` CSS selector; when present the
 *   overlay spotlights that element with a soft cut-out and a pulsing ring,
 *   and shows the step card next to it.
 * - Steps without a target render as a centered card (intro/outro style).
 * - Multi-page tours work via the optional `route` field on a step.
 */

interface ActiveTour {
  article: HelpArticle;
  steps: HelpStep[];
  index: number;
}

const PADDING = 10;
const CARD_WIDTH = 360;
const CARD_GAP = 16;

export function GuidedTour() {
  const location = useLocation();
  const navigate = useNavigate();
  const [tour, setTour] = useState<ActiveTour | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [viewport, setViewport] = useState({
    w: typeof window !== 'undefined' ? window.innerWidth : 1024,
    h: typeof window !== 'undefined' ? window.innerHeight : 768,
  });
  const rafRef = useRef<number | null>(null);

  /* ---------- start / stop ---------- */

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<StartGuidedTourDetail>).detail;
      if (!detail?.articleId) return;
      const article = HELP_ARTICLES.find((a) => a.id === detail.articleId);
      if (!article || !article.steps?.length) return;
      // If the article declares a primary route and we're not there, go.
      const primaryRoute = article.routes?.[0];
      if (primaryRoute && location.pathname !== primaryRoute) {
        navigate(primaryRoute);
      }
      setTour({ article, steps: article.steps, index: 0 });
    };
    window.addEventListener(START_GUIDED_TOUR_EVENT, handler as EventListener);
    return () =>
      window.removeEventListener(START_GUIDED_TOUR_EVENT, handler as EventListener);
  }, [location.pathname, navigate]);

  const close = useCallback(() => {
    setTour(null);
    setRect(null);
  }, []);

  /* ---------- ESC + scroll lock ---------- */

  useEffect(() => {
    if (!tour) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour, close]);

  /* ---------- track viewport size ---------- */

  useEffect(() => {
    const onResize = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /* ---------- resolve target element for current step ---------- */

  const currentStep = tour ? tour.steps[tour.index] : null;

  // Navigate if step has a route that differs from current.
  useEffect(() => {
    if (!currentStep?.route) return;
    if (location.pathname !== currentStep.route) {
      navigate(currentStep.route);
    }
  }, [currentStep, location.pathname, navigate]);

  // Find the element and keep its rect updated on scroll/resize/mutation.
  useEffect(() => {
    if (!currentStep?.target) {
      setRect(null);
      return;
    }
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    let mutationObs: MutationObserver | null = null;

    const findAndTrack = () => {
      const el = document.querySelector<HTMLElement>(currentStep.target!);
      if (!el) {
        if (!cancelled) setRect(null);
        return null;
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      const update = () => {
        if (cancelled) return;
        const r = el.getBoundingClientRect();
        setRect(r);
      };
      update();
      // Refresh during smooth scroll.
      let frames = 0;
      const tick = () => {
        if (cancelled || frames++ > 40) return;
        update();
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      observer = new ResizeObserver(update);
      observer.observe(el);
      window.addEventListener('scroll', update, true);
      window.addEventListener('resize', update);
      return () => {
        window.removeEventListener('scroll', update, true);
        window.removeEventListener('resize', update);
      };
    };

    let cleanup = findAndTrack();
    // If target not yet mounted (e.g. just navigated), retry briefly.
    if (!cleanup) {
      let tries = 0;
      const id = window.setInterval(() => {
        tries += 1;
        cleanup = findAndTrack();
        if (cleanup || tries > 20) window.clearInterval(id);
      }, 150);
      return () => {
        cancelled = true;
        window.clearInterval(id);
        if (observer) observer.disconnect();
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      };
    }

    return () => {
      cancelled = true;
      cleanup?.();
      if (observer) observer.disconnect();
      if (mutationObs) mutationObs.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [currentStep, location.pathname]);

  /* ---------- navigation ---------- */

  const next = useCallback(() => {
    setTour((t) => {
      if (!t) return t;
      if (t.index >= t.steps.length - 1) {
        return null; // finish
      }
      return { ...t, index: t.index + 1 };
    });
  }, []);

  const prev = useCallback(() => {
    setTour((t) => {
      if (!t) return t;
      if (t.index <= 0) return t;
      return { ...t, index: t.index - 1 };
    });
  }, []);

  /* ---------- compute card position ---------- */

  const cardStyle = useMemo<React.CSSProperties>(() => {
    const width = Math.min(CARD_WIDTH, viewport.w - 32);
    const estHeight = 240; // approximate card height incl. padding
    if (!rect) {
      return {
        left: Math.max(16, viewport.w / 2 - width / 2),
        top: Math.max(16, viewport.h / 2 - 140),
        width,
      };
    }

    // Compute available space on each side of the spotlight.
    const spaceBelow = viewport.h - rect.bottom - CARD_GAP - 16;
    const spaceAbove = rect.top - CARD_GAP - 16;
    const spaceRight = viewport.w - rect.right - CARD_GAP - 16;
    const spaceLeft = rect.left - CARD_GAP - 16;

    type Placement = { side: 'below' | 'above' | 'right' | 'left'; score: number };
    const candidates: Placement[] = [
      { side: 'right', score: spaceRight >= width ? 1000 + spaceRight : spaceRight },
      { side: 'left', score: spaceLeft >= width ? 1000 + spaceLeft : spaceLeft },
      { side: 'below', score: spaceBelow >= estHeight ? 1000 + spaceBelow : spaceBelow },
      { side: 'above', score: spaceAbove >= estHeight ? 1000 + spaceAbove : spaceAbove },
    ];
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0].side;

    let left = 16;
    let top = 16;
    if (best === 'right') {
      left = Math.min(viewport.w - width - 16, rect.right + CARD_GAP);
      top = Math.max(16, Math.min(viewport.h - estHeight - 16, rect.top + rect.height / 2 - estHeight / 2));
    } else if (best === 'left') {
      left = Math.max(16, rect.left - CARD_GAP - width);
      top = Math.max(16, Math.min(viewport.h - estHeight - 16, rect.top + rect.height / 2 - estHeight / 2));
    } else if (best === 'below') {
      top = Math.min(viewport.h - estHeight - 16, rect.bottom + CARD_GAP);
      left = Math.max(16, Math.min(viewport.w - width - 16, rect.left + rect.width / 2 - width / 2));
    } else {
      top = Math.max(16, rect.top - CARD_GAP - estHeight);
      left = Math.max(16, Math.min(viewport.w - width - 16, rect.left + rect.width / 2 - width / 2));
    }
    return { left, top, width };
  }, [rect, viewport]);

  if (!tour || !currentStep) return null;

  const total = tour.steps.length;
  const isLast = tour.index === total - 1;
  const isFirst = tour.index === 0;
  const progress = ((tour.index + 1) / total) * 100;

  /* ---------- render via portal ---------- */

  const overlay = (
    <div
      className="fixed inset-0 z-[100] animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label={`Guided tour: ${tour.article.title}`}
    >
      {/* SVG dimmer with spotlight cut-out */}
      <svg
        width="100%"
        height="100%"
        className="absolute inset-0 pointer-events-auto"
        onClick={close}
      >
        <defs>
          <mask id="tour-spotlight">
            <rect width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={Math.max(0, rect.left - PADDING)}
                y={Math.max(0, rect.top - PADDING)}
                width={rect.width + PADDING * 2}
                height={rect.height + PADDING * 2}
                rx={12}
                ry={12}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(8, 12, 24, 0.62)"
          mask="url(#tour-spotlight)"
        />
      </svg>

      {/* Pulsing ring around the highlighted element */}
      {rect && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-xl ring-2 ring-primary/80 animate-pulse"
          style={{
            left: rect.left - PADDING,
            top: rect.top - PADDING,
            width: rect.width + PADDING * 2,
            height: rect.height + PADDING * 2,
            boxShadow:
              '0 0 0 4px hsl(var(--primary) / 0.25), 0 12px 40px -10px hsl(var(--primary) / 0.55)',
          }}
        />
      )}

      {/* Step card */}
      <div
        className={cn(
          'absolute rounded-2xl border bg-card text-card-foreground shadow-2xl',
          'animate-in fade-in slide-in-from-bottom-2 duration-200',
        )}
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress bar */}
        <div className="h-1 rounded-t-2xl bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span>
                Step {tour.index + 1} of {total} · {tour.article.title}
              </span>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close guided tour"
              className="rounded-md p-1 -mr-1 -mt-1 hover:bg-muted transition"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          <div>
            <h3 className="text-base font-semibold text-foreground leading-tight">
              {currentStep.title}
            </h3>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              {currentStep.description}
            </p>
            {currentStep.target && !rect && (
              <p className="text-[11px] mt-2 text-amber-600 dark:text-amber-400">
                Looking for this element on the page…
              </p>
            )}
          </div>

          <div className="flex items-center justify-between pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={close}
              className="text-xs text-muted-foreground"
            >
              Skip tour
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={prev}
                disabled={isFirst}
                className="h-8 px-2"
              >
                <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
              </Button>
              <Button size="sm" onClick={next} className="h-8 px-3">
                {isLast ? (
                  'Finish'
                ) : (
                  <>
                    Next <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
