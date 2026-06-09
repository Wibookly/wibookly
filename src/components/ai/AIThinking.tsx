import { Sparkles } from 'lucide-react';

/**
 * Claude-style thinking indicator.
 * Larger rotating sparkle "star" + shimmering "Thinking" text beside it.
 */
export function AIThinking({ label }: { label?: string }) {
  return (
    <div className="inline-flex items-center gap-3 py-1">
      <Sparkles
        className="h-6 w-6 text-primary ai-think-spin"
        aria-hidden="true"
      />
      <span className="ai-think-shimmer text-base font-semibold tracking-tight">
        {label ?? 'Thinking'}
        <span className="ai-think-dots ml-0.5">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </span>
    </div>
  );
}
