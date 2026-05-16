import { useEffect, useState } from 'react';
import { AgentAvatar } from './AgentAvatar';

const PHASES = [
  'Reading your inbox',
  'Searching context',
  'Analyzing patterns',
  'Composing response',
];

/**
 * AI thinking indicator. Shows the animated agent avatar (looping video)
 * alongside a rotating status message — used while the AI is generating.
 */
export function AIThinking({ label }: { label?: string }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (label) return;
    const id = setInterval(() => setPhase((p) => (p + 1) % PHASES.length), 1600);
    return () => clearInterval(id);
  }, [label]);

  return (
    <div className="flex items-center gap-3 rounded-2xl px-4 py-3 bg-gradient-to-r from-primary/10 via-accent/10 to-primary/10 border border-primary/20 shadow-sm">
      <AgentAvatar active className="w-10 h-10 shrink-0" />
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-medium text-foreground">
          {label ?? PHASES[phase]}
          <span className="ai-think-dots ml-0.5">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </span>
        <span className="text-[11px] text-muted-foreground tracking-wide uppercase">
          AI is thinking
        </span>
      </div>
    </div>
  );
}
