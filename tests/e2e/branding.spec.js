/**
 * BRANDING — Validate Flow rebranding is complete across all pages/roles.
 * These tests verify that no legacy "aGrow" or "HireIQ" text appears
 * in any user-visible surface after the rebrand.
 */
import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers.js';

const LEGACY_TERMS = ['aGrow', 'HireIQ', 'Agricultural Scanning Platform'];

async function assertNoBrandingRemnants(page, route) {
  await page.goto(route);
  await page.waitForLoadState('networkidle');
  const text = await page.locator('body').textContent();
  for (const term of LEGACY_TERMS) {
    expect(text, `Found legacy term "${term}" on ${route}`).not.toContain(term);
  }
}

test.describe('Branding: Flow colour — Emerald Green', () => {
  test('Login page has emerald theme', async ({ page }) => {
    await page.goto('/login');
    // Left panel has emerald gradient
    const panel = page.locator('.bg-gradient-to-br').first();
    const classAttr = await panel.getAttribute('class');
    expect(classAttr).toContain('emerald');
  });

  test('Page title is "Flow"', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle('Flow');
  });

  test('Favicon uses emerald colour (#10b981)', async ({ page }) => {
    await page.goto('/login');
    const favicon = await page.$eval('link[rel="icon"]', el => el.href);
    expect(favicon).toContain('10b981');
  });
});

test.describe('Branding: No legacy text — Admin', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page, 'admin');
  });

  const adminRoutes = [
    '/dashboard',
    '/employees',
    '/timesheets',
    '/invoices',
    '/absences',
    '/clients',
    '/reports',
    '/settings',
    '/email-payments',
  ];

  for (const route of adminRoutes) {
    test(`No legacy branding on ${route}`, async ({ page }) => {
      await assertNoBrandingRemnants(page, route);
    });
  }
});

test.describe('Branding: No legacy text — Employee', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page, 'employee');
  });

  const employeeRoutes = ['/dashboard', '/log-hours', '/my-invoices', '/my-absences', '/support'];

  for (const route of employeeRoutes) {
    test(`No legacy branding on ${route}`, async ({ page }) => {
      await assertNoBrandingRemnants(page, route);
    });
  }
});

test.describe('Branding: No legacy text — Super Admin', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page, 'superAdmin');
  });

  const superAdminRoutes = [
    '/super-admin/dashboard',
    '/super-admin/tenants',
    '/super-admin/support',
    '/super-admin/ai-config',
  ];

  for (const route of superAdminRoutes) {
    test(`No legacy branding on ${route}`, async ({ page }) => {
      await assertNoBrandingRemnants(page, route);
    });
  }
});

test.describe('Branding: FlowLogo visible across app', () => {
  test('FlowLogo present on login page', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('[aria-label="Flow"]')).toBeVisible();
  });

  test('FlowLogo present in admin sidebar', async ({ page }) => {
    await loginViaAPI(page, 'admin');
    await page.goto('/dashboard');
    await expect(page.locator('[aria-label="Flow"]')).toBeVisible();
  });

  test('FlowLogo present in super-admin sidebar', async ({ page }) => {
    await loginViaAPI(page, 'superAdmin');
    await page.goto('/super-admin/dashboard');
    await expect(page.locator('[aria-label="Flow"]')).toBeVisible();
  });
});
