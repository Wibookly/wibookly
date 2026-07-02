import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useHomePreferences } from '@/hooks/useHomePreferences';
import { CORE_WIDGET_IDS } from '@/config/homeWidgetRegistry';

export function CustomizeHomeDialog() {
  const { data, toggle } = useHomePreferences();
  const defs = data?.defs || [];
  const prefs = data?.prefs || [];

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">Customize home</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Customize home</DialogTitle>
        </DialogHeader>
        <div className="divide-y divide-border">
          {defs.map((d) => {
            const pref = prefs.find(p => p.widget_id === d.id);
            const enabled = pref?.enabled ?? d.defaultEnabled;
            const isCategory = !CORE_WIDGET_IDS.has(d.id);
            return (
              <div key={d.id} className="flex items-center gap-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-foreground flex items-center gap-2">
                    {d.title}
                    {isCategory && <Badge variant="outline" className="text-[10px]">pinned</Badge>}
                  </div>
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={(v) => toggle({ widget_id: d.id, enabled: v })}
                />
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
