import React from 'react';
import { Layout } from '../components/Layout';
import { AlertBanner } from '../components/AlertBanner';

export const AdminUsers: React.FC = () => {
  return (
    <Layout>
      <div className="w-full max-w-6xl xl:max-w-7xl 2xl:max-w-none mx-auto pt-6">
        <div className="mb-8 animate-fade-in">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-100 mb-2">User Management</h1>
          <p className="text-lg text-slate-600 dark:text-slate-400">Manage user accounts and permissions</p>
        </div>

        <AlertBanner variant="info" className="mb-6">
          User management functionality coming soon. This page will allow you to view, edit, and manage user accounts.
        </AlertBanner>

        <div className="card animate-slide-up">
          <div className="text-center py-12">
            <svg className="w-16 h-16 text-slate-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">User Management</h3>
            <p className="text-slate-600 dark:text-slate-400 mb-6">
              This feature is under development. You'll be able to manage users, roles, and permissions here.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
};
