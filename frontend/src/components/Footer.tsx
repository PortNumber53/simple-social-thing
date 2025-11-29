import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer className="border-t border-slate-200/70 dark:border-slate-800/70 mt-16">
      <div className="w-full max-w-7xl 2xl:max-w-none mx-auto px-4 md:px-8 py-8 flex flex-col md:flex-row items-center justify-between gap-4 text-sm">
        <div className="text-slate-600 dark:text-slate-400">
          © {new Date().getFullYear()} Simple Social Thing
        </div>
        <nav className="flex items-center gap-6">
          <a href="/privacy-policy" className="text-slate-700 dark:text-slate-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">Privacy Policy</a>
          <a href="/terms-of-service" className="text-slate-700 dark:text-slate-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">Terms of Service</a>
          <a href="/user-data-deletion" className="text-slate-700 dark:text-slate-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">User Data Deletion</a>
        </nav>
      </div>
    </footer>
  );
};
