import { useEffect, useState, createContext, useContext, ReactNode, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { Joyride, STATUS } from 'react-joyride';
import type { EventData, Step } from 'react-joyride';
import { TOUR_REGISTRY } from './tours/index';

const STORAGE_KEY = 'iq_tour_completed';

type CompletedMap = Record<string, boolean>;
type TourContextType = {
  startTour: () => void;
  hasTourForCurrentPage: boolean;
};

const TourContext = createContext<TourContextType>({
  startTour: () => {},
  hasTourForCurrentPage: false,
});

export const useTour = () => useContext(TourContext);

function getCompleted(): CompletedMap {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function setCompleted(route: string) {
  const current = getCompleted();
  current[route] = true;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
}

function isDarkMode(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    document.documentElement.classList.contains('dark') ||
    document.body.classList.contains('dark')
  );
}

const RULE_SUB_TARGETS = new Set([
  '[data-tour="ei-rule-row"]',
  '[data-tour="ei-rule-type"]',
  '[data-tour="ei-rule-value"]',
  '[data-tour="ei-rule-toggle"]',
  '[data-tour="ei-rule-sync"]',
  '[data-tour="ei-rule-delete"]',
  '[data-tour="ei-rule-advanced"]',
]);

function waitForSelector(selector: string, timeoutMs = 1500): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLElement>(selector);
    if (existing) return resolve(existing);
    const started = Date.now();
    const iv = window.setInterval(() => {
      const el = document.querySelector<HTMLElement>(selector);
      if (el) {
        window.clearInterval(iv);
        resolve(el);
      } else if (Date.now() - started > timeoutMs) {
        window.clearInterval(iv);
        resolve(null);
      }
    }, 80);
  });
}

/**
 * Global `before` hook: runs before each step is shown. If the upcoming
 * step targets a per-rule element but no rule exists yet, programmatically
 * click "Add Rule" so the targets actually render.
 */
async function ensureStepReady(data: { step: { target?: unknown } }): Promise<void> {
  const sel = typeof data.step?.target === 'string' ? (data.step.target as string) : '';
  if (!sel || sel === 'body') return;

  if (RULE_SUB_TARGETS.has(sel) && !document.querySelector(sel)) {
    const addBtn = document.querySelector<HTMLButtonElement>('[data-tour="ei-add-rule"]');
    if (addBtn) {
      addBtn.click();
      await waitForSelector(sel, 2000);
      return;
    }
  }
  await waitForSelector(sel, 1200);
}

export function TourProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [run, setRun] = useState(false);
  const [dark, setDark] = useState(isDarkMode());

  const { currentRoute, currentTour } = useMemo(() => {
    const match = Object.entries(TOUR_REGISTRY).find(([route]) =>
      location.pathname.startsWith(route),
    );
    return { currentRoute: match?.[0], currentTour: match?.[1] as Step[] | undefined };
  }, [location.pathname]);

  // Auto-start disabled by user preference. Tours never start on page load
  // or refresh — the user must explicitly launch them from the Help panel or
  // the "Tour this page" button.
  useEffect(() => {
    setRun(false);
  }, [currentRoute, currentTour]);


  // Watch for theme changes
  useEffect(() => {
    const sync = () => setDark(isDarkMode());
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const handleEvent = (data: EventData) => {
    const status = (data as { status?: string }).status;
    if ((status === STATUS.FINISHED || status === STATUS.SKIPPED) && currentRoute) {
      setCompleted(currentRoute);
      setRun(false);
    }
  };

  const startTour = () => {
    if (!currentTour || !currentRoute) return;
    const completed = getCompleted();
    delete completed[currentRoute];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(completed));
    setRun(true);
  };

  const PRIMARY = '#6366f1';
  const bg = dark ? '#1e1e2e' : '#ffffff';
  const text = dark ? '#f5f5f5' : '#1a1a2e';
  const overlay = dark ? 'rgba(0,0,0,0.65)' : 'rgba(15, 23, 42, 0.45)';

  return (
    <TourContext.Provider
      value={{ startTour, hasTourForCurrentPage: !!currentTour }}
    >
      {currentTour && (
        <Joyride
          steps={currentTour}
          run={run}
          continuous
          onEvent={handleEvent}
          options={{
            primaryColor: PRIMARY,
            backgroundColor: bg,
            textColor: text,
            arrowColor: bg,
            overlayColor: overlay,
            zIndex: 10000,
            showProgress: true,
            spotlightPadding: 6,
            buttons: ['back', 'skip', 'primary'],
            // If a target never appears we don't want to hang the tour
            // forever — bail out after ~1.5s and Joyride will skip / center.
            targetWaitTimeout: 1500,
            // Before each step, expand or seed the UI the step needs.
            before: ensureStepReady,
            beforeTimeout: 2500,
          }}
          locale={{
            back: 'Back',
            close: 'Close',
            last: 'Done',
            next: 'Next',
            skip: 'Skip',
          }}
        />
      )}
      {children}
    </TourContext.Provider>
  );
}
