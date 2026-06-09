import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';

const PHASES = [
  'Reading your inbox',
  'Searching context',
  'Analyzing patterns',
  'Composing response',
];

/**
 * Compact text-only AI thinking indicator (Claude-style).
 * Shows a small animated sparkle plus a shimmering rotating status line.
 * No avatar image — keeps the chat surface light while streaming starts.
 */
export function AIThinking({ label }: { label?: string }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (label) return;
    const id = setInterval(() => setPhase((p) => (p + 1) % PHASES.length), 1600);
    return () => clearInterval(id);
  }, [label]);

  return (
    <div className="inline-flex items-center gap-2 py-1">
      <Sparkles
        className="h-3.5 w-3.5 text-primary animate-pulse"
        aria-hidden="true"
      />
      <span className="ai-think-shimmer text-sm font-medium">
        {label ?? PHASES[phase]}
        <span className="ai-think-dots ml-0.5">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </span>
    </div>
  );
}
