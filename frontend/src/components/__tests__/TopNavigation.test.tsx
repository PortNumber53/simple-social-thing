import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TopNavigation } from '../TopNavigation';

function renderNav() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <TopNavigation />
    </MemoryRouter>,
  );
}

describe('TopNavigation', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('shows public nav links', () => {
    renderNav();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Features')).toBeInTheDocument();
    expect(screen.getByText('Contact')).toBeInTheDocument();
    expect(screen.getByText('Pricing')).toBeInTheDocument();
  });

  it('toggles mobile menu', async () => {
    const u = userEvent.setup();
    renderNav();

    const button = screen.getByRole('button', { name: /toggle menu/i });
    await u.click(button);
    // Mobile menu should show links
    const homeLinks = screen.getAllByText('Home');
    expect(homeLinks.length).toBeGreaterThan(1); // desktop + mobile
  });
});
