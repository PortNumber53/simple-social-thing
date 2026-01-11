import React, { useState } from 'react';
import { Layout } from '../components/Layout';
import { AlertBanner } from '../components/AlertBanner';

export const Billing: React.FC = () => {
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
              <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border-2 border-primary-500">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Pro Plan</h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">$29/month</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Renews on</p>
                    <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">Feb 10, 2026</p>
                  </div>
                </div>
              </div>
              <button className="w-full btn btn-ghost">Change Plan</button>
            </div>
          </div>

          {/* Payment Methods Card */}
          <div className="card animate-slide-up">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">Payment Methods</h2>
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-8 bg-gradient-to-r from-blue-600 to-blue-700 rounded flex items-center justify-center">
                      <span className="text-white text-xs font-bold">VISA</span>
                    </div>
                    <div>
                      <p className="font-medium text-slate-900 dark:text-slate-100">Visa ending in 4242</p>
                      <p className="text-sm text-slate-600 dark:text-slate-400">Expires 12/2026</p>
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
                  <tr className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="py-3 px-4 text-slate-700 dark:text-slate-300">Jan 10, 2026</td>
                    <td className="py-3 px-4 text-slate-700 dark:text-slate-300">Pro Plan - Monthly</td>
                    <td className="py-3 px-4 text-slate-700 dark:text-slate-300">$29.00</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300">
                        Paid
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <button className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 text-sm font-medium">
                        Download
                      </button>
                    </td>
                  </tr>
                  <tr className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="py-3 px-4 text-slate-700 dark:text-slate-300">Dec 10, 2025</td>
                    <td className="py-3 px-4 text-slate-700 dark:text-slate-300">Pro Plan - Monthly</td>
                    <td className="py-3 px-4 text-slate-700 dark:text-slate-300">$29.00</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300">
                        Paid
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <button className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 text-sm font-medium">
                        Download
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Billing Settings Card */}
          <div className="card animate-slide-up">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">Billing Settings</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Billing Email</label>
                <input
                  type="email"
                  defaultValue="user@example.com"
                  className="input"
                  placeholder="Enter billing email"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Company Name (Optional)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Enter company name"
                />
              </div>
              <div className="flex gap-3">
                <button className="btn btn-primary">Save Billing Settings</button>
                <button className="btn btn-ghost">Cancel</button>
              </div>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="card border-2 border-red-200 dark:border-red-900/30 animate-slide-up">
            <h2 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-6">Danger Zone</h2>
            <div className="space-y-4">
              <button className="w-full p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-left hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors border border-red-200 dark:border-red-900/50">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-red-600 dark:text-red-400">Cancel Subscription</h3>
                    <p className="text-sm text-red-600/70 dark:text-red-400/70 mt-1">Downgrade to free plan and lose access to premium features</p>
                  </div>
                  <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};
