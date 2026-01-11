import React, { useState, useEffect } from 'react';
import { Layout } from '../components/Layout';
import { AlertBanner } from '../components/AlertBanner';
import { ErrorBoundary } from '../components/ErrorBoundary';
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

interface PaymentMethod {
  id: string;
  userId: string;
  stripePaymentMethodId: string;
  type: string;
  last4?: string;
  brand?: string;
  expMonth?: number;
  expYear?: number;
  isDefault: boolean;
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
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Stripe Elements state
  const [stripe, setStripe] = useState<any>(null);
  const [elements, setElements] = useState<any>(null);
  const [cardElement, setCardElement] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    console.log('Billing component mounted');
    loadBillingData();
    loadStripe();
  }, []);

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

      console.log('API responses:', { plansRes, subscriptionRes, invoicesRes });

      if (plansRes.ok && Array.isArray(plansRes.data)) {
        console.log('Setting plans to:', plansRes.data);
        setPlans(plansRes.data);
      } else {
        console.log('Not setting plans, response not OK or not array:', plansRes);
        // Ensure plans stays as empty array
        setPlans([]);
      }

      // Check if we got any successful responses
      if (!plansRes.ok && !subscriptionRes.ok && !invoicesRes.ok) {
        setError('Failed to load billing data. Please try refreshing the page.');
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
      // Load Stripe.js
      const stripeModule = await import('@stripe/stripe-js');
      const stripeInstance = await stripeModule.loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '');

      if (stripeInstance) {
        setStripe(stripeInstance);

        // Create Elements instance
        const elementsInstance = stripeInstance.elements();
        setElements(elementsInstance);

        // Create card element
        const card = elementsInstance.create('card', {
          style: {
            base: {
              fontSize: '16px',
              color: '#424770',
              '::placeholder': {
                color: '#aab7c4',
              },
            },
          },
        });
        setCardElement(card);

        // Mount the card element to the DOM
        const cardElementDiv = document.getElementById('card-element');
        if (cardElementDiv) {
          card.mount('#card-element');
        }
      } else {
        console.warn('Stripe failed to load - payment features will be disabled');
      }
    } catch (error) {
      console.error('Failed to load Stripe:', error);
      // Don't set error state for Stripe loading failure - just disable payment features
    }
  };

  const handleSubscribe = async (planId: string) => {
    if (!user || !stripe || !elements || !cardElement) return;

    setIsProcessing(true);
    setMessage(null);

    try {
      // Create payment method
      const { error: methodError, paymentMethod } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
      });

      if (methodError) {
        throw new Error(methodError.message);
      }

      const res = await apiJson<{ clientSecret: string; subscriptionId: string; stripeSubscriptionId: string; status: string }>(`/api/billing/subscription/user/${user.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId,
          paymentMethodId: paymentMethod.id,
        }),
      });

      if (!res.ok) {
        throw new Error(res.error?.message || 'Failed to create subscription');
      }

      const { clientSecret } = res.data;

      // Confirm payment
      const { error: confirmError } = await stripe.confirmCardPayment(clientSecret);

      if (confirmError) {
        throw new Error(confirmError.message);
      }

      setMessage({ type: 'success', text: 'Subscription created successfully!' });
      await loadBillingData();

    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to process payment' });
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
            <p className="text-lg text-slate-600 dark:text-slate-400">Manage your subscription and payment methods</p>
          </div>

          <AlertBanner
            variant="error"
            className="mb-6 animate-slide-down"
          >
            {error}
          </AlertBanner>

          <div className="card">
            <div className="text-center py-12">
              <svg className="w-16 h-16 text-slate-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">Unable to Load Billing Data</h3>
              <p className="text-slate-600 dark:text-slate-400 mb-6">
                We're having trouble loading your billing information. Please try refreshing the page or contact support if the problem persists.
              </p>
              <button
                onClick={() => {
                  setError(null);
                  setIsLoading(true);
                  loadBillingData();
                }}
                className="btn btn-primary"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

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
                        {(() => {
                          console.log('plans type:', typeof plans, 'plans value:', plans);
                          const safePlans = Array.isArray(plans) ? plans : [];
                          return subscription ? (safePlans.find(p => p.id === subscription.planId)?.name || 'Unknown Plan') : 'Loading...';
                        })()}
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
              {plans && plans.length > 0 ? plans.map((plan) => (
                <div
                  key={plan.id}
                  className={`p-6 rounded-lg border-2 transition-colors ${
                    subscription?.planId === plan.id
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
                  {subscription?.planId === plan.id ? (
                    <button className="w-full btn btn-secondary" disabled>
                      Current Plan
                    </button>
                  ) : plan.id === 'free' ? (
                    <button
                      onClick={() => handleSubscribe(plan.id)}
                      className="w-full btn btn-ghost"
                      disabled={isProcessing}
                    >
                      Downgrade to Free
                    </button>
                  ) : (
                    <div className="space-y-3">
                      {cardElement && (
                        <div className="p-3 border border-slate-300 dark:border-slate-600 rounded-lg">
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            Card Details
                          </label>
                          <div id="card-element" className="p-3 border border-slate-300 dark:border-slate-600 rounded"></div>
                        </div>
                      )}
                      <button
                        onClick={() => handleSubscribe(plan.id)}
                        disabled={isProcessing || !cardElement}
                        className="w-full btn btn-primary"
                      >
                        {isProcessing ? 'Processing...' : `Subscribe to ${plan.name}`}
                      </button>
                    </div>
                  )}
                </div>
              )) : (
                <div className="col-span-full text-center py-8">
                  <p className="text-slate-600 dark:text-slate-400">Loading available plans...</p>
                </div>
              )}
            </div>
          </div>

          {/* Payment Methods Card */}
          <div className="card animate-slide-up">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">Payment Methods</h2>
            <div className="space-y-4">
              {paymentMethods.length === 0 ? (
                <p className="text-slate-600 dark:text-slate-400">No payment methods saved.</p>
              ) : (
                paymentMethods.map((pm) => (
                  <div key={pm.id} className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-8 bg-gradient-to-r from-blue-600 to-blue-700 rounded flex items-center justify-center">
                          <span className="text-white text-xs font-bold">VISA</span>
                        </div>
                        <div>
                          <p className="font-medium text-slate-900 dark:text-slate-100">
                            {pm.brand} ending in {pm.last4}
                          </p>
                          <p className="text-sm text-slate-600 dark:text-slate-400">
                            Expires {pm.expMonth}/{pm.expYear}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button className="px-3 py-1 text-sm rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                          Edit
                        </button>
                        <button className="px-3 py-1 text-sm rounded-lg border border-red-300 dark:border-red-600 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
              <button className="w-full btn btn-secondary">Add Payment Method</button>
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
                  {invoices.map((invoice) => (
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
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          invoice.status === 'paid'
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
                  ))}
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
                    <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};
