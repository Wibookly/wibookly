import { useState } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { AppSidebar } from './AppSidebar';
import { MobileHeader } from './MobileHeader';
import { MobileSidebar } from './MobileSidebar';
import { useOrganizationLogo } from '@/hooks/useOrganizationLogo';
import { Loader2 } from 'lucide-react';

export function AppLayout() {
  const { user, loading, organization } = useAuth();
  const orgLogoUrl = useOrganizationLogo(organization?.id);
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
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Mobile Header */}
      <MobileHeader onMenuClick={() => setMobileMenuOpen(true)} />
      
      {/* Mobile Sidebar (Sheet) */}
      <MobileSidebar open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
      
      {/* Desktop Sidebar */}
      <AppSidebar />
      
      <div className="flex-1 flex flex-col min-h-0">
        <main className="flex-1 overflow-auto relative" style={{ background: 'var(--gradient-hero)' }}>
          {orgLogoUrl ? (
            <img
              src={orgLogoUrl}
              alt={organization?.name || 'Company logo'}
              className="hidden lg:block absolute top-3 left-6 max-h-10 w-auto object-contain mix-blend-multiply opacity-90 pointer-events-none z-10"
            />
          ) : null}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
