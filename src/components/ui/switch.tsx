import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

/**
 * Tri-state visible Switch.
 *  - ON  (checked, enabled)            -> green
 *  - OFF (unchecked, enabled)          -> red
 *  - DISABLED (locked / no permission) -> neutral gray, always visible in
 *    both light and dark mode, with a strong border so the shape is obvious.
 *
 * The Switch ALWAYS has a visible 2px border so users can find the control
 * even when its background is faint.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      // Base shape — always visible border
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      // ENABLED states (green on / red off)
      "data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-600",
      "data-[state=unchecked]:bg-rose-500/85 data-[state=unchecked]:border-rose-600",
      // DISABLED state — neutral gray, still clearly visible in light & dark
      "data-[disabled]:cursor-not-allowed",
      "data-[disabled]:bg-slate-300 data-[disabled]:border-slate-400",
      "dark:data-[disabled]:bg-slate-600 dark:data-[disabled]:border-slate-400",
      "data-[disabled]:opacity-100",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-md ring-0 transition-transform",
        "data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
