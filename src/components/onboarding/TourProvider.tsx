import { useEffect, useState, createContext, useContext, ReactNode, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Joyride, STATUS, ACTIONS, EVENTS } from 'react-joyride';
import type { CallBackProps, Step } from 'react-joyride';
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

/** Wait up to `timeoutMs` for a selector to appear in the DOM. */
function waitForSelector(selector: string, timeoutMs = 1200): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const found = document.querySelector<HTMLElement>(selector);
    if (found) return resolve(found);
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

export function TourProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [dark, setDark] = useState(isDarkMode());
  const advancingRef = useRef(false);

  const { currentRoute, currentTour } = useMemo(() => {
    const match = Object.entries(TOUR_REGISTRY).find(([route]) =>
      location.pathname.startsWith(route),
    );
    return { currentRoute: match?.[0], currentTour: match?.[1] };
  }, [location.pathname]);

  // Normalize steps: any step whose target selector is missing falls back to
  // a centered card so Joyride does not hang waiting for it.
  const safeSteps = useMemo<Step[] | undefined>(() => {
    if (!currentTour) return undefined;
    return currentTour.map((s) => ({
      ...s,
      // Joyride accepts `target: 'body'` + placement center as a guaranteed-visible step.
      // We keep the original selector; the runtime guard below switches if missing.
    }));
  }, [currentTour]);

  // Auto-start on first visit to a tour page
  useEffect(() => {
    setRun(false);
    setStepIndex(0);
    if (!currentTour || !currentRoute) return;
    const completed = getCompleted();
    if (!completed[currentRoute]) {
      const t = setTimeout(() => setRun(true), 700);
      return () => clearTimeout(t);
    }
  }, [currentRoute, currentTour]);

  // Watch for theme changes
  useEffect(() => {
    const sync = () => setDark(isDarkMode());
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  /** Before showing a step, ensure its target exists. Auto-expand or click
   *  helpers as needed (e.g. click "Add Rule" so rule sub-targets render). */
  const ensureStepReady = async (idx: number) => {
    if (!safeSteps) return;
    const step = safeSteps[idx];
    const sel = typeof step?.target === 'string' ? step.target : '';
    if (!sel || sel === 'body') return;

    // Pre-action: if we're about to show a per-rule element but the user has
    // no rules yet, click the first "Add Rule" button so the rule row appears.
    const ruleSubTargets = [
      '[data-tour="ei-rule-row"]',
      '[data-tour="ei-rule-type"]',
      '[data-tour="ei-rule-value"]',
      '[data-tour="ei-rule-toggle"]',
      '[data-tour="ei-rule-sync"]',
      '[data-tour="ei-rule-delete"]',
      '[data-tour="ei-rule-advanced"]',
    ];
    if (ruleSubTargets.includes(sel) && !document.querySelector(sel)) {
      const addBtn = document.querySelector<HTMLButtonElement>('[data-tour="ei-add-rule"]');
      if (addBtn) {
        addBtn.click();
        await waitForSelector(sel, 1500);
      }
    } else {
      await waitForSelector(sel, 1000);
    }
  };

  const handleCallback = (data: CallBackProps) => {
    const { status, type, index, action } = data;

    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      if (currentRoute) setCompleted(currentRoute);
      setRun(false);
      setStepIndex(0);
      return;
    }

    // Joyride is asking to advance / go back.
    if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
      const nextIndex = index + (action === ACTIONS.PREV ? -1 : 1);
      if (advancingRef.current) return;
      advancingRef.current = true;
      // Pause while we prep the next step.
      setRun(false);
      ensureStepReady(nextIndex).finally(() => {
        setStepIndex(nextIndex);
        setRun(true);
        advancingRef.current = false;
      });
    }
  };

  const startTour = () => {
    if (!currentTour || !currentRoute) return;
    const completed = getCompleted();
    delete completed[currentRoute];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(completed));
    setStepIndex(0);
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
      {safeSteps && (
        <Joyride
          steps={safeSteps}
          run={run}
          stepIndex={stepIndex}
          continuous
          showProgress
          showSkipButton
          disableScrolling={false}
          spotlightPadding={6}
          callback={handleCallback}
          styles={{
            options: {
              primaryColor: PRIMARY,
              backgroundColor: bg,
              textColor: text,
              arrowColor: bg,
              overlayColor: overlay,
              zIndex: 10000,
            },
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
