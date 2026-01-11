import React from 'react';
import { Layout } from '../components/Layout';
import { AlertBanner } from '../components/AlertBanner';

export const AdminAnalytics: React.FC = () => {
  return (
    <Layout>
      <div className="w-full max-w-6xl xl:max-w-7xl 2xl:max-w-none mx-auto pt-6">
        <div className="mb-8 animate-fade-in">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-100 mb-2">System Analytics</h1>
          <p className="text-lg text-slate-600 dark:text-slate-400">Monitor system performance and usage metrics</p>
        </div>

        <AlertBanner variant="info" className="mb-6">
          Analytics dashboard coming soon. This page will display system metrics, usage statistics, and performance data.
        </AlertBanner>

        <div className="card animate-slide-up">
          <div className="text-center py-12">
            <svg className="w-16 h-16 text-slate-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">Analytics Dashboard</h3>
            <p className="text-slate-600 dark:text-slate-400 mb-6">
              This feature is under development. You'll see system metrics, user activity, and performance data here.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
};
