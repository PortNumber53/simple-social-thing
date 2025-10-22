import React from 'react';
import { TopNavigation } from '../components/TopNavigation';

export const Features: React.FC = () => {
  return (
    <main className="min-h-screen px-4 md:px-8 pt-24 pb-16 bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-slate-950 dark:via-blue-950 dark:to-indigo-950">
      <TopNavigation />
      <div className="max-w-5xl mx-auto space-y-8">
        <header className="text-center space-y-3">
          <h1 className="text-4xl md:text-5xl font-extrabold gradient-text">Features</h1>
          <p className="text-slate-600 dark:text-slate-400 text-lg">
            Tools to help you manage and grow your social network presence
          </p>
        </header>

        <section className="grid md:grid-cols-2 gap-6">
          <div className="card card-hover p-6">
            <h2 className="text-xl font-bold mb-2">Unified Inbox</h2>
            <p className="text-slate-600 dark:text-slate-400">
              Read and respond to messages and mentions across platforms from a single place.
            </p>
          </div>
          <div className="card card-hover p-6">
            <h2 className="text-xl font-bold mb-2">Scheduling</h2>
            <p className="text-slate-600 dark:text-slate-400">
              Plan and queue posts with optimal timing recommendations.
            </p>
          </div>
          <div className="card card-hover p-6">
            <h2 className="text-xl font-bold mb-2">Analytics</h2>
            <p className="text-slate-600 dark:text-slate-400">
              Track growth, engagement, and content performance with clear dashboards.
            </p>
          </div>
          <div className="card card-hover p-6">
            <h2 className="text-xl font-bold mb-2">Collaboration</h2>
            <p className="text-slate-600 dark:text-slate-400">
              Invite teammates, assign tasks, and manage approvals for brand safety.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
};
