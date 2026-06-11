import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { AppSidebar } from './AppSidebar';
import { MobileHeader } from './MobileHeader';
import { MobileSidebar } from './MobileSidebar';
import { OceanWaves } from '@/components/theme/OceanWaves';

import { HelpPanelHost } from '@/components/help/HelpPanelHost';


import { GuidedTour } from '@/components/help/GuidedTour';
import { TrainingModeOverlay } from '@/components/help/TrainingMode';
import { SetupWizard } from '@/components/onboarding/SetupWizard';
import { WelcomeGuide } from '@/components/onboarding/WelcomeGuide';
import { ttsService } from '@/lib/ttsService';
import { getStoredVoice } from '@/hooks/useKokoroTTS';
import { useReportClientStatus } from '@/hooks/useReportClientStatus';
import { RESTART_SETUP_WIZARD_EVENT } from '@/components/help/events';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function AppLayout() {
  const { user, loading, profile } = useAuth();
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

  // Preload the in-browser Kokoro TTS model in the background once the user
  // is signed in, so read-aloud is ready when they open a chat. Skip on
  // data-saver connections; the worker will lazy-load on first click instead.
  useEffect(() => {
    if (!user?.id) return;
    const saveData = (navigator as any).connection?.saveData === true;
    if (saveData) return;
    const idle = (window as any).requestIdleCallback as undefined | ((cb: () => void) => number);
    const run = () => ttsService.preload(getStoredVoice());
    if (idle) idle(run); else setTimeout(run, 400);
  }, [user?.id]);

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
    <div className="h-screen overflow-hidden flex flex-col lg:flex-row">
      {/* Mobile Header */}
      <MobileHeader onMenuClick={() => setMobileMenuOpen(true)} />

      {/* Mobile Sidebar (Sheet) */}
      <MobileSidebar open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />

      {/* Desktop Sidebar — auto-hide on Chat page when unpinned */}
      {autoHide ? (
        <>
          {/* Click-to-open edge trigger (visible tab) — bottom-left, accent-colored */}
          {!sidebarHover && (
            <button
              type="button"
              aria-label="Open sidebar menu"
              onClick={() => setSidebarHover(true)}
              className="hidden lg:flex fixed left-0 bottom-6 z-50 items-center gap-2 h-11 pl-3 pr-4 rounded-r-xl border border-l-0 shadow-xl backdrop-blur transition hover:brightness-110"
              style={{
                background: 'linear-gradient(135deg, var(--c-purple), color-mix(in srgb, var(--c-purple) 80%, black))',
                color: '#FFFFFF',
                borderColor: 'color-mix(in srgb, var(--c-purple) 60%, transparent)',
              }}
            >
              <ChevronRight className="h-4 w-4 shrink-0" />
              <span className="text-[11px] font-semibold tracking-[0.14em] uppercase whitespace-nowrap">
                Show Menu
              </span>
            </button>
          )}
          <div
            className={cn(
              'hidden lg:block fixed left-0 top-0 h-screen z-40 transition-transform duration-200 ease-out',
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
