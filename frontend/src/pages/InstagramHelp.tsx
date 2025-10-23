import React from 'react';
import { Layout } from '../components/Layout';

export const InstagramHelp: React.FC = () => {
  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="text-center space-y-3">
          <h1 className="gradient-text text-4xl md:text-5xl font-extrabold leading-[1.15] inline-block pb-2">Instagram Integration Help</h1>
          <p className="text-slate-600 dark:text-slate-400 text-lg">
            How to make your Instagram account appear and connect successfully
          </p>
        </header>

        <section className="prose dark:prose-invert max-w-none">
          <h2>Requirements</h2>
          <ul>
            <li>Instagram account must be Professional (Business or Creator).</li>
            <li>The Instagram account must be linked to a Facebook Page you manage.</li>
            <li>You must authorize using the Facebook profile that has Admin (full control) on that Page.</li>
          </ul>

          <h2>Step-by-step</h2>
          <ol>
            <li>Convert your Instagram to a Professional account in the Instagram app: Settings → Account → Switch to Professional.</li>
            <li>Link Instagram to a Facebook Page: on Facebook Page → Settings → Linked Accounts → Connect Instagram (or in Meta Business Suite → Settings → Business Assets → Instagram accounts → Connect).</li>
            <li>Ensure your Facebook profile is an Admin of that Page (Page Settings → Page Access/People, or in Business Settings → Accounts → Pages/Instagram accounts → People → Assign yourself with Full Control).</li>
            <li>Start Connect Instagram again and click <strong>Edit settings</strong> in the Facebook dialog. Select the Page and the linked Instagram account, or choose <strong>Opt in to all current and future Instagram accounts</strong>.</li>
          </ol>

          <h2>Troubleshooting</h2>
          <ul>
            <li>If you don’t see the desired Instagram account: verify it’s Professional and linked to the Page you selected.</li>
            <li>If the app is in Dev Mode: add your Facebook profile as an Admin/Developer/Tester in Facebook Developers for this app.</li>
            <li>Remove and re-authorize the app to reset selections: Facebook → Settings & privacy → Settings → Business Integrations (or Apps and Websites) → remove the app → reconnect and choose <strong>Edit settings</strong>.</li>
          </ul>

          <h2>Why a Page link is required</h2>
          <p>
            The Instagram Graph API only supports Business/Creator accounts linked to a Facebook Page. Personal accounts are not supported.
          </p>
        </section>
      </div>
    </Layout>
  );
};
