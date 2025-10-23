import React from 'react';
import { Layout } from '../components/Layout';

export const PrivacyPolicy: React.FC = () => {
  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="text-center space-y-3">
          <h1 className="gradient-text text-4xl md:text-5xl font-extrabold leading-[1.15] inline-block pb-2">Privacy Policy</h1>
          <p className="text-slate-600 dark:text-slate-400 text-lg">
            Your privacy matters. This page explains what we collect and how we use it.
          </p>
        </header>

        <section className="prose dark:prose-invert max-w-none">
          <h2>Information We Collect</h2>
          <p>We collect account information you provide (such as name and email) and data necessary to deliver features (such as connected social account metadata).</p>
          <h2>How We Use Information</h2>
          <p>We use your information to operate the service, improve features, and provide support. We do not sell your data.</p>
          <h2>Data Retention</h2>
          <p>We retain data for as long as your account is active or as needed to provide the service.</p>
          <h2>Security</h2>
          <p>We use industry-standard measures to protect your data. No method of transmission or storage is 100% secure.</p>
          <h2>Contact</h2>
          <p>Questions? Reach us on the <a href="/contact">Contact</a> page.</p>
        </section>
      </div>
    </Layout>
  );
}
