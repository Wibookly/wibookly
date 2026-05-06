import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';

const PHASES = [
  'Reading your inbox',
  'Searching context',
  'Analyzing patterns',
  'Composing response',
];

/**
 * Futuristic AI thinking indicator. Animated orbiting ring with a glowing
 * sparkle core and rotating status messages. Works in both light and dark
 * themes by using semantic tokens + the primary/accent gradients from the
 * active theme.
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
      <div className="relative flex items-center justify-center w-9 h-9">
        {/* Outer pulsing ring */}
        <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
        {/* Rotating gradient ring */}
        <div
          className="absolute inset-0 rounded-full ai-think-ring"
          style={{
            background:
              'conic-gradient(from 0deg, hsl(var(--primary)) 0%, hsl(var(--accent)) 50%, transparent 75%, hsl(var(--primary)) 100%)',
            mask: 'radial-gradient(circle, transparent 55%, black 56%)',
            WebkitMask: 'radial-gradient(circle, transparent 55%, black 56%)',
          }}
        />
        {/* Core */}
        <div className="relative w-6 h-6 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/40">
          <Sparkles className="w-3.5 h-3.5 text-primary-foreground" />
        </div>
      </div>

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
