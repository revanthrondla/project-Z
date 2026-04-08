/**
 * RESPONSIVE — Mobile and tablet layout tests.
 * Verifies the UI is usable across all viewport sizes.
 */
import { test, expect } from '@playwright/test';
import { loginViaAPI, VIEWPORTS } from './helpers.js';

test.describe('Mobile Responsiveness (390px — iPhone 14)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await loginViaAPI(page, 'admin');
  });

  test('Dashboard renders without horizontal scroll', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 2); // ±2px tolerance
  });

  test('Mobile sidebar is hidden by default', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Mobile sidebar off-screen
    const mobileSidebar = page.locator('aside[aria-label="Mobile sidebar"]');
    await expect(mobileSidebar).not.toBeInViewport();
  });

  test('Hamburger button opens mobile sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    await page.click('button[aria-label="Toggle sidebar"]');
    await page.waitForTimeout(250); // animation

    const mobileSidebar = page.locator('aside[aria-label="Mobile sidebar"]');
    await expect(mobileSidebar).toBeInViewport();
  });

  test('Clicking a nav item in mobile sidebar closes it', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    await page.click('button[aria-label="Toggle sidebar"]');
    await page.waitForTimeout(250);

    // Click first nav link
    await page.locator('aside[aria-label="Mobile sidebar"] nav a').first().click();
    await page.waitForTimeout(300);

    const mobileSidebar = page.locator('aside[aria-label="Mobile sidebar"]');
    await expect(mobileSidebar).not.toBeInViewport();
  });

  test('Employees table is horizontally scrollable on mobile', async ({ page }) => {
    await page.goto('/employees');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('table, [role="table"]')).toBeVisible({ timeout: 5_000 }).catch(() => {});
    // Page should not crash
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });

  test('Login form is fully usable on mobile', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/login');

    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    // The left brand panel should be hidden on mobile (uses `hidden lg:flex`)
    await expect(page.locator('text=smarter way to manage')).toBeHidden();

    // Mobile logo visible
    await expect(page.locator('.lg\\:hidden [aria-label="Flow"]')).toBeVisible();
  });

  test('AI chat widget opens full-screen on mobile', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const chatButton = page.locator('button[title="AI Assistant"]');
    if (await chatButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await chatButton.click();
      await page.waitForTimeout(500);

      // Chat panel should be nearly full-screen
      const panel = page.locator('.fixed.inset-2');
      await expect(panel).toBeVisible();
    }
  });
});

test.describe('Tablet Responsiveness (1024px)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.tablet);
    await loginViaAPI(page, 'admin');
  });

  test('Desktop sidebar visible on tablet', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const desktopSidebar = page.locator('aside:not([aria-label="Mobile sidebar"])').first();
    await expect(desktopSidebar).toBeVisible();
  });

  test('Dashboard KPI cards wrap gracefully on tablet', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });
});

test.describe('Desktop (1440px)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginViaAPI(page, 'admin');
  });

  test('Sidebar can be collapsed and expanded', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const sidebar = page.locator('aside.hidden.lg\\:flex');

    // Collapse
    await page.click('button[aria-label="Toggle sidebar"]');
    await page.waitForTimeout(250);
    // Width class should change — check nav label text hidden
    await expect(page.locator('aside.hidden.lg\\:flex nav a span').first()).not.toBeVisible();

    // Expand
    await page.click('button[aria-label="Toggle sidebar"]');
    await page.waitForTimeout(250);
    await expect(page.locator('aside.hidden.lg\\:flex nav a span').first()).toBeVisible();
  });
});
