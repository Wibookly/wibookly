import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useActiveEmail } from "@/contexts/ActiveEmailContext";
import { UserAvatarDropdown } from "@/components/app/UserAvatarDropdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Calendar, Clock, Save, Mail } from "lucide-react";

interface AvailabilityHour {
  id?: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
}

const DAYS_OF_WEEK = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

const DEFAULT_AVAILABILITY: AvailabilityHour[] = DAYS_OF_WEEK.map((day) => ({
  day_of_week: day.value,
  start_time: "09:00",
  end_time: "17:00",
  is_available: day.value >= 1 && day.value <= 5, // Mon-Fri
}));

export default function AICalendar() {
  const { user, loading: authLoading } = useAuth();
  const { activeConnection, loading: emailLoading } = useActiveEmail();

  const [availability, setAvailability] = useState<AvailabilityHour[]>(DEFAULT_AVAILABILITY);
  const [calendarEventColor, setCalendarEventColor] = useState("#9333EA");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user && activeConnection?.id) {
      fetchData();
    } else if (!emailLoading && !authLoading) {
      setLoading(false);
    }
  }, [user, activeConnection?.id, emailLoading, authLoading]);

  const fetchData = async () => {
    if (!activeConnection?.id) return;

    try {
      const { data: profile } = await supabase.rpc("get_my_profile");
      if (!profile || profile.length === 0) {
        setLoading(false);
        return;
      }

      setOrganizationId(profile[0].organization_id);

      // Fetch availability hours
      const { data: hours } = await supabase
        .from("availability_hours")
        .select("*")
        .eq("organization_id", profile[0].organization_id)
        .eq("connection_id", activeConnection.id)
        .order("day_of_week");

      if (hours && hours.length > 0) {
        setAvailability(
          DAYS_OF_WEEK.map((day) => {
            const existing = hours.find((h) => h.day_of_week === day.value);
            return existing
              ? {
                  id: existing.id,
                  day_of_week: existing.day_of_week,
                  start_time: existing.start_time,
                  end_time: existing.end_time,
                  is_available: existing.is_available,
                }
              : DEFAULT_AVAILABILITY[day.value];
          })
        );
      }

      // Fetch AI calendar event color
      const { data: aiSettings } = await supabase
        .from("ai_settings")
        .select("ai_calendar_event_color")
        .eq("organization_id", profile[0].organization_id)
        .eq("connection_id", activeConnection.id)
        .maybeSingle();

      if (aiSettings?.ai_calendar_event_color) {
        setCalendarEventColor(aiSettings.ai_calendar_event_color);
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const updateAvailability = (dayOfWeek: number, field: keyof AvailabilityHour, value: any) => {
    setAvailability((prev) =>
      prev.map((a) => (a.day_of_week === dayOfWeek ? { ...a, [field]: value } : a))
    );
  };

  const handleSave = async () => {
    if (!activeConnection?.id || !organizationId || !user?.id) return;

    setSaving(true);

    try {
      // Save availability hours
      for (const hour of availability) {
        const payload = {
          user_id: user.id,
          organization_id: organizationId,
          connection_id: activeConnection.id,
          day_of_week: hour.day_of_week,
          start_time: hour.start_time,
          end_time: hour.end_time,
          is_available: hour.is_available,
        };

        if (hour.id) {
          await supabase
            .from("availability_hours")
            .update(payload)
            .eq("id", hour.id);
        } else {
          const { data } = await supabase
            .from("availability_hours")
            .insert(payload)
            .select()
            .single();

          if (data) {
            setAvailability((prev) =>
              prev.map((a) =>
                a.day_of_week === hour.day_of_week ? { ...a, id: data.id } : a
              )
            );
          }
        }
      }

      // Save calendar event color
      const { data: existing } = await supabase
        .from("ai_settings")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("connection_id", activeConnection.id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("ai_settings")
          .update({ ai_calendar_event_color: calendarEventColor } as Record<string, unknown>)
          .eq("id", existing.id);
      } else {
        await supabase.from("ai_settings").insert([
          {
            organization_id: organizationId,
            connection_id: activeConnection.id,
            writing_style: "professional",
            ai_calendar_event_color: calendarEventColor,
          },
        ]);
      }

      toast.success("Calendar settings saved!");
    } catch (error) {
      console.error("Error saving:", error);
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || emailLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!activeConnection) {
    return (
      <div className="min-h-full p-4 lg:p-6">
        <div className="max-w-4xl mb-4 flex justify-end">
          <UserAvatarDropdown />
        </div>
        <div className="max-w-4xl animate-fade-in bg-card/80 backdrop-blur-sm rounded-xl border border-border shadow-lg p-6">
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Mail className="w-12 h-12 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">No Email Connected</h2>
            <p className="text-muted-foreground mb-6">
              Connect a Gmail or Outlook account to configure AI calendar settings
            </p>
            <Button onClick={() => (window.location.href = "/integrations")}>
              Connect Email Account
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full p-4 lg:p-6">
      <div className="max-w-4xl mb-4 flex justify-end">
        <UserAvatarDropdown />
      </div>

      <div className="max-w-4xl space-y-6">
        {/* Page header */}
        <div className="relative overflow-hidden rounded-xl bg-card/80 backdrop-blur-sm border border-border shadow-lg p-6">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent" />
          <div className="relative">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              AI Calendar Settings
            </h1>
            <p className="text-muted-foreground mt-1">
              Configure availability hours and AI calendar event appearance
            </p>
          </div>
        </div>

        {/* Availability Hours */}
        <Card className="border-primary/20 shadow-sm">
          <CardHeader className="bg-gradient-to-r from-primary/5 to-transparent rounded-t-lg">
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <Clock className="h-5 w-5 text-primary" />
              </div>
              Availability Hours
            </CardTitle>
            <CardDescription>
              Set the hours when AI can schedule meetings on your behalf
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {DAYS_OF_WEEK.map((day) => {
              const avail = availability.find((a) => a.day_of_week === day.value);
              if (!avail) return null;

              return (
                <div
                  key={day.value}
                  className="flex items-center gap-4 py-2 border-b border-border last:border-0"
                >
                  <div className="w-28 flex items-center gap-2">
                    <Switch
                      checked={avail.is_available}
                      onCheckedChange={(checked) =>
                        updateAvailability(day.value, "is_available", checked)
                      }
                    />
                    <span
                      className={`text-sm font-medium ${
                        avail.is_available ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {day.label}
                    </span>
                  </div>

                  {avail.is_available && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="time"
                        value={avail.start_time}
                        onChange={(e) =>
                          updateAvailability(day.value, "start_time", e.target.value)
                        }
                        className="w-32"
                      />
                      <span className="text-muted-foreground">to</span>
                      <Input
                        type="time"
                        value={avail.end_time}
                        onChange={(e) =>
                          updateAvailability(day.value, "end_time", e.target.value)
                        }
                        className="w-32"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* AI Calendar Event Color */}
        <Card className="border-accent/20 shadow-sm">
          <CardHeader className="bg-gradient-to-r from-accent/5 to-transparent rounded-t-lg">
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-accent/10">
                <Calendar className="h-5 w-5 text-accent" />
              </div>
              AI Calendar Event Color
            </CardTitle>
            <CardDescription>
              Choose the color for calendar events created by AI
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="flex-1 space-y-1">
                <Label htmlFor="calendarColor">Event Color</Label>
                <p className="text-xs text-muted-foreground">
                  Applied to calendar events AI creates from meeting requests
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg border-2 border-border shadow-sm cursor-pointer relative overflow-hidden"
                  style={{ backgroundColor: calendarEventColor }}
                >
                  <input
                    type="color"
                    id="calendarColor"
                    value={calendarEventColor}
                    onChange={(e) => setCalendarEventColor(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                </div>
                <span className="text-sm font-mono text-muted-foreground">
                  {calendarEventColor}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <Button onClick={handleSave} disabled={saving} className="w-full">
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Save Calendar Settings
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
