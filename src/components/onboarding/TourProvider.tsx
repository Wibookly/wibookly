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

export function TourProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [run, setRun] = useState(false);
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
