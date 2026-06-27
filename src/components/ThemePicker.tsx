import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Check } from "lucide-react";
import { PALETTES, useTheme } from "@/lib/theme";

export function ThemePicker() {
  const { palette, setPalette } = useTheme();
  const grad = (s: [string, string]) => `linear-gradient(135deg, ${s[0]}, ${s[1]})`;
  const active = PALETTES.find((p) => p.id === palette) ?? PALETTES[0];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label="Color theme"
          className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1 hover:border-foreground/30 transition"
        >
          <span
            className="h-4 w-4 rounded-full ring-1 ring-black/10"
            style={{ background: grad(active.swatch) }}
          />
          <span className="text-[9px] text-muted-foreground">▾</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[186px] p-1.5 rounded-2xl shadow-lg">
        {PALETTES.map((p) => (
          <button
            key={p.id}
            onClick={() => setPalette(p.id)}
            className="flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-[13px] text-foreground hover:bg-muted transition"
          >
            <span
              className="h-5 w-5 rounded-md ring-1 ring-black/10"
              style={{ background: grad(p.swatch) }}
            />
            {p.name}
            {palette === p.id && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export default ThemePicker;
