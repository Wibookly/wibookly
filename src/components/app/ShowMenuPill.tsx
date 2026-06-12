import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';

interface ShowMenuPillProps {
  onOpen: () => void;
  storageKey: string;
  className?: string;
}

/**
 * Floating "Show Menu" pill anchored to the left edge. Vertically draggable —
 * users can move it up or down so it stops covering chat text. Position is
 * persisted per device (storageKey distinguishes mobile vs desktop).
 */
export function ShowMenuPill({ onOpen, storageKey, className = '' }: ShowMenuPillProps) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ startY: number; startTop: number; moved: boolean } | null>(null);
  const [top, setTop] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(storageKey);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  });

  // Default position: ~bottom-6 — computed on mount so it adapts to viewport.
  useEffect(() => {
    if (top !== null) return;
    setTop(Math.max(80, window.innerHeight - 80));
  }, [top]);

  const clamp = (y: number) => {
    const h = window.innerHeight;
    return Math.min(Math.max(56, y), h - 56);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const el = btnRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    dragRef.current = {
      startY: e.clientY,
      startTop: top ?? e.clientY,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dy) > 4) dragRef.current.moved = true;
    if (dragRef.current.moved) {
      e.preventDefault();
      setTop(clamp(dragRef.current.startTop + dy));
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const el = btnRef.current;
    if (el && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    const wasDrag = dragRef.current?.moved === true;
    dragRef.current = null;
    if (wasDrag) {
      if (top !== null) {
        try { localStorage.setItem(storageKey, String(top)); } catch { /* ignore */ }
      }
    } else {
      onOpen();
    }
  };

  return (
    <button
      ref={btnRef}
      type="button"
      aria-label="Open sidebar menu (drag to move)"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { dragRef.current = null; }}
      className={`fixed left-0 z-50 flex items-center gap-1.5 h-8 pl-2 pr-2.5 rounded-r-lg border border-l-0 shadow-lg backdrop-blur transition hover:brightness-110 touch-none select-none cursor-grab active:cursor-grabbing ${className}`}
      style={{
        top: top ?? undefined,
        background: 'linear-gradient(135deg, var(--c-purple), color-mix(in srgb, var(--c-purple) 80%, black))',
        color: '#FFFFFF',
        borderColor: 'color-mix(in srgb, var(--c-purple) 60%, transparent)',
      }}
    >
      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
      <span className="text-[10px] font-semibold tracking-[0.12em] uppercase whitespace-nowrap">
        Menu
      </span>
    </button>
  );
}
