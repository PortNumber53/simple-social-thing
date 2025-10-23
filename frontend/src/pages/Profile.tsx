import React, { useState } from 'react';
import { Layout } from '../components/Layout';
import { StatusBar } from '../components/StatusBar';
import { useAuth } from '../contexts/AuthContext';

export const Profile: React.FC = () => {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState(user?.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSaveDisplayName = async () => {
    setIsSaving(true);
    setMessage(null);

    try {
      // TODO: Implement API call to update display name
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API call
      
      setMessage({ type: 'success', text: 'Display name updated successfully!' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to update display name. Please try again.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'New passwords do not match.' });
      return;
    }

    if (newPassword.length < 8) {
      setMessage({ type: 'error', text: 'Password must be at least 8 characters long.' });
      return;
    }

    setIsSaving(true);

    try {
      // TODO: Implement API call to change password
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API call
      
      setMessage({ type: 'success', text: 'Password changed successfully!' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to change password. Please try again.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Layout>
        <div className="max-w-4xl mx-auto pt-6">
          {/* Header */}
          <div className="mb-8 animate-fade-in">
            <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-100 mb-2">
              Profile Settings
            </h1>
            <p className="text-lg text-slate-600 dark:text-slate-400">
              Manage your account information and preferences
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
            {/* Profile Information Card */}
            <div className="card animate-slide-up">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">
                Profile Information
              </h2>

              <div className="space-y-6">
                {/* Avatar */}
                <div className="flex items-center gap-6">
                  <img
                    src={user?.imageUrl || 'https://via.placeholder.com/150'}
                    alt={user?.name || 'User'}
                    className="w-24 h-24 rounded-full ring-4 ring-primary-400 shadow-lg"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.src = 'https://via.placeholder.com/150';
                    }}
                  />
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                      Profile Picture
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Synced from your Google account
                    </p>
                  </div>
                </div>

                {/* Display Name */}
                <div>
                  <label htmlFor="displayName" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Display Name
                  </label>
                  <div className="flex gap-3">
                    <input
                      type="text"
                      id="displayName"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="input flex-1"
                      placeholder="Enter your display name"
                    />
                    <button
                      onClick={handleSaveDisplayName}
                      disabled={isSaving || displayName === user?.name}
                      className="btn btn-primary"
                    >
                      {isSaving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    This is the name that will be displayed across the application
                  </p>
                </div>

                {/* Google Account Name (Read-only) */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Google Account Name
                  </label>
                  <input
                    type="text"
                    value={user?.name || ''}
                    disabled
                    className="input bg-slate-100 dark:bg-slate-800 cursor-not-allowed opacity-75"
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    This name is managed by your Google account
                  </p>
                </div>

                {/* Email (Read-only) */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={user?.email || ''}
                    disabled
                    className="input bg-slate-100 dark:bg-slate-800 cursor-not-allowed opacity-75"
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Your email is managed by your Google account
                  </p>
                </div>
              </div>
            </div>

            {/* Password Management Card */}
            <div className="card animate-slide-up">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">
                Password Management
              </h2>

              <form onSubmit={handleChangePassword} className="space-y-6">
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <p className="text-sm text-blue-900 dark:text-blue-100 font-medium">
                        Set a password for direct login
                      </p>
                      <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                        You can use this password to log in directly without Google OAuth
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <label htmlFor="currentPassword" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Current Password (if set)
                  </label>
                  <input
                    type="password"
                    id="currentPassword"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="input"
                    placeholder="Enter current password"
                  />
                </div>

                <div>
                  <label htmlFor="newPassword" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    New Password
                  </label>
                  <input
                    type="password"
                    id="newPassword"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="input"
                    placeholder="Enter new password"
                    required
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Must be at least 8 characters long
                  </p>
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    id="confirmPassword"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="input"
                    placeholder="Confirm new password"
                    required
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={isSaving || !newPassword || !confirmPassword}
                    className="btn btn-primary"
                  >
                    {isSaving ? 'Changing Password...' : 'Change Password'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentPassword('');
                      setNewPassword('');
                      setConfirmPassword('');
                      setMessage(null);
                    }}
                    className="btn btn-ghost"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      <StatusBar />
    </Layout>
  );
};
