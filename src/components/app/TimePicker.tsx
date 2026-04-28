import { useMemo } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Clock } from 'lucide-react';

interface TimePickerProps {
  /** 24-hour HH:mm string, e.g. "08:00" or "17:30" */
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** Minute step (default 5) */
  minuteStep?: number;
  className?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Friendly 12-hour time picker with three clearly labeled dropdowns:
 *   [ Hour ▾ ] : [ Min ▾ ]   [ AM / PM ]
 *
 * Each dropdown shows a long scrollable list so users can flick up/down
 * (or scroll) to find the value they want — much more discoverable than the
 * default native `<input type="time">` spinner.
 */
export function TimePicker({
  value,
  onChange,
  disabled = false,
  minuteStep = 5,
  className = '',
}: TimePickerProps) {
  const [hh = '08', mm = '00'] = (value || '08:00').split(':');
  const hour24 = Math.min(23, Math.max(0, parseInt(hh, 10) || 0));
  const minute = Math.min(59, Math.max(0, parseInt(mm, 10) || 0));

  const period: 'AM' | 'PM' = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;

  const hours = useMemo(
    () => Array.from({ length: 12 }, (_, i) => i + 1), // 1..12
    [],
  );
  const minutes = useMemo(() => {
    const out: number[] = [];
    for (let m = 0; m < 60; m += minuteStep) out.push(m);
    return out;
  }, [minuteStep]);

  const emit = (h12: number, min: number, p: 'AM' | 'PM') => {
    let h = h12 % 12;
    if (p === 'PM') h += 12;
    onChange(`${pad(h)}:${pad(min)}`);
  };

  return (
    <div className={`inline-flex items-end gap-2 ${className}`}>
      {/* Hour */}
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Hour</span>
        <Select
          value={String(hour12)}
          onValueChange={(v) => emit(parseInt(v, 10), minute, period)}
          disabled={disabled}
        >
          <SelectTrigger
            className="h-9 w-[68px] px-2 font-mono font-semibold text-sm bg-background border-input hover:border-primary/50 hover:bg-muted/40 transition-colors"
            aria-label="Hour"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72 min-w-[68px]">
            {hours.map((h) => (
              <SelectItem key={h} value={String(h)} className="font-mono justify-center">
                {pad(h)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <span className="text-muted-foreground font-semibold select-none pb-2">:</span>

      {/* Minute */}
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Min</span>
        <Select
          value={String(minute - (minute % minuteStep))}
          onValueChange={(v) => emit(hour12, parseInt(v, 10), period)}
          disabled={disabled}
        >
          <SelectTrigger
            className="h-9 w-[68px] px-2 font-mono font-semibold text-sm bg-background border-input hover:border-primary/50 hover:bg-muted/40 transition-colors"
            aria-label="Minute"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72 min-w-[68px]">
            {minutes.map((m) => (
              <SelectItem key={m} value={String(m)} className="font-mono justify-center">
                {pad(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* AM/PM toggle — AM = amber/sun, PM = indigo/moon for instant visual cue */}
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">AM/PM</span>
        <div className="flex items-center rounded-md border border-input bg-background h-9 p-0.5">
          {(['AM', 'PM'] as const).map((p) => {
            const active = period === p;
            const activeStyles = p === 'AM'
              ? 'bg-amber-500 text-white shadow-sm'
              : 'bg-indigo-600 text-white shadow-sm';
            return (
              <button
                key={p}
                type="button"
                disabled={disabled}
                onClick={() => emit(hour12, minute, p)}
                className={`px-2.5 h-full text-[11px] font-bold rounded transition-colors ${
                  active ? activeStyles : 'text-muted-foreground hover:text-foreground'
                } disabled:opacity-50 disabled:pointer-events-none`}
                aria-pressed={active}
                aria-label={p === 'AM' ? 'Morning (AM)' : 'Afternoon/Evening (PM)'}
              >
                {p}
              </button>
            );
          })}
        </div>
      </div>

      <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0 pb-2.5" aria-hidden="true" />
    </div>
  );
}
