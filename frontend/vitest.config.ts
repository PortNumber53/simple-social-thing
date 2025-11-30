import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    environmentOptions: {
      url: 'http://localhost/',
    },
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'dist/**',
        'node_modules/**',
        'worker/**',
        '**/*.config.*',
        '**/*.d.ts',
        'src/test/**',
        'src/**/__tests__/**',
        'src/main.tsx',
      ],
      thresholds: {
        lines: 80,
        statements: 80,
      },
    },
  },
});
