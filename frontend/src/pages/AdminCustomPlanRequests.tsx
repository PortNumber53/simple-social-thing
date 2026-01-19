import React, { useEffect, useMemo, useState } from 'react';
import { Layout } from '../components/Layout';
import { AlertBanner } from '../components/AlertBanner';
import { apiJson } from '../lib/api';

interface CustomPlanRequest {
  id: string;
  userId: string;
  requestedSocialAccounts: number;
  requestedPostsPerMonth: number;
  requestedStorageGb: number;
  notes?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface BillingPlan {
  id: string;
  priceCents: number;
  currency: string;
  interval: string;
  limits?: Record<string, any>;
}

type StatusFilter = 'all' | 'pending' | 'reviewing' | 'approved' | 'rejected';

type StatusValue = 'pending' | 'reviewing' | 'approved' | 'rejected';

export const AdminCustomPlanRequests: React.FC = () => {
  const [requests, setRequests] = useState<CustomPlanRequest[]>([]);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [isUpdating, setIsUpdating] = useState<Record<string, boolean>>({});

  const [approveModal, setApproveModal] = useState<{ open: boolean; request: CustomPlanRequest | null }>({ open: false, request: null });
  const [approveForm, setApproveForm] = useState({
    priceCents: 0,
    currency: 'usd',
    interval: 'month',
    limits: {
      social_accounts: 0,
      posts_per_month: 0,
      storage_gb: 0,
      analytics: 'basic',
    } as Record<string, any>,
    notes: '',
  });

  const filteredRequests = useMemo(() => {
    if (statusFilter === 'all') return requests;
    return requests.filter((r) => (r.status || '').toLowerCase() === statusFilter);
  }, [requests, statusFilter]);

  const loadRequests = async () => {
    setMessage(null);
    try {
      const [requestsRes, plansRes] = await Promise.all([
        apiJson<{ requests: CustomPlanRequest[] }>('/api/billing/custom-plan-requests'),
        apiJson<BillingPlan[]>('/api/billing/plans'),
      ]);

      if (requestsRes.ok) {
        const list = Array.isArray(requestsRes.data?.requests) ? requestsRes.data.requests : [];
        setRequests(list);
      } else {
        setMessage({ type: 'error', text: requestsRes.error.message || 'Failed to load custom plan requests' });
      }

      if (plansRes.ok && Array.isArray(plansRes.data)) {
        setPlans(plansRes.data);
      } else {
        setPlans([]);
      }
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Failed to load custom plan requests' });
    } finally {
      setIsLoading(false);
    }
  };

  const openApprove = (r: CustomPlanRequest) => {
    setMessage(null);

    const existingPlanId = `custom_${r.userId}`.toLowerCase();
    const existingPlan = plans.find((p) => (p.id || '').toLowerCase() === existingPlanId) || null;
    const existingLimits = existingPlan?.limits || {};

    setApproveForm({
      priceCents: typeof existingPlan?.priceCents === 'number' ? existingPlan.priceCents : 0,
      currency: existingPlan?.currency || 'usd',
      interval: existingPlan?.interval || 'month',
      limits: {
        social_accounts: typeof existingLimits.social_accounts === 'number' ? (existingLimits.social_accounts as number) : r.requestedSocialAccounts,
        posts_per_month: typeof existingLimits.posts_per_month === 'number' ? (existingLimits.posts_per_month as number) : r.requestedPostsPerMonth,
        storage_gb: typeof (existingLimits as any).storage_gb === 'number' ? ((existingLimits as any).storage_gb as number) : r.requestedStorageGb,
        analytics: typeof existingLimits.analytics === 'string' ? (existingLimits.analytics as string) : 'basic',
      },
      notes: r.notes || '',
    });
    setApproveModal({ open: true, request: r });
  };

  const submitApprove = async () => {
    if (!approveModal.request) return;
    const requestId = approveModal.request.id;

    setMessage(null);
    setIsUpdating((m) => ({ ...m, [requestId]: true }));
    try {
      const res = await apiJson(`/api/billing/custom-plan-requests/${encodeURIComponent(requestId)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priceCents: Number(approveForm.priceCents) || 0,
          currency: approveForm.currency,
          interval: approveForm.interval,
          limits: approveForm.limits,
          notes: approveForm.notes ? String(approveForm.notes) : null,
        }),
      });

      if (!res.ok) {
        setMessage({ type: 'error', text: res.error.message || 'Failed to approve request' });
        return;
      }

      setRequests((prev) => prev.map((r) => (r.id === requestId ? { ...r, status: 'approved' } : r)));
      setApproveModal({ open: false, request: null });
      setMessage({ type: 'success', text: 'Custom plan created and assigned' });
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Failed to approve request' });
    } finally {
      setIsUpdating((m) => ({ ...m, [requestId]: false }));
    }
  };

  useEffect(() => {
    void loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateRequestStatus = async (requestId: string, status: StatusValue) => {
    setMessage(null);
    setIsUpdating((m) => ({ ...m, [requestId]: true }));
    try {
      const res = await apiJson(`/api/billing/custom-plan-requests/${encodeURIComponent(requestId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });

      if (!res.ok) {
        setMessage({ type: 'error', text: res.error.message || 'Failed to update request' });
        return;
      }

      setRequests((prev) => prev.map((r) => (r.id === requestId ? { ...r, status } : r)));
      setMessage({ type: 'success', text: 'Request updated' });
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Failed to update request' });
    } finally {
      setIsUpdating((m) => ({ ...m, [requestId]: false }));
    }
  };

  const statusBadgeClass = (status: string) => {
    const s = (status || '').toLowerCase();
    if (s === 'approved') return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300';
    if (s === 'rejected') return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300';
    if (s === 'reviewing') return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300';
    return 'bg-slate-100 dark:bg-slate-900/30 text-slate-800 dark:text-slate-300';
  };

  return (
    <Layout>
      <div className="w-full max-w-6xl xl:max-w-7xl 2xl:max-w-none mx-auto pt-6">
        <div className="mb-8 animate-fade-in">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-100 mb-2">Custom Plan Requests</h1>
          <p className="text-lg text-slate-600 dark:text-slate-400">Review requests and mark them as approved/rejected</p>
        </div>

        {message && (
          <AlertBanner variant={message.type === 'success' ? 'success' : 'error'} className="mb-6">
            {message.text}
          </AlertBanner>
        )}

        <div className="card animate-slide-up">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Status</label>
              <select
                className="input"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              >
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="reviewing">Reviewing</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>

            <button className="btn btn-secondary" onClick={loadRequests} disabled={isLoading}>
              Refresh
            </button>
          </div>

          {isLoading ? (
            <div className="text-center py-12 text-slate-600 dark:text-slate-400">Loading…</div>
          ) : filteredRequests.length === 0 ? (
            <div className="text-center py-12 text-slate-600 dark:text-slate-400">No requests found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="text-left py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">Created</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">User</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">Social accounts</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">Posts/month</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">Storage (GB)</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">Status</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.map((r) => (
                    <tr key={r.id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-300">{new Date(r.createdAt).toLocaleString()}</td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-300 font-mono text-xs">{r.userId}</td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-300">{r.requestedSocialAccounts}</td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-300">{r.requestedPostsPerMonth}</td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-300">{r.requestedStorageGb}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadgeClass(r.status)}`}>
                          {(r.status || 'pending').toLowerCase()}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="btn btn-secondary"
                            disabled={!!isUpdating[r.id]}
                            onClick={() => updateRequestStatus(r.id, 'reviewing')}
                          >
                            Mark reviewing
                          </button>
                          <button
                            className="btn btn-primary"
                            disabled={!!isUpdating[r.id]}
                            onClick={() => openApprove(r)}
                          >
                            Approve
                          </button>
                          <button
                            className="btn btn-ghost"
                            disabled={!!isUpdating[r.id]}
                            onClick={() => updateRequestStatus(r.id, 'rejected')}
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-6">
            <AlertBanner variant="info">
              This page currently supports review workflow only (status updates). Creating the actual per-user custom plan (e.g. custom_&lt;userId&gt;)
              is the next step.
            </AlertBanner>
          </div>
        </div>
      </div>

      {approveModal.open && approveModal.request && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setApproveModal({ open: false, request: null })}>
          <div className="bg-white dark:bg-slate-900 rounded-lg p-6 max-w-2xl w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-4">Approve Custom Plan</h2>

            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Price (cents)</label>
                  <input
                    type="number"
                    className="input"
                    value={approveForm.priceCents}
                    onChange={(e) => setApproveForm((f) => ({ ...f, priceCents: Number(e.target.value) }))}
                    min={0}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Currency</label>
                  <input
                    type="text"
                    className="input"
                    value={approveForm.currency}
                    onChange={(e) => setApproveForm((f) => ({ ...f, currency: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Interval</label>
                  <select
                    className="input"
                    value={approveForm.interval}
                    onChange={(e) => setApproveForm((f) => ({ ...f, interval: e.target.value }))}
                  >
                    <option value="month">month</option>
                    <option value="year">year</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Social accounts</label>
                  <input
                    type="number"
                    className="input"
                    value={approveForm.limits.social_accounts}
                    onChange={(e) =>
                      setApproveForm((f) => ({
                        ...f,
                        limits: { ...f.limits, social_accounts: Number(e.target.value) },
                      }))
                    }
                    min={0}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Posts/month</label>
                  <input
                    type="number"
                    className="input"
                    value={approveForm.limits.posts_per_month}
                    onChange={(e) =>
                      setApproveForm((f) => ({
                        ...f,
                        limits: { ...f.limits, posts_per_month: Number(e.target.value) },
                      }))
                    }
                    min={0}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Storage (GB)</label>
                  <input
                    type="number"
                    className="input"
                    value={approveForm.limits.storage_gb}
                    onChange={(e) =>
                      setApproveForm((f) => ({
                        ...f,
                        limits: { ...f.limits, storage_gb: Number(e.target.value) },
                      }))
                    }
                    min={0}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Analytics</label>
                  <select
                    className="input"
                    value={approveForm.limits.analytics}
                    onChange={(e) =>
                      setApproveForm((f) => ({
                        ...f,
                        limits: { ...f.limits, analytics: e.target.value },
                      }))
                    }
                  >
                    <option value="basic">basic</option>
                    <option value="advanced">advanced</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Notes</label>
                <textarea
                  className="input"
                  value={approveForm.notes}
                  onChange={(e) => setApproveForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={3}
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  className="btn btn-secondary"
                  onClick={() => setApproveModal({ open: false, request: null })}
                  disabled={!!isUpdating[approveModal.request.id]}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={submitApprove} disabled={!!isUpdating[approveModal.request.id]}>
                  Create & Assign
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};
