/**
 * Flow E2E Test Helpers
 * Shared utilities for all Playwright test files.
 */

// ── Credentials ───────────────────────────────────────────────────────────────

export const CREDS = {
  superAdmin: {
    email: process.env.SUPER_ADMIN_EMAIL || 'superadmin@hireiq.com',
    password: process.env.SUPER_ADMIN_PASSWORD || 'superadmin123',
    companyCode: '',
  },
  admin: {
    email: 'admin@hireiq.com',
    password: 'admin123',
    companyCode: 'hireiq',
  },
  employee: {
    email: 'alice@hireiq.com',
    password: 'candidate123',
    companyCode: 'hireiq',
  },
  client: {
    email: 'client@hireiq.com',
    password: 'client123',
    companyCode: 'hireiq',
  },
};

// ── Login helper ──────────────────────────────────────────────────────────────

/**
 * Login via the UI.
 * @param {import('@playwright/test').Page} page
 * @param {'superAdmin'|'admin'|'employee'|'client'} role
 */
export async function loginAs(page, role) {
  const creds = CREDS[role];
  await page.goto('/login');
  await page.waitForLoadState('networkidle');

  if (creds.companyCode) {
    await page.fill('#companyCode', creds.companyCode);
  }
  await page.fill('#email', creds.email);
  await page.fill('#password', creds.password);
  await page.click('button[type="submit"]');

  // Wait for redirect away from /login
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15_000 });
}

/**
 * Login via API (fast, bypasses UI — use when the UI itself isn't under test).
 * @param {import('@playwright/test').Page} page
 * @param {'superAdmin'|'admin'|'employee'|'client'} role
 */
export async function loginViaAPI(page, role) {
  const creds = CREDS[role];
  const payload = { email: creds.email, password: creds.password };
  if (creds.companyCode) payload.companySlug = creds.companyCode;

  const res = await page.request.post('/api/auth/login', { data: payload });
  if (!res.ok()) throw new Error(`API login failed: ${res.status()} ${await res.text()}`);

  // Cookie is set by the server (httpOnly); Playwright carries it automatically
}

// ── Assertions ────────────────────────────────────────────────────────────────

/**
 * Assert a toast / success banner is visible.
 * @param {import('@playwright/test').Page} page
 * @param {string} [textContains]
 */
export async function expectSuccess(page, textContains) {
  const selectors = [
    '[role="alert"]:has-text("success")',
    '.alert-success',
    '[data-testid="toast-success"]',
    'text=saved',
    'text=created',
    'text=updated',
  ];
  if (textContains) {
    await page.waitForSelector(`text=${textContains}`, { timeout: 5_000 });
  } else {
    await page.waitForSelector(selectors.join(', '), { timeout: 5_000 });
  }
}

/**
 * Assert an error message is visible.
 */
export async function expectError(page, textContains) {
  await page.waitForSelector(`text=${textContains}`, { timeout: 5_000 });
}

// ── Viewport helpers ──────────────────────────────────────────────────────────

export const VIEWPORTS = {
  mobile:  { width: 390,  height: 844  },   // iPhone 14
  tablet:  { width: 1024, height: 1366 },   // iPad Pro
  desktop: { width: 1440, height: 900  },
};

export async function setMobileViewport(page) {
  await page.setViewportSize(VIEWPORTS.mobile);
}
