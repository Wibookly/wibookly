import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { ActiveEmailProvider } from "@/contexts/ActiveEmailContext";
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import { AppLayout } from "./components/app/AppLayout";
import Integrations from "./pages/Integrations";
import IntegrationSetup from "./pages/IntegrationSetup";
import Categories from "./pages/Categories";
import Sync from "./pages/Sync";
import Settings from "./pages/Settings";
import EmailDraft from "./pages/EmailDraft";
import AIActivityDashboard from "./pages/AIActivityDashboard";
import NotFound from "./pages/NotFound";

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
              <Route path="/" element={<Landing />} />
              <Route path="/auth" element={<Auth />} />
              {/* Backwards-compatible: older links/routes may still use /dashboard */}
              <Route path="/dashboard" element={<Navigate to="/integrations" replace />} />
              <Route element={<AppLayout />}>
                <Route path="/integrations" element={<Integrations />} />
                <Route path="/integration-setup" element={<IntegrationSetup />} />
                <Route path="/categories" element={<Categories />} />
                <Route path="/sync" element={<Sync />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/email-draft" element={<EmailDraft />} />
                <Route path="/ai-activity" element={<AIActivityDashboard />} />
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
