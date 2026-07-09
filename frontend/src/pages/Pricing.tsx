import React from 'react';

export const Pricing: React.FC = () => {
  const tiers = [
    {
      name: 'Free',
      price: '$0',
      cadence: 'per month',
      description: 'Designed for evaluation and very small Instagram publishing workflows.',
      features: [
        '1 post per day',
        'Connect one Instagram Business account',
        'Standard team roles',
        'Community support',
      ],
      cta: 'Get started',
      highlight: false,
    },
    {
      name: 'Standard',
      price: '$100',
      cadence: 'per month',
      description: 'For small businesses that need a reliable Instagram scheduling pipeline.',
      features: [
        '10 posts per day',
        'Instagram scheduling calendar',
        'Drafts and published-content tracking',
        'Priority support',
      ],
      cta: 'Start Standard',
      highlight: true,
    },
    {
      name: 'Pro',
      price: '$500',
      cadence: 'per month',
      description: 'For high-volume agencies and publishers.',
      features: [
        'Meta rate limits',
        'Advanced team roles and permissions',
        'Shared asset library',
        'Premium support',
      ],
      cta: 'Contact sales',
      highlight: false,
    },
  ];

  return (
    <div className="max-w-7xl 2xl:max-w-screen-2xl mx-auto space-y-10">
        <header className="text-center space-y-3">
          <h1 className="gradient-text text-4xl md:text-5xl font-extrabold leading-[1.15] inline-block pb-2">Pricing</h1>
          <p className="text-slate-600 dark:text-slate-400 text-lg">
            Usage-based tiers for Instagram Business Account scheduling.
          </p>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`card p-6 flex flex-col ${t.highlight ? 'ring-2 ring-primary-500' : ''}`}
            >
              <div className="mb-4">
                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{t.name}</h2>
                <p className="mt-1 text-slate-600 dark:text-slate-400">{t.description}</p>
              </div>
              <div className="my-4">
                <span className="text-4xl font-extrabold text-slate-900 dark:text-slate-100">{t.price}</span>
                <span className="ml-2 text-slate-600 dark:text-slate-400">{t.cadence}</span>
              </div>
              <ul className="mt-2 space-y-2 text-sm text-slate-700 dark:text-slate-200">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <svg className="w-4 h-4 text-primary-600 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.414 0l-3-3a1 1 0 111.414-1.414l2.293 2.293 6.543-6.543a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-6">
                <a
                  href={t.name === 'Pro' ? '/contact' : '/'}
                  className={`btn ${t.highlight ? 'btn-primary' : 'btn-secondary'} w-full`}
                >
                  {t.cta}
                </a>
              </div>
            </div>
          ))}
        </section>
    </div>
  );
}
