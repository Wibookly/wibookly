import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import { ActiveEmailProvider } from "@/contexts/ActiveEmailContext";
import { FeatureRoute } from "@/components/app/FeatureRoute";
import { TourProvider } from "@/components/onboarding/TourProvider";

import Auth from "./pages/Auth";
import { AppLayout } from "./components/app/AppLayout";
import Integrations from "./pages/Integrations";
import IntegrationSetup from "./pages/IntegrationSetup";
import Categories from "./pages/Categories";
import Sync from "./pages/Sync";
import Settings from "./pages/Settings";
import EmailDraft from "./pages/EmailDraft";
import AIActivityDashboard from "./pages/AIActivityDashboard";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";
import AIDailyBrief from "./pages/AIDailyBrief";
import AdminDashboard from "./pages/AdminDashboard";
import MeetingCopilot from "./pages/MeetingCopilot";
import MeetingSessionDetail from "./pages/MeetingSessionDetail";
import MeetingSessions from "./pages/MeetingSessions";
import MeetingPrep from "./pages/MeetingPrep";
import MeetingLive from "./pages/MeetingLive";
import ExtensionAuth from "./pages/ExtensionAuth";

import FollowUpReminder from "./pages/FollowUpReminder";
import FlaggedEmailTracker from "./pages/FlaggedEmailTracker";
import FlaggedEmailSettings from "./pages/FlaggedEmailSettings";
import AcceptInvitation from "./pages/AcceptInvitation";
import MicrosoftConsentComplete from "./pages/MicrosoftConsentComplete";
import Chat from "./pages/Chat";
import ChatUpgrade from "./pages/ChatUpgrade";
import HelpAdmin from "./pages/HelpAdmin";
import SuperAdmin from "./pages/SuperAdmin";
import OrgAdmin from "./pages/OrgAdmin";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <ThemeProvider>
      <AuthProvider>
        <ActiveEmailProvider>
          
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <TourProvider>
              <Routes>
                {/* Auth is the entry point */}
                <Route path="/" element={<Navigate to="/auth" replace />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/auth/accept-invitation" element={<AcceptInvitation />} />
                <Route path="/microsoft-consent-complete" element={<MicrosoftConsentComplete />} />
                {/* Backwards-compatible redirects */}
                <Route path="/dashboard" element={<Navigate to="/integrations" replace />} />
                <Route path="/pricing" element={<Navigate to="/auth" replace />} />
                {/* Protected app routes */}
                <Route element={<AppLayout />}>
                  <Route path="/chat" element={<Chat />} />
                  <Route path="/chat/upgrade" element={<ChatUpgrade />} />
                  <Route path="/chat/:id" element={<Chat />} />
                  <Route path="/integrations" element={<Integrations />} />
                  <Route path="/integration-setup" element={<IntegrationSetup />} />
                  <Route path="/categories" element={
                    <FeatureRoute featureKeys={['email_intelligence']}>
                      <Categories />
                    </FeatureRoute>
                  } />
                  <Route path="/sync" element={<Sync />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/settings/help" element={<HelpAdmin />} />
                  <Route path="/email-draft" element={
                    <FeatureRoute featureKeys={['ai_draft', 'ai_auto_reply']}>
                      <EmailDraft />
                    </FeatureRoute>
                  } />
                  <Route path="/ai-activity" element={
                    <FeatureRoute featureKeys={['reports']}>
                      <AIActivityDashboard />
                    </FeatureRoute>
                  } />
                  <Route path="/ai-daily-brief" element={
                    <FeatureRoute featureKeys={['daily_brief', 'ai_assistant']}>
                      <AIDailyBrief />
                    </FeatureRoute>
                  } />
                  <Route path="/follow-up-reminder" element={
                    <FeatureRoute featureKeys={['feature.follow_up_reminder']}>
                      <FollowUpReminder />
                    </FeatureRoute>
                  } />
                  <Route path="/flagged-email-tracker" element={
                    <FeatureRoute featureKeys={['feature.follow_up_reminder']}>
                      <FlaggedEmailTracker />
                    </FeatureRoute>
                  } />
                  <Route path="/flagged-email-settings" element={
                    <FeatureRoute featureKeys={['feature.follow_up_reminder']}>
                      <FlaggedEmailSettings />
                    </FeatureRoute>
                  } />
                  <Route path="/meeting-copilot" element={
                    <FeatureRoute featureKeys={['meeting_copilot']}>
                      <MeetingCopilot />
                    </FeatureRoute>
                  } />
                  <Route path="/meeting-copilot/prep/:id" element={
                    <FeatureRoute featureKeys={['meeting_copilot']}>
                      <MeetingPrep />
                    </FeatureRoute>
                  } />
                  <Route path="/meeting-copilot/live/:id" element={
                    <FeatureRoute featureKeys={['meeting_copilot']}>
                      <MeetingLive />
                    </FeatureRoute>
                  } />
                  <Route path="/meeting-copilot/sessions" element={
                    <FeatureRoute featureKeys={['meeting_copilot']}>
                      <MeetingSessions />
                    </FeatureRoute>
                  } />
                  <Route path="/meeting-copilot/sessions/:id" element={
                    <FeatureRoute featureKeys={['meeting_copilot']}>
                      <MeetingSessionDetail />
                    </FeatureRoute>
                  } />
                  <Route path="/extension-auth" element={<ExtensionAuth />} />
                  <Route path="/admin" element={<AdminDashboard />} />
                  <Route path="/admin/control-panel" element={<Navigate to="/admin" replace />} />
                  <Route path="/super-admin" element={<SuperAdmin />} />
                  <Route path="/org-admin" element={<OrgAdmin />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
              </TourProvider>
            </BrowserRouter>
          
        </ActiveEmailProvider>
      </AuthProvider>
      </ThemeProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
