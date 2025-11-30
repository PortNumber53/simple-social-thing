import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { useAuth } from '../AuthContext';
import { useIntegrations } from '../IntegrationsContext';

function AuthHookConsumer() {
  useAuth();
  return <div>ok</div>;
}

function IntegrationsHookConsumer() {
  useIntegrations();
  return <div>ok</div>;
}

describe('Context hook guards', () => {
  it('useAuth throws if used outside AuthProvider', () => {
    expect(() => render(<AuthHookConsumer />)).toThrow('useAuth must be used within an AuthProvider');
  });

  it('useIntegrations throws if used outside IntegrationsProvider', () => {
    expect(() => render(<IntegrationsHookConsumer />)).toThrow(
      'useIntegrations must be used within an IntegrationsProvider',
    );
  });
});
