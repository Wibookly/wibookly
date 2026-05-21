import { useEffect, useState, createContext, useContext, ReactNode, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import Joyride, { CallBackProps, STATUS, Step } from 'react-joyride';
import { TOUR_REGISTRY } from './tours';

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

export function TourProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [run, setRun] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [dark, setDark] = useState(isDarkMode());

  const { currentRoute, currentTour } = useMemo(() => {
    const match = Object.entries(TOUR_REGISTRY).find(([route]) =>
      location.pathname.startsWith(route),
    );
    return { currentRoute: match?.[0], currentTour: match?.[1] };
  }, [location.pathname]);

  // Auto-start on first visit to a tour page
  useEffect(() => {
    setRun(false);
    if (!currentTour || !currentRoute) return;
    const completed = getCompleted();
    if (!completed[currentRoute]) {
      // Slight delay to allow page to render targets
      const t = setTimeout(() => {
        setSteps(currentTour);
        setRun(true);
      }, 600);
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

  const handleCallback = (data: CallBackProps) => {
    const { status } = data;
    if (
      (status === STATUS.FINISHED || status === STATUS.SKIPPED) &&
      currentRoute
    ) {
      setCompleted(currentRoute);
      setRun(false);
    }
  };

  const startTour = () => {
    if (!currentTour || !currentRoute) return;
    const completed = getCompleted();
    delete completed[currentRoute];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(completed));
    setSteps(currentTour);
    setRun(true);
  };

  const PRIMARY = '#6366f1';
  const bg = dark ? '#1e1e2e' : '#ffffff';
  const text = dark ? '#f5f5f5' : '#1a1a2e';

  return (
    <TourContext.Provider
      value={{ startTour, hasTourForCurrentPage: !!currentTour }}
    >
      <Joyride
        steps={steps}
        run={run}
        callback={handleCallback}
        continuous
        showProgress
        showSkipButton
        scrollToFirstStep
        disableScrolling={false}
        spotlightPadding={6}
        styles={{
          options: {
            primaryColor: PRIMARY,
            backgroundColor: bg,
            textColor: text,
            arrowColor: bg,
            overlayColor: dark ? 'rgba(0,0,0,0.65)' : 'rgba(15, 23, 42, 0.45)',
            zIndex: 10000,
            width: 360,
          },
          tooltipContainer: { textAlign: 'left' },
          tooltipTitle: { color: text, fontWeight: 600 },
          buttonNext: { backgroundColor: PRIMARY, borderRadius: 8 },
          buttonBack: { color: PRIMARY },
          buttonSkip: { color: dark ? '#cbd5e1' : '#64748b' },
        }}
        locale={{
          back: 'Back',
          close: 'Close',
          last: 'Done',
          next: 'Next',
          skip: 'Skip',
        }}
      />
      {children}
    </TourContext.Provider>
  );
}
