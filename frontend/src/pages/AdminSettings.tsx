import React from 'react';
import { Layout } from '../components/Layout';
import { AlertBanner } from '../components/AlertBanner';

export const AdminSettings: React.FC = () => {
  return (
    <Layout>
      <div className="w-full max-w-6xl xl:max-w-7xl 2xl:max-w-none mx-auto pt-6">
        <div className="mb-8 animate-fade-in">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-100 mb-2">System Settings</h1>
          <p className="text-lg text-slate-600 dark:text-slate-400">Configure system-wide settings and preferences</p>
        </div>

        <AlertBanner variant="info" className="mb-6">
          System settings panel coming soon. This page will allow you to configure global application settings.
        </AlertBanner>

        <div className="card animate-slide-up">
          <div className="text-center py-12">
            <svg className="w-16 h-16 text-slate-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">System Settings</h3>
            <p className="text-slate-600 dark:text-slate-400 mb-6">
              This feature is under development. You'll be able to configure system-wide settings and preferences here.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
};
