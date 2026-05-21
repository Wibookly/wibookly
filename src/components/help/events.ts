/**
 * Custom DOM events used to coordinate the help system across components
 * without coupling them through React context.
 */
export const RESTART_SETUP_WIZARD_EVENT = 'inboxiq:restart-setup-wizard';
export const OPEN_HELP_PANEL_EVENT = 'inboxiq:open-help-panel';
export const START_GUIDED_TOUR_EVENT = 'inboxiq:start-guided-tour';

/** Optional payload for OPEN_HELP_PANEL_EVENT to deep-link to an article. */
export interface OpenHelpPanelDetail {
  articleId?: string;
  /** Optionally open the panel directly on a specific tab. */
  initialTab?: 'articles' | 'chat' | 'issue';
}

/** Payload for START_GUIDED_TOUR_EVENT — which article's tour to launch. */
export interface StartGuidedTourDetail {
  articleId: string;
}
