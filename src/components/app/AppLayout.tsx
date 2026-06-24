import { useEffect, useState } from 'react';
import { ShowMenuPill } from './ShowMenuPill';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { AppSidebar } from './AppSidebar';
import { MobileHeader } from './MobileHeader';
import { AppHeader } from './AppHeader';
import { MobileSidebar } from './MobileSidebar';
import { OceanWaves } from '@/components/theme/OceanWaves';

import { HelpPanelHost } from '@/components/help/HelpPanelHost';


import { GuidedTour } from '@/components/help/GuidedTour';
import { TrainingModeOverlay } from '@/components/help/TrainingMode';
import { SetupWizard } from '@/components/onboarding/SetupWizard';
import { WelcomeGuide } from '@/components/onboarding/WelcomeGuide';
import { useReportClientStatus } from '@/hooks/useReportClientStatus';
import { RESTART_SETUP_WIZARD_EVENT } from '@/components/help/events';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function AppLayout() {
  const { user, loading, profile } = useAuth();
  useReportClientStatus();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardChecked, setWizardChecked] = useState(false);
  const location = useLocation();
  const isChatPage = location.pathname === '/chat' || location.pathname.startsWith('/chat/');
  const [sidebarPinned, setSidebarPinned] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('chat-sidebar-pinned') !== 'false';
  });
  const [sidebarHover, setSidebarHover] = useState(false);

  // Auto-open of the Setup Wizard is disabled by user preference. The wizard
  // never opens on page load or refresh — users open it manually from the
  // Help panel, Settings, or the "Setup Guide" button.
  useEffect(() => {
    if (!user?.id || wizardChecked) return;
    setWizardChecked(true);
  }, [user?.id, wizardChecked]);


  // Allow the Help panel (and Settings) to relaunch the wizard on demand
  useEffect(() => {
    const handler = () => setWizardOpen(true);
    window.addEventListener(RESTART_SETUP_WIZARD_EVENT, handler);
    return () => window.removeEventListener(RESTART_SETUP_WIZARD_EVENT, handler);
  }, []);

  // TTS is now served from a hosted Kokoro server — no model to preload.

  useEffect(() => {
    localStorage.setItem('chat-sidebar-pinned', String(sidebarPinned));
  }, [sidebarPinned]);

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

  const autoHide = isChatPage && !sidebarPinned;
  const sidebarOpen = !autoHide || sidebarHover;
  const togglePin = isChatPage ? () => setSidebarPinned((v) => !v) : undefined;

  return (
    <div className="h-[100dvh] overflow-hidden flex flex-col lg:flex-row">
      {/* Mobile Header */}
      <MobileHeader onMenuClick={() => setMobileMenuOpen(true)} />

      {/* Mobile "Show Menu" pill — draggable vertically so it never covers chat text */}
      {isChatPage && (
        <div className="lg:hidden">
          <ShowMenuPill onOpen={() => setMobileMenuOpen(true)} storageKey="chat-menu-pill-y-mobile" />
        </div>
      )}


      {/* Mobile Sidebar (Sheet) */}
      <MobileSidebar open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />

      {/* Desktop Sidebar — auto-hide on Chat page when unpinned */}
      {autoHide ? (
        <>
          {/* Click-to-open edge trigger (visible tab) — bottom-left, accent-colored */}
          {!sidebarHover && (
            <div className="hidden lg:block">
              <ShowMenuPill onOpen={() => setSidebarHover(true)} storageKey="chat-menu-pill-y-desktop" />
            </div>
          )}
          <div
            className={cn(
              'hidden lg:block fixed left-0 top-0 h-[100dvh] z-40 transition-transform duration-200 ease-out',
              sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
            )}
          >
            <AppSidebar
              pinned={sidebarPinned}
              onTogglePin={togglePin}
            />
          </div>
          {sidebarHover && !sidebarPinned && (
            <div
              className="hidden lg:block fixed inset-0 z-30"
              onClick={() => setSidebarHover(false)}
            />
          )}
        </>
      ) : (
        <AppSidebar pinned={sidebarPinned} onTogglePin={togglePin} />
      )}

      <div className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
        <OceanWaves />
        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden relative z-10">
          <div className="h-full min-h-full flex flex-col">
            <Outlet />
          </div>
        </main>
      </div>


      {/* Global help affordances */}
      <HelpPanelHost />
      
      <GuidedTour />
      <TrainingModeOverlay />
      <WelcomeGuide />
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
