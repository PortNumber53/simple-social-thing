import React from 'react';
import { Layout } from '../components/Layout';

export const UserDataDeletion: React.FC = () => {
  return (
    <Layout>
        <div className="max-w-4xl mx-auto space-y-8">
          <header className="text-center space-y-3">
            <h1 className="gradient-text text-4xl md:text-5xl font-extrabold leading-[1.15] inline-block pb-2">User Data Deletion</h1>
            <p className="text-slate-600 dark:text-slate-400 text-lg">
              How to request deletion of your data from Simple Social Thing.
            </p>
          </header>

          <section className="prose dark:prose-invert max-w-none">
            <h2>Requesting Deletion</h2>
            <p>
              If you would like to delete your account and associated data, please send a request using the
              <a href="/contact"> Contact</a> page or email our support team with the email address tied to your account.
              For verification, we may ask you to confirm ownership of the account.
            </p>
            <h2>What Will Be Deleted</h2>
            <ul>
              <li>Your account profile and authentication identifiers.</li>
              <li>Connected social account metadata and tokens.</li>
              <li>Content, analytics, and activity records stored by our service.</li>
            </ul>
            <p>
              Certain records may be retained as required by law or for fraud prevention and security, after which they are permanently deleted.
            </p>
          </section>
        </div>
    </Layout>
  );
}
