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
    <div className={`inline-flex items-center gap-1.5 rounded-lg border border-input bg-background p-1 ${className}`}>
      <Clock className="w-3.5 h-3.5 text-muted-foreground ml-1.5 flex-shrink-0" aria-hidden="true" />

      {/* Hour */}
      <Select
        value={String(hour12)}
        onValueChange={(v) => emit(parseInt(v, 10), minute, period)}
        disabled={disabled}
      >
        <SelectTrigger
          className="h-8 w-[58px] px-2 border-0 bg-transparent hover:bg-muted/50 font-mono font-semibold text-sm focus:ring-1 focus:ring-ring [&>svg]:hidden justify-center"
          aria-label="Hour"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sticky top-0 bg-popover">
            Hour
          </div>
          {hours.map((h) => (
            <SelectItem key={h} value={String(h)} className="font-mono justify-center">
              {pad(h)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="text-muted-foreground font-semibold select-none">:</span>

      {/* Minute */}
      <Select
        value={String(minute - (minute % minuteStep))}
        onValueChange={(v) => emit(hour12, parseInt(v, 10), period)}
        disabled={disabled}
      >
        <SelectTrigger
          className="h-8 w-[58px] px-2 border-0 bg-transparent hover:bg-muted/50 font-mono font-semibold text-sm focus:ring-1 focus:ring-ring [&>svg]:hidden justify-center"
          aria-label="Minute"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sticky top-0 bg-popover">
            Min
          </div>
          {minutes.map((m) => (
            <SelectItem key={m} value={String(m)} className="font-mono justify-center">
              {pad(m)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* AM/PM toggle */}
      <div className="flex items-center rounded-md bg-muted/60 p-0.5 ml-1">
        {(['AM', 'PM'] as const).map((p) => (
          <button
            key={p}
            type="button"
            disabled={disabled}
            onClick={() => emit(hour12, minute, p)}
            className={`px-2 py-0.5 text-[11px] font-bold rounded transition-colors ${
              period === p
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            } disabled:opacity-50 disabled:pointer-events-none`}
            aria-pressed={period === p}
            aria-label={p === 'AM' ? 'Morning (AM)' : 'Afternoon/Evening (PM)'}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
