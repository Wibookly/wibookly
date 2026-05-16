import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import agentMove from '@/assets/agent-move.mp4';

interface AgentAvatarProps {
  /** When true, the avatar animates (thinking). When false, holds first frame. */
  active?: boolean;
  className?: string;
}

/**
 * The InboxIQ AI agent avatar. Renders a looping video of the agent head.
 * When `active` is true (AI is thinking), the video plays. Otherwise it
 * pauses on the first frame so it reads as a static logo.
 */
export function AgentAvatar({ active = false, className }: AgentAvatarProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active) {
      v.currentTime = 0;
      v.play().catch(() => {});
    } else {
      v.pause();
      try { v.currentTime = 0; } catch { /* ignore */ }
    }
  }, [active]);

  return (
    <video
      ref={ref}
      src={agentMove}
      muted
      loop
      playsInline
      preload="auto"
      className={cn('object-cover rounded-2xl', className)}
      aria-label="InboxIQ AI agent"
    />
  );
}
