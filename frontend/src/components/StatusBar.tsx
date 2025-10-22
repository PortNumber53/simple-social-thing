import React, { useState, useEffect } from 'react';

export const StatusBar: React.FC = () => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      clearInterval(timer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-800 dark:bg-slate-950 text-slate-100 border-t border-slate-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-10 text-xs">
          {/* Left side - Status */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-400' : 'bg-red-400'} animate-pulse`} />
              <span>{isOnline ? 'Online' : 'Offline'}</span>
            </div>
            <span className="text-slate-400">|</span>
            <span className="text-slate-400">Ready</span>
          </div>

          {/* Center - Additional info */}
          <div className="hidden md:flex items-center gap-4">
            <span className="text-slate-400">Simple Social Thing</span>
          </div>

          {/* Right side - Time */}
          <div className="flex items-center gap-4">
            <span className="text-slate-400">
              {currentTime.toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit'
              })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
