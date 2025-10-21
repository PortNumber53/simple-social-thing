import React from 'react';
import { useNavigate } from 'react-router-dom';
import reactLogo from '../assets/react.svg';
import viteLogo from '/vite.svg';
import cloudflareLogo from '../assets/Cloudflare_Logo.svg';
import { GoogleLoginButton } from '../components/GoogleLoginButton';
import { useAuth } from '../contexts/AuthContext';

export const Home: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // Redirect to dashboard if already authenticated
  React.useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 md:p-8 bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-slate-950 dark:via-blue-950 dark:to-indigo-950">
      <div className="w-full max-w-5xl mx-auto space-y-8 animate-fade-in">
        
        {/* Hero Section */}
        <div className="text-center space-y-6 mb-12">
          <div className="flex items-center justify-center gap-6 mb-8">
            <a 
              href='https://vite.dev' 
              target='_blank'
              className="group transition-transform hover:scale-110 duration-300"
            >
              <img 
                src={viteLogo} 
                className='h-20 md:h-24 drop-shadow-lg group-hover:drop-shadow-2xl transition-all' 
                alt='Vite logo' 
              />
            </a>
            <a 
              href='https://react.dev' 
              target='_blank'
              className="group transition-transform hover:scale-110 duration-300"
            >
              <img 
                src={reactLogo} 
                className='h-20 md:h-24 drop-shadow-lg group-hover:drop-shadow-2xl transition-all animate-[spin_20s_linear_infinite]' 
                alt='React logo' 
              />
            </a>
            <a 
              href='https://workers.cloudflare.com/' 
              target='_blank'
              className="group transition-transform hover:scale-110 duration-300"
            >
              <img 
                src={cloudflareLogo} 
                className='h-20 md:h-24 drop-shadow-lg group-hover:drop-shadow-2xl transition-all' 
                alt='Cloudflare logo' 
              />
            </a>
          </div>
          
          <h1 className="gradient-text font-bold text-5xl md:text-6xl lg:text-7xl tracking-tight">
            Modern Web Stack
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-lg md:text-xl max-w-2xl mx-auto">
            Built with Vite, React, and Cloudflare Workers for blazing-fast performance
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
            
            <div className="flex justify-center pt-4">
              <GoogleLoginButton />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center pt-8">
          <p className='text-slate-500 dark:text-slate-400 text-sm'>
            Click on the logos to learn more about each technology
          </p>
        </div>
      </div>
    </div>
  );
};
