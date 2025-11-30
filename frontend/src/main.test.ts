import { describe, expect, it, vi, beforeEach } from 'vitest';

describe('main', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="root"></div>';
  });

  it('mounts the React app into #root', async () => {
    const render = vi.fn();
    vi.doMock('react-dom/client', () => ({
      createRoot: vi.fn(() => ({ render })),
    }));

    await import('./main');

    expect(render).toHaveBeenCalledTimes(1);
  });
});
