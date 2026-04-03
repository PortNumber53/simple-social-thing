import React from 'react';
import { Outlet } from 'react-router-dom';
import { TopNavigation } from './TopNavigation';
import { Footer } from './Footer';

export const PublicLayout: React.FC = () => {
  return (
    <main className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-slate-950 dark:via-blue-950 dark:to-indigo-950">
      <TopNavigation />
      <div className="flex-1 pt-24 px-4 md:px-8 pb-16">
        <Outlet />
      </div>
      <Footer />
    </main>
  );
};
