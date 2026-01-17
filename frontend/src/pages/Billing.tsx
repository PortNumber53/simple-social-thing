import React, { useState, useEffect } from 'react';
import { Layout } from '../components/Layout';
import { AlertBanner } from '../components/AlertBanner';
import { useAuth } from '../contexts/AuthContext';
import { apiJson } from '../lib/api';

interface BillingPlan {
  id: string;
  name: string;
  description?: string;
  priceCents: number;
  currency: string;
  interval: string;
  features?: Record<string, any>;
  limits?: Record<string, any>;
  isActive: boolean;
}

interface Subscription {
  id: string;
  userId: string;
  planId: string;
  stripeSubscriptionId?: string;
  stripeCustomerId?: string;
  status: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  canceledAt?: string;
  trialStart?: string;
  trialEnd?: string;
  createdAt: string;
  updatedAt: string;
}

interface Invoice {
  id: string;
  userId: string;
  stripeInvoiceId: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  status: string;
  invoicePdf?: string;
  hostedInvoiceUrl?: string;
  periodStart?: string;
  periodEnd?: string;
  createdAt: string;
}

export const Billing: React.FC = () => {
  const { user } = useAuth();
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Stripe state
  const [stripe, setStripe] = useState<any>(null);
  const [cardElement, setCardElement] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Modal / Selection state
  const [selectedPlan, setSelectedPlan] = useState<BillingPlan | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  useEffect(() => {
    console.log('Billing component mounted');
    loadBillingData();
    loadStripe();
  }, []);

  // Mount card element when modal opens
  useEffect(() => {
    if (showPaymentModal && stripe) {
      // Create fresh elements instance
      const elementsInstance = stripe.elements();
      const card = elementsInstance.create('card', {
        style: {
          base: {
            fontSize: '16px',
            color: '#424770',
            fontFamily: 'Inter, system-ui, sans-serif',
            '::placeholder': { color: '#aab7c4' },
          },
        },
      });

      // Mount to the DOM element
      // We use a small timeout to ensure DOM is ready.
      // Since this effect runs after render, the #card-element div should exist.
      const mountPoint = document.getElementById('card-element');
      if (mountPoint) {
        card.mount('#card-element');
        setCardElement(card);
      }

      // Cleanup
      return () => {
        card.destroy();
        setCardElement(null);
      };
    }
  }, [showPaymentModal, stripe]);

  const loadBillingData = async () => {
    if (!user) {
      setError('User not authenticated');
      setIsLoading(false);
      return;
    }

    try {
      setError(null);
      const [plansRes, subscriptionRes, invoicesRes] = await Promise.all([
        apiJson<BillingPlan[]>('/api/billing/plans'),
        apiJson<Subscription>(`/api/billing/subscription/user/${user.id}`),
        apiJson<Invoice[]>(`/api/billing/invoices/user/${user.id}`),
      ]);

      if (plansRes.ok && Array.isArray(plansRes.data)) {
        setPlans(plansRes.data);
      } else {
        setPlans([]);
      }

      if (!plansRes.ok && !subscriptionRes.ok && !invoicesRes.ok) {
        setError('Failed to load billing data. Please try refreshing the page.');
      } else {
        if (subscriptionRes.ok) setSubscription(subscriptionRes.data);
        if (invoicesRes.ok && Array.isArray(invoicesRes.data)) setInvoices(invoicesRes.data);
      }

    } catch (error: any) {
      console.error('Failed to load billing data:', error);
      setError(error.message || 'An unexpected error occurred while loading billing data.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadStripe = async () => {
    try {
      const stripeModule = await import('@stripe/stripe-js');
      const stripeInstance = await stripeModule.loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '');

      if (stripeInstance) {
        setStripe(stripeInstance);
      }
    } catch (error) {
      console.error('Failed to load Stripe:', error);
    }
  };

  const handleInitiateSubscribe = (plan: BillingPlan) => {
    if (plan.id === 'free') {
      performSubscription(plan.id, null);
    } else {
      setSelectedPlan(plan);
      setShowPaymentModal(true);
    }
  };

  const confirmPayment = async () => {
    if (!stripe || !cardElement || !selectedPlan) return;

    setIsProcessing(true);
    try {
      const { error: methodError, paymentMethod } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
      });

      if (methodError) throw new Error(methodError.message);
      await performSubscription(selectedPlan.id, paymentMethod.id);
      setShowPaymentModal(false);
      setSelectedPlan(null);
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Payment failed' });
    } finally {
      setIsProcessing(false);
    }
  };

  const performSubscription = async (planId: string, paymentMethodId: string | null) => {
    if (!user) return;
    setIsProcessing(true);
    setMessage(null);

    try {
      const res = await apiJson<{ clientSecret: string; subscriptionId: string; stripeSubscriptionId: string; status: string }>(`/api/billing/subscription/user/${user.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId,
          paymentMethodId,
        }),
      });

      if (!res.ok) throw new Error(res.error?.message || 'Failed to create subscription');

      if (res.data.clientSecret && paymentMethodId) {
        const { error: confirmError } = await stripe.confirmCardPayment(res.data.clientSecret);
        if (confirmError) throw new Error(confirmError.message);
      }

      setMessage({ type: 'success', text: 'Subscription updated successfully!' });
      await loadBillingData();

    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to process subscription' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (!user || !subscription) return;

    try {
      const res = await apiJson('/api/billing/subscription/cancel/user/' + user.id, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancelAtPeriodEnd: true }),
      });

      if (!res.ok) {
        throw new Error(res.error?.message || 'Failed to cancel subscription');
      }

      setMessage({ type: 'success', text: 'Subscription will be cancelled at the end of the billing period.' });
      await loadBillingData();

    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to cancel subscription' });
    }
  };

  const formatPrice = (cents: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="w-full max-w-6xl xl:max-w-7xl 2xl:max-w-none mx-auto pt-6">
          <div className="animate-pulse">
            <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-48 mb-6"></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="card">
                  <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded w-32 mb-4"></div>
                  <div className="space-y-2">
                    <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-full"></div>
                    <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4"></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="w-full max-w-6xl xl:max-w-7xl 2xl:max-w-none mx-auto pt-6">
          <div className="mb-8 animate-fade-in">
            <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-100 mb-2">Billing</h1>
          </div>
          <AlertBanner variant="error" className="mb-6 animate-slide-down">{error}</AlertBanner>
          <div className="card text-center py-12">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">Unable to Load Billing Data</h3>
            <button onClick={() => { setError(null); setIsLoading(true); loadBillingData(); }} className="btn btn-primary">Try Again</button>
          </div>
        </div>
      </Layout>
    );
  }

  const currentPlanId = subscription?.planId || 'free';

  return (
    <Layout>
      <div className="w-full max-w-6xl xl:max-w-7xl 2xl:max-w-none mx-auto pt-6">
        <div className="mb-8 animate-fade-in">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-100 mb-2">Billing</h1>
          <p className="text-lg text-slate-600 dark:text-slate-400">Manage your subscription and payment methods</p>
        </div>

        {message && (
          <AlertBanner
            variant={message.type === 'success' ? 'success' : 'error'}
            className="mb-6 animate-slide-down"
            dismissible
            onDismiss={() => setMessage(null)}
          >
            {message.text}
          </AlertBanner>
        )}

        <div className="space-y-6">
          {/* Current Plan Card */}
          <div className="card animate-slide-up">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">Current Plan</h2>
            <div className="space-y-4">
              {subscription ? (
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border-2 border-primary-500">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {plans.find(p => p.id === subscription.planId)?.name || 'Unknown Plan'}
                      </h3>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        {subscription.status === 'active' ? 'Active' : subscription.status}
                        {subscription.cancelAtPeriodEnd && ' (Cancelling)'}
                      </p>
                    </div>
                    <div className="text-right">
                      {subscription.currentPeriodEnd && (
                        <>
                          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Renews on</p>
                          <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                            {formatDate(subscription.currentPeriodEnd)}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                  {subscription.cancelAtPeriodEnd && (
                    <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 rounded-lg">
                      <p className="text-sm text-amber-800 dark:text-amber-200">
                        Your subscription will be cancelled on {subscription.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : 'the next billing date'}.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border-2 border-slate-300 dark:border-slate-600">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Free Plan</h3>
                      <p className="text-sm text-slate-600 dark:text-slate-400">Basic features included</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">$0/month</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Plans Card */}
          <div className="card animate-slide-up">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">Available Plans</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {plans.map((plan) => (
                <div
                  key={plan.id}
                  className={`p-6 rounded-lg border-2 transition-colors ${currentPlanId === plan.id
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                >
                  <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">{plan.name}</h3>
                  {plan.description && (
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">{plan.description}</p>
                  )}
                  <div className="mb-4">
                    <span className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                      {formatPrice(plan.priceCents, plan.currency)}
                    </span>
                    <span className="text-slate-600 dark:text-slate-400">/{plan.interval}</span>
                  </div>

                  {plan.features?.features && Array.isArray(plan.features.features) && (
                    <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1 mb-6">
                      {plan.features.features.map((feature: string, idx: number) => (
                        <li key={idx} className="flex items-center">
                          <svg className="w-4 h-4 text-green-500 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          {feature}
                        </li>
                      ))}
                    </ul>
                  )}

                  {currentPlanId === plan.id ? (
                    <button className="w-full btn btn-secondary" disabled>
                      Current Plan
                    </button>
                  ) : (
                    <button
                      onClick={() => handleInitiateSubscribe(plan)}
                      className={`w-full btn ${plan.id === 'free' ? 'btn-ghost' : 'btn-primary'}`}
                      disabled={isProcessing}
                    >
                      {plan.id === 'free' ? 'Downgrade to Free' : `Subscribe to ${plan.name}`}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Billing History Card */}
          <div className="card animate-slide-up">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">Billing History</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="text-left py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">Date</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">Description</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">Amount</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">Status</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.length > 0 ? invoices.map((invoice) => (
                    <tr key={invoice.id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-300">{formatDate(invoice.createdAt)}</td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                        {invoice.periodStart && invoice.periodEnd
                          ? `${formatDate(invoice.periodStart)} - ${formatDate(invoice.periodEnd)}`
                          : 'Invoice'
                        }
                      </td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                        {formatPrice(invoice.amountPaid, invoice.currency)}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${invoice.status === 'paid'
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                            : 'bg-slate-100 dark:bg-slate-900/30 text-slate-800 dark:text-slate-300'
                          }`}>
                          {invoice.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {invoice.hostedInvoiceUrl && (
                          <a
                            href={invoice.hostedInvoiceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 text-sm font-medium"
                          >
                            View
                          </a>
                        )}
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-slate-500 dark:text-slate-400">No invoices found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Danger Zone */}
          {subscription && subscription.status === 'active' && !subscription.cancelAtPeriodEnd && (
            <div className="card border-2 border-red-200 dark:border-red-900/30 animate-slide-up">
              <h2 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-6">Danger Zone</h2>
              <div className="space-y-4">
                <button
                  onClick={handleCancelSubscription}
                  className="w-full p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-left hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors border border-red-200 dark:border-red-900/50"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-red-600 dark:text-red-400">Cancel Subscription</h3>
                      <p className="text-sm text-red-600/70 dark:text-red-400/70 mt-1">
                        Cancel your subscription and downgrade to the free plan
                      </p>
                    </div>
                    <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal for Payment */}
        {showPaymentModal && selectedPlan && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full p-6 space-y-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Subscribe to {selectedPlan.name}
              </h3>
              <div className="mb-4">
                <span className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                  {formatPrice(selectedPlan.priceCents, selectedPlan.currency)}
                </span>
                <span className="text-slate-600 dark:text-slate-400">/{selectedPlan.interval}</span>
              </div>

              <div className="space-y-3">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Card Details
                </label>
                <div id="card-element" className="p-3 border border-slate-300 dark:border-slate-600 rounded bg-white">
                  {/* Stripe Element mounts here */}
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => { setShowPaymentModal(false); setSelectedPlan(null); }}
                  className="flex-1 btn btn-ghost"
                  disabled={isProcessing}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmPayment}
                  className="flex-1 btn btn-primary"
                  disabled={isProcessing}
                >
                  {isProcessing ? 'Processing...' : 'Confirm Payment'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};
