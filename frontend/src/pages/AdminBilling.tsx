import React, { useState, useEffect } from 'react';
import { Layout } from '../components/Layout';
import { AlertBanner } from '../components/AlertBanner';
import { apiJson } from '../lib/api';

interface BillingPlan {
  id: string;
  name: string;
  description?: string;
  priceCents: number;
  currency: string;
  interval: string;
  stripePriceId?: string;
  isCustomPrice: boolean;
  limits?: {
    social_accounts: number;
    posts_per_month: number;
    storage_gb: number;
    analytics: string;
  };
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const AdminBilling: React.FC = () => {
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingPlan, setEditingPlan] = useState<BillingPlan | null>(null);
  const [showMigrateDialog, setShowMigrateDialog] = useState(false);
  const [migratingPlanId, setMigratingPlanId] = useState<string | null>(null);
  const [migrateData, setMigrateData] = useState({
    newPriceCents: 0,
    gracePeriodMonths: 3,
    reason: '',
  });

  const [isSyncingLegacy, setIsSyncingLegacy] = useState(false);

  const [isPruning, setIsPruning] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    id: '',
    name: '',
    description: '',
    priceCents: 0,
    currency: 'usd',
    interval: 'month',
    stripePriceId: '',
    isCustomPrice: false,
    limits: {
      social_accounts: 0,
      posts_per_month: 0,
      storage_gb: 0,
      analytics: 'basic' as string,
    },
    isActive: true,
  });

  useEffect(() => {
    loadPlans();
  }, []);

  const loadPlans = async () => {
    try {
      const res = await apiJson<BillingPlan[]>('/api/billing/plans');
      if (res.ok) {
        setPlans(res.data);
      } else {
        console.error('Failed to load plans:', res.error);
        setMessage({ type: 'error', text: 'Failed to load plans' });
      }
    } catch (error: any) {
      console.error('Failed to load plans:', error);
      setMessage({ type: 'error', text: error.message || 'Failed to load plans' });
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setMessage(null);
    setFormData({
      id: '',
      name: '',
      description: '',
      priceCents: 0,
      currency: 'usd',
      interval: 'month',
      stripePriceId: '',
      isCustomPrice: false,
      limits: {
        social_accounts: 0,
        posts_per_month: 0,
        storage_gb: 0,
        analytics: 'basic',
      },
      isActive: true,
    });
    setEditingPlan(null);
    setShowCreateForm(false);
  };

  const openCreateForm = () => {
    setMessage(null);
    setFormData({
      id: '',
      name: '',
      description: '',
      priceCents: 0,
      currency: 'usd',
      interval: 'month',
      stripePriceId: '',
      isCustomPrice: false,
      limits: {
        social_accounts: 0,
        posts_per_month: 0,
        storage_gb: 0,
        analytics: 'basic',
      },
      isActive: true,
    });
    setEditingPlan(null);
    setShowCreateForm(true);
  };

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setMessage(null);
      const res = await apiJson('/api/billing/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
        }),
      });

      if (res.ok) {
        setMessage({ type: 'success', text: 'Plan created successfully' });
        resetForm();
        loadPlans();
      } else {
        setMessage({ type: 'error', text: res.error?.message || 'Failed to create plan' });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to create plan' });
    }
  };

  const handleUpdatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPlan) return;

    try {
      setMessage(null);
      const res = await apiJson(`/api/billing/plans/${editingPlan.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
        }),
      });

      if (res.ok) {
        setMessage({ type: 'success', text: 'Plan updated successfully' });
        resetForm();
        loadPlans();
      } else {
        setMessage({ type: 'error', text: res.error?.message || 'Failed to update plan' });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to update plan' });
    }
  };

  const handleDeletePlan = async (planId: string) => {
    if (!confirm('Are you sure you want to delete this plan? This action cannot be undone.')) {
      return;
    }

    try {
      setMessage(null);
      const res = await apiJson(`/api/billing/plans/${planId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setMessage({ type: 'success', text: 'Plan deleted successfully' });
        loadPlans();
      } else {
        setMessage({ type: 'error', text: res.error?.message || 'Failed to delete plan' });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to delete plan' });
    }
  };

  const handleEditPlan = (plan: BillingPlan) => {
    setFormData({
      id: plan.id,
      name: plan.name,
      description: plan.description || '',
      priceCents: plan.priceCents,
      currency: plan.currency,
      interval: plan.interval,
      stripePriceId: plan.stripePriceId || '',
      isCustomPrice: !!plan.isCustomPrice,
      limits: {
        social_accounts: 0,
        posts_per_month: 0,
        storage_gb: 0,
        analytics: 'basic',
        ...(plan.limits || {}),
      },
      isActive: plan.isActive,
    });
    setEditingPlan(plan);
    setShowCreateForm(true);
  };

  const handleMigratePlan = (plan: BillingPlan) => {
    setMigratingPlanId(plan.id);
    setMigrateData({
      newPriceCents: plan.priceCents,
      gracePeriodMonths: 3,
      reason: '',
    });
    setShowMigrateDialog(true);
  };

  const handleSubmitMigration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!migratingPlanId) return;

    try {
      setMessage(null);
      const res = await apiJson(`/api/billing/plans/${migratingPlanId}/migrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(migrateData),
      });

      if (res.ok) {
        setMessage({
          type: 'success',
          text: `Plan migration created successfully. Grace period: ${migrateData.gracePeriodMonths} months`
        });
        setShowMigrateDialog(false);
        setMigratingPlanId(null);
        loadPlans();
      } else {
        setMessage({ type: 'error', text: res.error?.message || 'Failed to migrate plan' });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to migrate plan' });
    }
  };

  const handlePrunePrices = async () => {
    try {
      setIsPruning(true);
      setMessage(null);
      const res = await apiJson('/api/billing/products/archive', {
        method: 'POST',
      });

      if (res.ok) {
        const data = res.data as { archivedCount?: number; message?: string };
        setMessage({
          type: 'success',
          text: `Pruning completed! Archived ${data.archivedCount || 0} products with no active subscribers.`
        });
        loadPlans(); // Refresh the list to show archived status
      } else {
        setMessage({ type: 'error', text: res.error?.message || 'Failed to prune plans' });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to prune plans' });
    } finally {
      setIsPruning(false);
    }
  };

  const handleSyncLegacyPlans = async () => {
    try {
      setIsSyncingLegacy(true);
      setMessage(null);
      const res = await apiJson('/api/billing/sync/legacy-plans', {
        method: 'POST',
      });

      if (res.ok) {
        const data = res.data as { syncedCount?: number; message?: string; errors?: string[] };
        setMessage({
          type: 'success',
          text: `Legacy sync completed! Created Stripe plans for ${data.syncedCount || 0} legacy plans.`
        });
        loadPlans(); // Refresh the list to show updated Stripe IDs
      } else {
        setMessage({ type: 'error', text: res.error?.message || 'Failed to sync legacy plans' });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to sync legacy plans' });
    } finally {
      setIsSyncingLegacy(false);
    }
  };

  const formatPrice = (cents: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="w-full max-w-7xl mx-auto pt-6">
          <div className="animate-pulse">
            <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-48 mb-6"></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(3)].map((_, i) => (
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

  return (
    <Layout>
      <div className="w-full max-w-7xl mx-auto pt-6">
        <div className="mb-8 animate-fade-in">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-100 mb-2">Plan Management</h1>
              <p className="text-lg text-slate-600 dark:text-slate-400">Create and manage billing plans</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleSyncLegacyPlans}
                disabled={isSyncingLegacy}
                className="btn btn-outline"
                title="Create proper Stripe plans for legacy plans that don't have real Stripe IDs"
              >
                {isSyncingLegacy ? 'Syncing...' : '🔄 Sync Legacy Plans'}
              </button>
              <button
                onClick={handlePrunePrices}
                disabled={isPruning}
                className="btn btn-outline"
                title="Archive migrated products with no active subscribers"
              >
                {isPruning ? 'Pruning...' : '🗑️ Prune Plans'}
              </button>
              <button
                onClick={() => {
                  if (showCreateForm) {
                    resetForm();
                  } else {
                    openCreateForm();
                  }
                }}
                className="btn btn-primary"
              >
                {showCreateForm ? 'Cancel' : 'Create Plan'}
              </button>
            </div>
          </div>
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

        {showCreateForm && (
          <div className="card mb-8 animate-slide-up">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">
              {editingPlan ? 'Edit Plan' : 'Create New Plan'}
            </h2>

            <form onSubmit={editingPlan ? handleUpdatePlan : handleCreatePlan} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="planId" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Plan ID {!editingPlan && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type="text"
                    id="planId"
                    value={formData.id}
                    onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                    disabled={!!editingPlan}
                    className="input"
                    placeholder="e.g., pro, enterprise"
                    required={!editingPlan}
                  />
                </div>

                <div>
                  <label htmlFor="planName" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Plan Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    id="planName"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="input"
                    placeholder="e.g., Pro Plan"
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="description" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Description
                </label>
                <textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="input"
                  rows={3}
                  placeholder="Describe the plan..."
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label htmlFor="price" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Price (cents)
                  </label>
                  <input
                    type="number"
                    id="price"
                    value={formData.priceCents}
                    onChange={(e) => setFormData({ ...formData, priceCents: parseInt(e.target.value) || 0 })}
                    className="input"
                    placeholder="2900"
                    min="0"
                  />
                </div>

                <div>
                  <label htmlFor="currency" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Currency
                  </label>
                  <select
                    id="currency"
                    value={formData.currency}
                    onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                    className="input"
                  >
                    <option value="usd">USD</option>
                    <option value="eur">EUR</option>
                    <option value="gbp">GBP</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="interval" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Interval
                  </label>
                  <select
                    id="interval"
                    value={formData.interval}
                    onChange={(e) => setFormData({ ...formData, interval: e.target.value })}
                    className="input"
                  >
                    <option value="month">Monthly</option>
                    <option value="year">Yearly</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="stripePriceId" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Stripe Price ID
                </label>
                <input
                  type="text"
                  id="stripePriceId"
                  value={formData.stripePriceId}
                  onChange={(e) => setFormData({ ...formData, stripePriceId: e.target.value })}
                  className="input"
                  placeholder="price_..."
                />
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="isCustomPrice"
                  checked={formData.isCustomPrice}
                  onChange={(e) => setFormData({ ...formData, isCustomPrice: e.target.checked })}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-slate-300 rounded"
                />
                <label htmlFor="isCustomPrice" className="ml-2 block text-sm text-slate-700 dark:text-slate-300">
                  Custom pricing per user
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div>
                  <label htmlFor="socialAccounts" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Social Accounts Limit
                  </label>
                  <input
                    type="number"
                    id="socialAccounts"
                    value={formData.limits.social_accounts}
                    onChange={(e) => setFormData({
                      ...formData,
                      limits: { ...formData.limits, social_accounts: parseInt(e.target.value) || 0 }
                    })}
                    className="input"
                    placeholder="-1 for unlimited"
                    min="-1"
                  />
                </div>

                <div>
                  <label htmlFor="postsPerMonth" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Posts/Month Limit
                  </label>
                  <input
                    type="number"
                    id="postsPerMonth"
                    value={formData.limits.posts_per_month}
                    onChange={(e) => setFormData({
                      ...formData,
                      limits: { ...formData.limits, posts_per_month: parseInt(e.target.value) || 0 }
                    })}
                    className="input"
                    placeholder="-1 for unlimited"
                    min="-1"
                  />
                </div>

                <div>
                  <label htmlFor="storageGb" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Storage (GB)
                  </label>
                  <input
                    type="number"
                    id="storageGb"
                    value={formData.limits.storage_gb ?? 0}
                    onChange={(e) => setFormData({
                      ...formData,
                      limits: { ...formData.limits, storage_gb: parseInt(e.target.value) || 0 }
                    })}
                    className="input"
                    placeholder="-1 for unlimited"
                    min="-1"
                  />
                </div>

                <div>
                  <label htmlFor="analytics" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Analytics Level
                  </label>
                  <select
                    id="analytics"
                    value={formData.limits.analytics}
                    onChange={(e) => setFormData({
                      ...formData,
                      limits: { ...formData.limits, analytics: e.target.value }
                    })}
                    className="input"
                  >
                    <option value="basic">Basic</option>
                    <option value="advanced">Advanced</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-slate-300 rounded"
                />
                <label htmlFor="isActive" className="ml-2 block text-sm text-slate-700 dark:text-slate-300">
                  Plan is active
                </label>
              </div>

              <div className="flex gap-3">
                <button
                  type="submit"
                  className="btn btn-primary"
                >
                  {editingPlan ? 'Update Plan' : 'Create Plan'}
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="btn btn-ghost"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="card animate-slide-up">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">Existing Plans</h2>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">ID</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">Name</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">Price</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">Status</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">Actions</th>
                </tr>
              </thead>
              <tbody>
                {Array.isArray(plans) && plans.map((plan) => (
                  <tr key={plan.id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="py-3 px-4 text-slate-700 dark:text-slate-300 font-mono text-sm">
                      {plan.id}
                    </td>
                    <td className="py-3 px-4 text-slate-700 dark:text-slate-300 font-medium">
                      {plan.name}
                    </td>
                    <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                      {formatPrice(plan.priceCents, plan.currency)}/{plan.interval}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        plan.isActive
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                          : 'bg-slate-100 dark:bg-slate-900/30 text-slate-800 dark:text-slate-300'
                      }`}>
                        {plan.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEditPlan(plan)}
                          className="px-3 py-1 text-sm rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleMigratePlan(plan)}
                          className="px-3 py-1 text-sm rounded-lg border border-blue-300 dark:border-blue-600 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                          title="Create new price with grace period"
                        >
                          Migrate
                        </button>
                        <button
                          onClick={() => handleDeletePlan(plan.id)}
                          className="px-3 py-1 text-sm rounded-lg border border-red-300 dark:border-red-600 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showMigrateDialog && migratingPlanId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl max-w-md w-full p-6 animate-slide-up">
            <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-4">
              Migrate Plan Price
            </h3>
            <p className="text-slate-600 dark:text-slate-400 mb-6">
              Create a new price version with a grace period for existing subscribers to transition.
            </p>

            <form onSubmit={handleSubmitMigration} className="space-y-4">
              <div>
                <label htmlFor="newPrice" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  New Price (cents)
                </label>
                <input
                  type="number"
                  id="newPrice"
                  value={migrateData.newPriceCents}
                  onChange={(e) => setMigrateData({ ...migrateData, newPriceCents: parseInt(e.target.value) || 0 })}
                  className="input"
                  placeholder="e.g., 2900"
                  min="0"
                  required
                />
              </div>

              <div>
                <label htmlFor="gracePeriod" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Grace Period (months)
                </label>
                <input
                  type="number"
                  id="gracePeriod"
                  value={migrateData.gracePeriodMonths}
                  onChange={(e) => setMigrateData({ ...migrateData, gracePeriodMonths: parseInt(e.target.value) || 0 })}
                  className="input"
                  placeholder="e.g., 3"
                  min="0"
                  required
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Existing subscribers will have this many months before being migrated to the new price.
                </p>
              </div>

              <div>
                <label htmlFor="reason" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Reason (optional)
                </label>
                <textarea
                  id="reason"
                  value={migrateData.reason}
                  onChange={(e) => setMigrateData({ ...migrateData, reason: e.target.value })}
                  className="input"
                  rows={2}
                  placeholder="e.g., Price increase due to new features"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 btn btn-primary"
                >
                  Create Migration
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMigrateDialog(false);
                    setMigratingPlanId(null);
                  }}
                  className="flex-1 btn btn-ghost"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
};
