import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface VoiceWaveformProps {
  getAnalyser: () => AnalyserNode | null;
  active: boolean;
  className?: string;
  /** Number of bars to render. */
  bars?: number;
}

/**
 * Live audio waveform visualization (ChatGPT-style dictation).
 * Reads frequency data from the supplied AnalyserNode and renders
 * smoothed bars that respond to the user's voice in real time.
 */
export function VoiceWaveform({ getAnalyser, active, className, bars = 48 }: VoiceWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  // Persist a smoothed level per bar across frames for a fluid effect.
  const levelsRef = useRef<number[]>(new Array(bars).fill(0));

  useEffect(() => {
    if (!active) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      // Reset bars
      levelsRef.current = new Array(bars).fill(0);
      const c = canvasRef.current;
      if (c) c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
      return;
    }

    const draw = () => {
      const canvas = canvasRef.current;
      const analyser = getAnalyser();
      if (!canvas) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
        canvas.width = cssW * dpr;
        canvas.height = cssH * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const levels = levelsRef.current;

      // Pull fresh frequency data if we have an analyser.
      if (analyser) {
        const freq = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(freq);
        // Bucket into `bars`, weighting lower frequencies (voice range).
        const usable = Math.floor(freq.length * 0.55);
        const bucket = Math.max(1, Math.floor(usable / bars));
        for (let i = 0; i < bars; i++) {
          let sum = 0;
          const start = i * bucket;
          for (let j = 0; j < bucket; j++) sum += freq[start + j] || 0;
          const target = Math.min(1, (sum / bucket) / 180);
          // Smooth toward target
          levels[i] = levels[i] * 0.55 + target * 0.45;
        }
      } else {
        // No analyser yet — gentle idle pulse so the user sees life.
        const t = performance.now() / 220;
        for (let i = 0; i < bars; i++) {
          const target = 0.06 + Math.abs(Math.sin(t + i * 0.4)) * 0.05;
          levels[i] = levels[i] * 0.7 + target * 0.3;
        }
      }

      // Render bars centered vertically.
      const gap = 2;
      const barW = Math.max(2, (cssW - gap * (bars - 1)) / bars);
      const midY = cssH / 2;
      const color = getComputedStyle(canvas).color || 'hsl(var(--primary))';
      ctx.fillStyle = color;
      for (let i = 0; i < bars; i++) {
        const lvl = Math.max(0.04, levels[i]);
        const h = Math.max(2, lvl * cssH * 0.95);
        const x = i * (barW + gap);
        const y = midY - h / 2;
        const r = Math.min(barW / 2, 3);
        // Rounded rect
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + barW - r, y);
        ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
        ctx.lineTo(x + barW, y + h - r);
        ctx.quadraticCurveTo(x + barW, y + h, x + barW - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [active, getAnalyser, bars]);

  return (
    <canvas
      ref={canvasRef}
      className={cn('h-8 w-full text-primary', className)}
      aria-hidden="true"
    />
  );
}
