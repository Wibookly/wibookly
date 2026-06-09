import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';

const DEFAULT_PHASES = [
  'Thinking',
  'Reading your request',
  'Accessing files',
  'Searching your inbox',
  'Looking up context',
  'Analyzing results',
  'Composing response',
];

/**
 * Claude-style AI activity indicator.
 * - Large rotating sparkle "star" with a soft glow (always visible).
 * - Shimmering status text beside it that cycles through what the agent is doing.
 * - Pass `label` to lock the text to a specific activity (e.g. "Creating draft").
 */
export function AIThinking({
  label,
  phases = DEFAULT_PHASES,
}: {
  label?: string;
  phases?: string[];
}) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (label) return;
    const id = setInterval(() => setPhase((p) => (p + 1) % phases.length), 1800);
    return () => clearInterval(id);
  }, [label, phases.length]);

  return (
    <div className="inline-flex items-center gap-3 py-2">
      <Sparkles
        className="h-7 w-7 text-primary ai-think-spin shrink-0"
        strokeWidth={2.25}
        aria-hidden="true"
      />
      <span className="ai-think-shimmer text-base font-semibold tracking-tight">
        {label ?? phases[phase]}
        <span className="ai-think-dots ml-0.5">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </span>
    </div>
  );
}
