export interface HomeWidgetDef {
  id: string;
  title: string;
  component: string;
  defaultEnabled: boolean;
  defaultLimit: number;
  route: string;
  routeFilter?: Record<string, string>;
}

export const CORE_WIDGETS: HomeWidgetDef[] = [
  { id: 'digest',      title: 'Daily digest',     component: 'GlanceCard',       defaultEnabled: true,  defaultLimit: 1, route: '/brief' },
  { id: 'needs_reply', title: 'Needs your reply', component: 'NeedsReplyWidget', defaultEnabled: true,  defaultLimit: 3, route: '/flagged-email-tracker', routeFilter: { filter: 'needs_reply', sort: 'impact' } },
  { id: 'today',       title: 'Today',            component: 'TodayWidget',      defaultEnabled: true,  defaultLimit: 4, route: '/helm-calendar', routeFilter: { view: 'day' } },
  { id: 'commitments', title: 'Commitments',      component: 'CommitmentsWidget',defaultEnabled: false, defaultLimit: 3, route: '/follow-up-reminder', routeFilter: { tab: 'commitments' } },
  { id: 'waiting_on',  title: 'Waiting on',       component: 'WaitingOnWidget',  defaultEnabled: true,  defaultLimit: 3, route: '/follow-up-reminder', routeFilter: { tab: 'waiting' } },
];

export const CORE_WIDGET_IDS = new Set(CORE_WIDGETS.map(w => w.id));

export function categoryWidget(categoryId: string, name: string): HomeWidgetDef {
  return {
    id: `category:${categoryId}`,
    title: name,
    component: 'CategoryWidget',
    defaultEnabled: true,
    defaultLimit: 3,
    route: '/flagged-email-tracker',
    routeFilter: { category: categoryId },
  };
}

export function buildRouteHref(w: HomeWidgetDef): string {
  if (!w.routeFilter) return w.route;
  const q = new URLSearchParams(w.routeFilter).toString();
  return `${w.route}?${q}`;
}
