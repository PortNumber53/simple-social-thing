import React, { type ReactNode } from 'react';
import { TopNavigation } from './TopNavigation';
import { Footer } from './Footer';
import { StatusBar } from './StatusBar';

interface LayoutProps {
  children: ReactNode;
  headerPaddingClass?: string; // e.g., 'pt-24' or 'pt-32 md:pt-36'
}

export const Layout: React.FC<LayoutProps> = ({ children, headerPaddingClass = 'pt-24' }) => {
  return (
    <main className={`min-h-screen flex flex-col px-4 md:px-8 ${headerPaddingClass} pb-16 bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-slate-950 dark:via-blue-950 dark:to-indigo-950`}>
      <TopNavigation />
      <div className="flex-1">
        {children}
      </div>
      <Footer />
      <StatusBar />
    </main>
  );
};
