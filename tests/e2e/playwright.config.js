// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

// ── Paths ─────────────────────────────────────────────────────────────────────
// __dirname = <project-root>/tests/e2e
// projectRoot = <project-root>
const projectRoot = path.resolve(__dirname, '../..');
const reportsDir  = path.resolve(__dirname, '../reports/playwright');

/**
 * Base URL for tests.
 *   - Local dev: http://localhost:5173  (Vite)
 *   - CI:        override with BASE_URL env var
 */
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';

module.exports = defineConfig({
  // ── Test discovery ──────────────────────────────────────────────────────────
  // Config lives in tests/e2e/ → '.' finds all *.spec.js files here
  testDir: '.',
  testMatch: '**/*.spec.js',

  // ── Execution ───────────────────────────────────────────────────────────────
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,

  // ── Reporters ───────────────────────────────────────────────────────────────
  reporter: [
    ['list'],
    ['html', { outputFolder: reportsDir, open: 'never' }],
    ...(process.env.CI ? [['github']] : []),
  ],

  // ── Shared browser options ───────────────────────────────────────────────────
  use: {
    baseURL: BASE_URL,
    trace:      'on-first-retry',
    screenshot: 'only-on-failure',
    video:      'retain-on-failure',
    actionTimeout:     10_000,
    navigationTimeout: 30_000,
  },

  // ── Browser projects ─────────────────────────────────────────────────────────
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'tablet',
      use: { ...devices['iPad Pro 11'] },
    },
  ],

  // ── Web server ────────────────────────────────────────────────────────────────
  // Starts Vite dev server (frontend) automatically when tests run locally.
  // The backend must already be running (needs a live PostgreSQL connection).
  //
  // To skip auto-start (if you started servers manually):
  //   SKIP_WEBSERVER=true npm run test:e2e
  //
  // CI: set BASE_URL to a pre-deployed URL and don't start a webserver.
  webServer: (process.env.CI || process.env.SKIP_WEBSERVER) ? undefined : {
    // Run `npm run start:frontend` from the project root.
    // Root package.json: "start:frontend": "npm --prefix frontend run dev"
    command: 'npm run start:frontend',
    cwd: projectRoot,           // ← anchored to project root, not tests/ dir
    url: BASE_URL,
    reuseExistingServer: true,  // don't restart if Vite is already running
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },

  // Artifacts go next to the config for easy cleanup
  outputDir: path.resolve(__dirname, '../test-results'),
});
