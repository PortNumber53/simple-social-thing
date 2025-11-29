import React from 'react';
import { GoogleLoginButton } from '../components/GoogleLoginButton';
import { Layout } from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';

export const Home: React.FC = () => {
  const { isAuthenticated } = useAuth();
  return (
    <Layout headerPaddingClass="pt-32 md:pt-36">
      <div className="w-full max-w-7xl 2xl:max-w-screen-2xl mx-auto space-y-8 animate-fade-in">

        {/* Hero Section */}
        <div className="text-center space-y-6 mb-12">

          <h1 className="gradient-text font-bold text-5xl md:text-6xl lg:text-7xl tracking-tight leading-[1.15] inline-block pb-2">
            Simple Social Thing
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-lg md:text-xl max-w-2xl mx-auto">
            Plan posts, track engagement, and manage all your social accounts in one place—so you can focus on growing your audience.
          </p>
        </div>

        {/* Authentication Card */}
        <div className="card card-hover animate-slide-up max-w-md mx-auto">
          <div className="text-center space-y-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 shadow-lg shadow-primary-500/30 mb-4">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>

            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              Get Started
            </h2>
            <p className="text-slate-600 dark:text-slate-400">
              Sign in with your Google account to access the dashboard
            </p>

            {!isAuthenticated && (
              <div className="flex justify-center pt-4">
                <GoogleLoginButton />
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};
