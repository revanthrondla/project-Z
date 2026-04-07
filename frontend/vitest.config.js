import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.js'],
    // Include only test files under src/tests
    include: ['src/tests/**/*.test.{js,jsx}'],
    // Show per-test output
    reporter: 'verbose',
    coverage: {
      provider: 'v8',
      include: ['src/contexts/**', 'src/pages/**', 'src/components/**'],
      reporter: ['text', 'lcov'],
    },
  },
});
