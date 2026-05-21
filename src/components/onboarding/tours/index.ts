import type { Step } from 'react-joyride';
import { emailIntelligenceTour } from './emailIntelligence.tour';

/**
 * Route prefix → tour steps. Add a new entry per page that should have a guided tour.
 * The most specific path should come first (longest prefix wins is NOT enforced — order matters).
 */
export const TOUR_REGISTRY: Record<string, Step[]> = {
  '/categories': emailIntelligenceTour,
};
