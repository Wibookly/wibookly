import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GROUPS } from './shared/inventory';
import { StatusDot } from './shared/StatusDot';
import { Icon } from './shared/Icon';
import { useIntegrationHealth, statusOf, aggregateStatus } from './hooks/useIntegrationHealth';
import { IntegrationsMonitorCard } from './IntegrationsMonitorCard';

export type SelectedNode =
  | { type: 'provider'; id: string }
  | { type: 'sub'; id: string }
  | { type: 'feature'; id: string }
  | { type: 'hub'; id: string };

export function IntegrationsSidebar({
  selected,
  onSelect,
}: {
  selected: SelectedNode;
  onSelect: (n: SelectedNode) => void;
}) {
  const { rows } = useIntegrationHealth();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ microsoft: true });

  const toggle = (id: string) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  return (
    <aside className="w-[240px] shrink-0">
      <IntegrationsMonitorCard />
      <nav className="rounded-lg border bg-card overflow-hidden">
        {GROUPS.map((g) => {
          const isHubSelected = selected.type === 'hub' && selected.id === g.hubId;
          return (
            <div key={g.id} className="py-2">
              <button
                type="button"
                disabled={!g.hubId}
                onClick={() => g.hubId && onSelect({ type: 'hub', id: g.hubId })}
                className={cn(
                  'w-full text-left px-3 text-[10px] uppercase tracking-[0.08em] text-muted-foreground py-1',
                  g.hubId && 'hover:text-foreground cursor-pointer',
                  isHubSelected && 'text-foreground font-semibold',
                )}
              >
                {g.label}
              </button>
              <div>
                {(g.providers ?? []).map((p) => {
                  const isSelected = selected.type === 'provider' && selected.id === p.id;
                  const isExpanded = expanded[p.id] ?? false;
                  const hasSubs = p.subs.length > 0;
                  return (
                    <div key={p.id}>
                      <div
                        className={cn(
                          'group flex items-center gap-1.5 px-2 py-1.5 mx-1 rounded-md cursor-pointer hover:bg-muted/60',
                          isSelected && 'bg-muted',
                        )}
                      >
                        {hasSubs ? (
                          <button onClick={(e) => { e.stopPropagation(); toggle(p.id); }} className="p-0.5">
                            <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-90')} />
                          </button>
                        ) : (
                          <span className="w-4" />
                        )}
                        <button
                          type="button"
                          className="flex-1 flex items-center gap-2 min-w-0"
                          onClick={() => { onSelect({ type: 'provider', id: p.id }); if (hasSubs) setExpanded((x) => ({ ...x, [p.id]: true })); }}
                        >
                          <Icon name={p.icon} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="text-[13px] truncate">{p.name}</span>
                          {hasSubs && <span className="text-[10px] text-muted-foreground">({p.subs.length})</span>}
                          <span className="ml-auto"><StatusDot status={statusOf(rows, p.id)} /></span>
                        </button>
                      </div>
                      {hasSubs && isExpanded && (
                        <div className="ml-[26px] border-l border-border/60">
                          {p.subs.map((s) => {
                            const subSel = selected.type === 'sub' && selected.id === s.id;
                            return (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => onSelect({ type: 'sub', id: s.id })}
                                className={cn(
                                  'w-full text-left flex items-center gap-2 pl-3 pr-2 py-1.5 mr-1 ml-[-1px] border-l-2 border-transparent',
                                  subSel ? 'border-primary bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
                                )}
                              >
                                <Icon name={s.icon} className="h-3 w-3 shrink-0" />
                                <span className="text-[12px] truncate">{s.name}</span>
                                <span className="ml-auto"><StatusDot status={statusOf(rows, s.id)} /></span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {(g.features ?? []).map((f) => {
                  const isSelected = selected.type === 'feature' && selected.id === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => onSelect({ type: 'feature', id: f.id })}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-1.5 mx-1 rounded-md hover:bg-muted/60',
                        isSelected && 'bg-muted',
                      )}
                    >
                      <span className="w-4" />
                      <Icon name={f.icon} className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[13px] truncate">{f.name}</span>
                      <span className="ml-auto"><StatusDot status={statusOf(rows, f.id)} /></span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
