import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import cloudflareLogo from './assets/Cloudflare_Logo.svg'
import { GoogleLoginButton } from './components/GoogleLoginButton'
import { ProtectedRoute } from './components/ProtectedRoute'
import { useAuth } from './contexts/AuthContext'

function App() {
  const [count, setCount] = useState(0)
  const [name, setName] = useState('unknown')
  const { isAuthenticated, user } = useAuth()

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 md:p-8">
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
        <div className="card card-hover animate-slide-up">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              Authentication
            </h2>
            {isAuthenticated && (
              <span className="badge badge-success">
                ✓ Authenticated
              </span>
            )}
          </div>
          
          <div className="flex justify-center mb-6">
            <GoogleLoginButton />
          </div>

          {isAuthenticated && user && (
            <div className="mt-6 p-5 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl border border-green-200 dark:border-green-800 animate-scale-in">
              <div className="flex items-center gap-4">
                <img
                  src={user.imageUrl || 'https://via.placeholder.com/150'}
                  alt={user.name}
                  className="w-12 h-12 rounded-full ring-2 ring-green-400 shadow-lg"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    console.error('Failed to load avatar image:', user.imageUrl);
                    target.src = 'https://via.placeholder.com/150';
                  }}
                />
                <div className="flex-1">
                  <p className="text-green-900 dark:text-green-100 font-semibold text-lg">
                    Welcome back, {user.name}!
                  </p>
                  <p className="text-green-700 dark:text-green-300 text-sm">
                    {user.email}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Protected Content */}
        <ProtectedRoute
          fallback={
            <div className="card border-amber-200 dark:border-amber-800 bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20 animate-slide-up">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center">
                  <svg className="w-6 h-6 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-amber-900 dark:text-amber-100 mb-1">
                    Authentication Required
                  </h3>
                  <p className="text-amber-800 dark:text-amber-300">
                    Please sign in to access the counter and API features.
                  </p>
                </div>
              </div>
            </div>
          }
        >
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
                  Edit <code className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded text-primary-600 dark:text-primary-400">src/App.tsx</code> to test HMR
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
                  Edit <code className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded text-secondary-600 dark:text-secondary-400">worker/index.ts</code> to change response
                </p>
              </div>
            </div>
          </div>
        </ProtectedRoute>

        {/* Footer */}
        <div className="text-center pt-8">
          <p className='text-slate-500 dark:text-slate-400 text-sm'>
            Click on the logos to learn more about each technology
          </p>
        </div>
      </div>
    </div>
  )
}

export default App
