import React, { useState } from 'react';
import { TopNavigation } from '../components/TopNavigation';
import { StatusBar } from '../components/StatusBar';
import { useAuth } from '../contexts/AuthContext';

export const Dashboard: React.FC = () => {
  const [count, setCount] = useState(0);
  const [name, setName] = useState('unknown');
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-slate-950 dark:via-blue-950 dark:to-indigo-950">
      <TopNavigation />
      
      {/* Main Content - with padding for fixed nav and status bar */}
      <main className="pt-20 pb-14 px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-7xl 2xl:max-w-none mx-auto">
          {/* Welcome Section */}
          <div className="mb-8 animate-fade-in">
            <h1 className="text-4xl md:text-5xl font-bold text-slate-900 dark:text-slate-100 mb-2">
              Welcome back, {user?.name?.split(' ')[0] || 'User'}! 👋
            </h1>
            <p className="text-lg text-slate-600 dark:text-slate-400">
              Here's what's happening with your projects today.
            </p>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 animate-slide-up">
            <div className="card card-hover">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Total Projects</p>
                  <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">12</p>
                </div>
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
                  <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="card card-hover">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Active Tasks</p>
                  <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">28</p>
                </div>
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center shadow-lg shadow-green-500/30">
                  <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="card card-hover">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Completed</p>
                  <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">156</p>
                </div>
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/30">
                  <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* Interactive Demo Section */}
          <div className="grid md:grid-cols-2 gap-6 animate-slide-up">
            {/* Counter Card */}
            <div className='card card-hover'>
              <div className="text-center space-y-6">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 shadow-lg shadow-primary-500/30">
                  <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
                  </svg>
                </div>
                
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">
                    Interactive Counter
                  </h3>
                  <button
                    onClick={() => setCount((count) => count + 1)}
                    className="btn btn-primary text-lg px-8 py-3"
                    aria-label='increment'
                  >
                    Count: {count}
                  </button>
                </div>
                
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Click to increment the counter
                </p>
              </div>
            </div>

            {/* API Card */}
            <div className='card card-hover'>
              <div className="text-center space-y-6">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-secondary-500 to-secondary-600 shadow-lg shadow-secondary-500/30">
                  <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">
                    API Integration
                  </h3>
                  <button
                    onClick={() => {
                      fetch('/api/')
                        .then((res) => res.json() as Promise<{ name: string }>)
                        .then((data) => setName(data.name))
                    }}
                    className="btn btn-secondary text-lg px-8 py-3"
                    aria-label='get name'
                  >
                    Name: {name}
                  </button>
                </div>
                
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Fetch data from Cloudflare Worker
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      <StatusBar />
    </div>
  );
};
