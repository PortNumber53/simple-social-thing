import React, { useState } from 'react';
import { TopNavigation } from '../components/TopNavigation';
import { StatusBar } from '../components/StatusBar';

export const Settings: React.FC = () => {
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [language, setLanguage] = useState('en');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSaveSettings = async () => {
    setIsSaving(true);
    setMessage(null);

    try {
      // TODO: Implement API call to save settings
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API call
      
      setMessage({ type: 'success', text: 'Settings saved successfully!' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to save settings. Please try again.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-slate-950 dark:via-blue-950 dark:to-indigo-950">
      <TopNavigation />
      
      <main className="pt-20 pb-14 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-8 animate-fade-in">
            <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-100 mb-2">
              Settings
            </h1>
            <p className="text-lg text-slate-600 dark:text-slate-400">
              Customize your application preferences
            </p>
          </div>

          {/* Message Banner */}
          {message && (
            <div className={`mb-6 p-4 rounded-lg animate-slide-down ${
              message.type === 'success' 
                ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
                : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
            }`}>
              <div className="flex items-center gap-2">
                {message.type === 'success' ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                <span>{message.text}</span>
              </div>
            </div>
          )}

          <div className="space-y-6">
            {/* Notifications Settings */}
            <div className="card animate-slide-up">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">
                Notifications
              </h2>

              <div className="space-y-4">
                {/* Email Notifications */}
                <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                  <div className="flex-1">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      Email Notifications
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                      Receive email updates about your account activity
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={emailNotifications}
                      onChange={(e) => setEmailNotifications(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-primary-600"></div>
                  </label>
                </div>

                {/* Push Notifications */}
                <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                  <div className="flex-1">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      Push Notifications
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                      Get push notifications for important updates
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pushNotifications}
                      onChange={(e) => setPushNotifications(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-primary-600"></div>
                  </label>
                </div>
              </div>
            </div>

            {/* Appearance Settings */}
            <div className="card animate-slide-up">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">
                Appearance
              </h2>

              <div className="space-y-4">
                {/* Dark Mode */}
                <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                  <div className="flex-1">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      Dark Mode
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                      Switch between light and dark theme
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={darkMode}
                      onChange={(e) => setDarkMode(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-primary-600"></div>
                  </label>
                </div>
              </div>
            </div>

            {/* Language & Region */}
            <div className="card animate-slide-up">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">
                Language & Region
              </h2>

              <div className="space-y-4">
                <div>
                  <label htmlFor="language" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Language
                  </label>
                  <select
                    id="language"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="input"
                  >
                    <option value="en">English</option>
                    <option value="es">Español</option>
                    <option value="fr">Français</option>
                    <option value="de">Deutsch</option>
                    <option value="ja">日本語</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Privacy & Security */}
            <div className="card animate-slide-up">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">
                Privacy & Security
              </h2>

              <div className="space-y-4">
                <button className="w-full p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                        Two-Factor Authentication
                      </h3>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                        Add an extra layer of security to your account
                      </p>
                    </div>
                    <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>

                <button className="w-full p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                        Connected Apps
                      </h3>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                        Manage apps connected to your account
                      </p>
                    </div>
                    <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>

                <button className="w-full p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                        Activity Log
                      </h3>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                        View your recent account activity
                      </p>
                    </div>
                    <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>
              </div>
            </div>

            {/* Save Button */}
            <div className="flex gap-3">
              <button
                onClick={handleSaveSettings}
                disabled={isSaving}
                className="btn btn-primary"
              >
                {isSaving ? 'Saving...' : 'Save Settings'}
              </button>
              <button
                onClick={() => setMessage(null)}
                className="btn btn-ghost"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </main>

      <StatusBar />
    </div>
  );
};
