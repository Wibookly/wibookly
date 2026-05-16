interface ToggleProps {
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
}

export function Toggle({ checked, onChange, disabled, ...rest }: ToggleProps) {
  const bg = disabled
    ? 'var(--surface-3, #cbd5e1)'
    : checked
      ? '#10b981' /* emerald-500 */
      : 'rgba(244,63,94,0.85)'; /* rose-500 */
  const border = disabled
    ? '#94a3b8'
    : checked
      ? '#059669'
      : '#e11d48';

  return (
    <button
      type="button"
      onClick={() => !disabled && onChange?.(!checked)}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className="relative inline-flex h-6 w-11 items-center rounded-full border-2 transition-colors disabled:cursor-not-allowed"
      style={{ background: bg, borderColor: border }}
      {...rest}
    >
      <span
        className="inline-block h-5 w-5 rounded-full bg-white shadow-md transition-transform"
        style={{ transform: checked ? 'translateX(20px)' : 'translateX(0px)' }}
      />
    </button>
  );
}
