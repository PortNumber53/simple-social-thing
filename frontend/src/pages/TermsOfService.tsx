import React from 'react';
import { Layout } from '../components/Layout';

export const TermsOfService: React.FC = () => {
  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="text-center space-y-3">
          <h1 className="gradient-text text-4xl md:text-5xl font-extrabold leading-[1.15] inline-block pb-2">Terms of Service</h1>
          <p className="text-slate-600 dark:text-slate-400 text-lg">
            Please review these terms before using Simple Social Thing.
          </p>
        </header>

        <section className="prose dark:prose-invert max-w-none">
          <h2>Using the Service</h2>
          <p>You must comply with applicable laws and respect third-party platform policies. We may update the service and these terms over time.</p>
          <h2>Accounts</h2>
          <p>You are responsible for maintaining the security of your account and credentials.</p>
          <h2>Billing</h2>
          <p>Subscriptions renew automatically unless canceled. Fees are non-refundable except where required by law.</p>
          <h2>Acceptable Use</h2>
          <p>No abuse, spam, or attempts to disrupt the service or other users.</p>
          <h2>Limitation of Liability</h2>
          <p>The service is provided "as is" without warranties. To the fullest extent permitted by law, we are not liable for indirect or consequential damages.</p>
          <h2>Contact</h2>
          <p>Questions? See the <a href="/contact">Contact</a> page.</p>
        </section>
      </div>
    </Layout>
  );
}
