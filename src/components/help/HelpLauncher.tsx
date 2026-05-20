import { useEffect, useRef, useState } from 'react';
import { LifeBuoy, GripVertical } from 'lucide-react';
import { HelpPanel } from './HelpPanel';
import { OPEN_HELP_PANEL_EVENT, type OpenHelpPanelDetail } from './events';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'inboxiq-help-launcher-y';
const BTN_SIZE = 48; // px
const EDGE_PAD = 16;

/**
 * Floating, draggable Help & Support button. Anchored to the right edge of the
 * viewport; the user can drag it up or down to any vertical position that
 * doesn't overlap their current work. Position persists across sessions.
 */
export function HelpLauncher() {
  const [open, setOpen] = useState(false);
  const [initialArticleId, setInitialArticleId] = useState<string | null>(null);
  const [y, setY] = useState<number>(() => {
    if (typeof window === 'undefined') return 600;
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(saved) && saved > 0) return saved;
    // Default: just above the chat composer.
    return Math.max(EDGE_PAD, window.innerHeight - 140);
  });
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{ offsetY: number; moved: boolean }>({ offsetY: 0, moved: false });

  // Allow other components (e.g. <HelpDot articleId="..." />) to open the panel.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<OpenHelpPanelDetail>).detail;
      setInitialArticleId(detail?.articleId ?? null);
      setOpen(true);
    };
    window.addEventListener(OPEN_HELP_PANEL_EVENT, handler);
    return () => window.removeEventListener(OPEN_HELP_PANEL_EVENT, handler);
  }, []);

  // Keep button inside viewport on resize.
  useEffect(() => {
    const onResize = () => {
      setY((prev) => clampY(prev));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const clampY = (val: number) => {
    if (typeof window === 'undefined') return val;
    const max = window.innerHeight - BTN_SIZE - EDGE_PAD;
    return Math.min(Math.max(EDGE_PAD, val), max);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const nextY = clampY(e.clientY - dragState.current.offsetY);
      dragState.current.moved = true;
      setY(nextY);
    };
    const onUp = () => {
      setDragging(false);
      try { localStorage.setItem(STORAGE_KEY, String(y)); } catch { /* ignore */ }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, y]);

  const onPointerDown = (e: React.PointerEvent) => {
    dragState.current.offsetY = e.clientY - y;
    dragState.current.moved = false;
    setDragging(true);
  };

  const handleClick = () => {
    // Suppress click if the user actually dragged.
    if (dragState.current.moved) {
      dragState.current.moved = false;
      return;
    }
    setInitialArticleId(null);
    setOpen(true);
  };

  return (
    <>
      <div
        style={{ top: y, right: EDGE_PAD }}
        className={cn(
          'fixed z-40 flex items-center gap-1 select-none',
          dragging && 'cursor-grabbing',
        )}
      >
        <button
          type="button"
          aria-label="Drag help button"
          onPointerDown={onPointerDown}
          className={cn(
            'flex h-12 w-5 items-center justify-center rounded-l-md bg-muted/80 hover:bg-muted text-muted-foreground border border-r-0 border-border shadow',
            dragging ? 'cursor-grabbing' : 'cursor-grab',
          )}
          title="Drag to move"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleClick}
          aria-label="Open help and support"
          title="Help & Support"
          className="group flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl hover:shadow-2xl transition-transform hover:scale-105"
        >
          <LifeBuoy className="h-5 w-5" />
          <span className="sr-only">Help &amp; Support</span>
        </button>
      </div>
      <HelpPanel
        open={open}
        onOpenChange={setOpen}
        initialArticleId={initialArticleId}
      />
    </>
  );
}
