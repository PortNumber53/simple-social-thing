import React, { useState } from 'react';
import { TopNavigation } from '../components/TopNavigation';

export const Contact: React.FC = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Placeholder submission. Hook up to your API endpoint later.
    setStatus('Thanks! We will get back to you soon.');
    setName('');
    setEmail('');
    setMessage('');
  };

  return (
    <main className="min-h-screen px-4 md:px-8 pt-24 pb-16 bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-slate-950 dark:via-blue-950 dark:to-indigo-950">
      <TopNavigation />
      <div className="max-w-3xl mx-auto space-y-8">
        <header className="text-center space-y-3">
          <h1 className="text-4xl md:text-5xl font-extrabold gradient-text">Contact</h1>
          <p className="text-slate-600 dark:text-slate-400 text-lg">
            Tell us about your social presence goals. Well reach out shortly.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="card p-6 space-y-4">
          {status && (
            <div className="p-3 rounded-md bg-green-50 text-green-800 text-sm">{status}</div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Jane Doe"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="jane@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              rows={6}
              className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Tell us about your needs (e.g., post scheduling, analytics, multi-account management)..."
            />
          </div>
          <div className="flex justify-end">
            <button type="submit" className="btn">
              Send message
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
