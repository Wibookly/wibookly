import type { Step } from 'react-joyride';
import { emailIntelligenceTour } from './emailIntelligence.tour';
import { aiChatTour } from './aiChat.tour';
import { followUpTour } from './followUp.tour';
import { settingsTour } from './settings.tour';
import { dailyBriefTour } from './dailyBrief.tour';

/**
 * Route prefix → tour steps. Add a new entry per page that should have a guided tour.
 * Order matters — more specific routes should be listed before their prefixes.
 */
export const TOUR_REGISTRY: Record<string, Step[]> = {
  '/categories': emailIntelligenceTour,
  '/chat': aiChatTour,
  '/follow-up-reminder': followUpTour,
  '/settings': settingsTour,
  '/ai-daily-brief': dailyBriefTour,
};
