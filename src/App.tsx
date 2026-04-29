import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { ActiveEmailProvider } from "@/contexts/ActiveEmailContext";
import { FeatureRoute } from "@/components/app/FeatureRoute";

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
import AIChat from "./pages/AIChat";
import AIDailyBrief from "./pages/AIDailyBrief";
import AdminDashboard from "./pages/AdminDashboard";
import FollowUpReminder from "./pages/FollowUpReminder";
import AcceptInvitation from "./pages/AcceptInvitation";
import MicrosoftConsentComplete from "./pages/MicrosoftConsentComplete";
import Knowledge from "./pages/Knowledge";
import KnowledgeChat from "./pages/KnowledgeChat";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <ActiveEmailProvider>
          
            <Toaster />
            <Sonner />
            <BrowserRouter>
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
                  <Route path="/integrations" element={<Integrations />} />
                  <Route path="/integration-setup" element={<IntegrationSetup />} />
                  <Route path="/categories" element={<Categories />} />
                  <Route path="/sync" element={<Sync />} />
                  <Route path="/settings" element={<Settings />} />
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
                  <Route path="/ai-chat" element={
                    <FeatureRoute featureKeys={['ai_assistant']}>
                      <AIChat />
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
                  <Route path="/knowledge" element={<Knowledge />} />
                  <Route path="/knowledge-chat" element={<KnowledgeChat />} />
                  <Route path="/admin" element={<AdminDashboard />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          
        </ActiveEmailProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
