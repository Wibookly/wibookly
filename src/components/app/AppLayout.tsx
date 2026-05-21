import { useEffect, useState } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { AppSidebar } from './AppSidebar';
import { MobileHeader } from './MobileHeader';
import { MobileSidebar } from './MobileSidebar';
import { OceanWaves } from '@/components/theme/OceanWaves';
import { ModeToggle } from '@/components/theme/ModeToggle';

import { HelpPanelHost } from '@/components/help/HelpPanelHost';
import { PageGuide } from '@/components/help/PageGuide';
import { GuidedTour } from '@/components/help/GuidedTour';
import { TrainingModeOverlay } from '@/components/help/TrainingMode';
import { SetupWizard } from '@/components/onboarding/SetupWizard';
import { RESTART_SETUP_WIZARD_EVENT } from '@/components/help/events';
import { Loader2 } from 'lucide-react';

export function AppLayout() {
  const { user, loading, profile } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardChecked, setWizardChecked] = useState(false);
  const location = useLocation();

  // Auto-open the Setup Wizard once per user, when they first land in the app
  // and have not yet completed it. We hit the table directly because the
  // get_my_profile RPC does not return the new onboarding column yet.
  useEffect(() => {
    if (!user?.id || wizardChecked) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('user_profiles')
        .select('onboarding_completed_at')
        .eq('user_id', user.id)
        .maybeSingle();
      if (cancelled) return;
      const row = data as { onboarding_completed_at?: string | null } | null;
      // Only auto-launch on the main authenticated landing pages — never
      // on the OAuth callback or invitation pages.
      const safeRoute =
        location.pathname === '/integrations' ||
        location.pathname === '/categories' ||
        location.pathname === '/settings';
      if (row && !row.onboarding_completed_at && safeRoute) {
        setWizardOpen(true);
      }
      setWizardChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, wizardChecked, location.pathname]);

  // Allow the Help panel (and Settings) to relaunch the wizard on demand
  useEffect(() => {
    const handler = () => setWizardOpen(true);
    window.addEventListener(RESTART_SETUP_WIZARD_EVENT, handler);
    return () => window.removeEventListener(RESTART_SETUP_WIZARD_EVENT, handler);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Mobile Header */}
      <MobileHeader onMenuClick={() => setMobileMenuOpen(true)} />

      {/* Mobile Sidebar (Sheet) */}
      <MobileSidebar open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />

      {/* Desktop Sidebar */}
      <AppSidebar />

      <div className="flex-1 flex flex-col min-h-0 relative">
        <OceanWaves />
        <main className="flex-1 overflow-auto relative z-10">
          <Outlet />
        </main>
      </div>

      {/* Global help affordances */}
      <HelpPanelHost />
      <PageGuide />
      <GuidedTour />
      <TrainingModeOverlay />
      <SetupWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onComplete={() => {
          /* Profile.onboarding_completed_at is updated inside the wizard. */
        }}
      />
      {/* Suppress unused-var warning for `profile` (kept for future personalization). */}
      <span className="hidden">{profile?.id ?? ''}</span>
    </div>
  );
}
