/**
 * Custom DOM events used to coordinate the help system across components
 * without coupling them through React context.
 */
export const RESTART_SETUP_WIZARD_EVENT = 'inboxiq:restart-setup-wizard';
export const OPEN_HELP_PANEL_EVENT = 'inboxiq:open-help-panel';

/** Optional payload for OPEN_HELP_PANEL_EVENT to deep-link to an article. */
export interface OpenHelpPanelDetail {
  articleId?: string;
}
