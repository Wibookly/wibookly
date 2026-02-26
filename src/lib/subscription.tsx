import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

// Plan configuration with Stripe product/price IDs
export const PLAN_CONFIG = {
  starter: {
    name: 'Starter',
    price: 20,
    priceId: 'price_1Sog5tAESvm0s6Eqlef0MlRD',
    productId: 'prod_TmEZSmRDQaRFxJ',
    mailboxLimit: 1,
    features: {
      aiAutoDrafts: true,
      aiAutoReply: false,
      advancedAutomation: false,
      aiSignature: false,
      advancedAnalytics: false,
    },
  },
  professional: {
    name: 'Professional',
    price: 50,
    priceId: 'price_1Sog6BAESvm0s6EqGMDf8sch',
    productId: 'prod_TmEZZY5hzUCPhe',
    mailboxLimit: 4,
    features: {
      aiAutoDrafts: true,
      aiAutoReply: true,
      advancedAutomation: true,
      aiSignature: true,
      advancedAnalytics: true,
    },
  },
  enterprise: {
    name: 'Enterprise',
    price: null, // Contact sales
    priceId: null,
    productId: null,
    mailboxLimit: Infinity,
    features: {
      aiAutoDrafts: true,
      aiAutoReply: true,
      advancedAutomation: true,
      aiSignature: true,
      advancedAnalytics: true,
    },
  },
} as const;

export type PlanType = keyof typeof PLAN_CONFIG;

export interface SubscriptionState {
  plan: PlanType;
  status: 'active' | 'canceled' | 'past_due' | 'trialing' | 'none';
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  loading: boolean;
}

interface SubscriptionContextType extends SubscriptionState {
  refreshSubscription: () => Promise<void>;
  canConnectMoreMailboxes: (currentCount: number) => boolean;
  hasFeature: (feature: keyof typeof PLAN_CONFIG.starter.features) => boolean;
  getMailboxLimit: () => number;
  getUpgradePlan: () => PlanType | null;
  startCheckout: (plan: PlanType) => Promise<void>;
  openCustomerPortal: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { user, session, organization } = useAuth();
  const [state, setState] = useState<SubscriptionState>({
    plan: 'starter',
    status: 'none',
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    loading: true,
  });

  const fetchSubscription = useCallback(async () => {
    // Don't call if no org or no valid session
    if (!organization?.id || !session?.access_token) {
      setState(prev => ({ ...prev, loading: false }));
      return;
    }

    try {
      // First check local database for subscription
      const { data: subData } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('organization_id', organization.id)
        .maybeSingle();

      if (subData) {
        setState({
          plan: (subData.plan as PlanType) || 'starter',
          status: (subData.status as SubscriptionState['status']) || 'active',
          stripeCustomerId: subData.stripe_customer_id,
          stripeSubscriptionId: subData.stripe_subscription_id,
          currentPeriodEnd: subData.current_period_end,
          loading: false,
        });
      } else {
        setState(prev => ({ ...prev, plan: 'starter', status: 'active', loading: false }));
      }

      // Verify with Stripe (session is guaranteed to exist here)
      const { data, error } = await supabase.functions.invoke('check-subscription', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!error && data && !data.error) {
        // Determine plan from product ID
        let detectedPlan: PlanType = 'starter';
        if (data.product_id === PLAN_CONFIG.professional.productId) {
          detectedPlan = 'professional';
        } else if (data.subscribed && data.product_id) {
          // Could be enterprise or other
          detectedPlan = 'professional';
        }

        setState(prev => ({
          ...prev,
          plan: data.subscribed ? detectedPlan : prev.plan,
          status: data.subscribed ? 'active' : prev.status,
          currentPeriodEnd: data.subscription_end || prev.currentPeriodEnd,
          loading: false,
        }));
      }
    } catch (error) {
      console.error('Error fetching subscription:', error);
      setState(prev => ({ ...prev, loading: false }));
    }
  }, [organization?.id, session?.access_token]);

  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  // Auto-refresh subscription every minute
  useEffect(() => {
    const interval = setInterval(fetchSubscription, 60000);
    return () => clearInterval(interval);
  }, [fetchSubscription]);

  const canConnectMoreMailboxes = useCallback((currentCount: number) => {
    const limit = PLAN_CONFIG[state.plan].mailboxLimit;
    return currentCount < limit;
  }, [state.plan]);

  const hasFeature = useCallback((feature: keyof typeof PLAN_CONFIG.starter.features) => {
    return PLAN_CONFIG[state.plan].features[feature];
  }, [state.plan]);

  const getMailboxLimit = useCallback(() => {
    return PLAN_CONFIG[state.plan].mailboxLimit;
  }, [state.plan]);

  const getUpgradePlan = useCallback((): PlanType | null => {
    if (state.plan === 'starter') return 'professional';
    if (state.plan === 'professional') return 'enterprise';
    return null;
  }, [state.plan]);

  const startCheckout = useCallback(async (plan: PlanType) => {
    if (!session?.access_token) {
      throw new Error('Please sign in to upgrade');
    }

    const priceId = PLAN_CONFIG[plan].priceId;
    if (!priceId) {
      // Enterprise - contact sales
      window.open('mailto:sales@example.com?subject=Enterprise%20Plan%20Inquiry', '_blank');
      return;
    }

    const { data, error } = await supabase.functions.invoke('create-checkout', {
      body: { priceId },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (error) throw error;
    if (data?.url) {
      window.open(data.url, '_blank');
    }
  }, [session?.access_token]);

  const openCustomerPortal = useCallback(async () => {
    if (!session?.access_token) {
      throw new Error('Please sign in to manage subscription');
    }

    const { data, error } = await supabase.functions.invoke('customer-portal', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (error) throw error;
    if (data?.url) {
      window.open(data.url, '_blank');
    }
  }, [session?.access_token]);

  return (
    <SubscriptionContext.Provider
      value={{
        ...state,
        refreshSubscription: fetchSubscription,
        canConnectMoreMailboxes,
        hasFeature,
        getMailboxLimit,
        getUpgradePlan,
        startCheckout,
        openCustomerPortal,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const context = useContext(SubscriptionContext);
  if (context === undefined) {
    throw new Error('useSubscription must be used within a SubscriptionProvider');
  }
  return context;
}
