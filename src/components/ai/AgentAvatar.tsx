import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import agentMove from '@/assets/agent-move.mp4';
import agentStatic from '@/assets/agent-static.png';

interface AgentAvatarProps {
  /** When true, plays the looping thinking video. When false, shows the static portrait. */
  active?: boolean;
  className?: string;
}

/**
 * The InboxIQ AI agent avatar.
 * - Idle: static branded portrait (agent-static.png).
 * - Active (AI thinking): looping video (agent-move.mp4).
 */
export function AgentAvatar({ active = false, className }: AgentAvatarProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active) {
      v.currentTime = 0;
      v.play().catch(() => {});
    }
  }, [active]);

  const baseClass = cn(
    'object-contain rounded-2xl bg-gradient-to-br from-primary/15 via-background to-accent/15 ring-1 ring-border',
    className,
  );

  if (active) {
    return (
      <video
        ref={ref}
        src={agentMove}
        muted
        loop
        playsInline
        preload="auto"
        className={baseClass}
        aria-label="InboxIQ AI agent thinking"
      />
    );
  }

  return (
    <img
      src={agentStatic}
      alt="InboxIQ AI agent"
      className={baseClass}
      draggable={false}
    />
  );
}
