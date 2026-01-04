import { useState } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { AppSidebar } from './AppSidebar';
import { AppHeader } from './AppHeader';
import { MobileHeader } from './MobileHeader';
import { MobileSidebar } from './MobileSidebar';
import { Loader2 } from 'lucide-react';

export function AppLayout() {
  const { user, loading } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
    <div className="min-h-screen flex flex-col lg:flex-row bg-background">
      {/* Mobile Header */}
      <MobileHeader onMenuClick={() => setMobileMenuOpen(true)} />
      
      {/* Mobile Sidebar (Sheet) */}
      <MobileSidebar open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
      
      {/* Desktop Sidebar */}
      <AppSidebar />
      
      <div className="flex-1 flex flex-col min-h-0">
        <div className="hidden lg:block">
          <AppHeader />
        </div>
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
