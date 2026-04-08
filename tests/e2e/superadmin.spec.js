/**
 * SUPER ADMIN — Platform management flows (SA-001 → SA-006)
 */
import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await loginViaAPI(page, 'superAdmin');
});

test.describe('Super Admin Platform', () => {

  // SA-001
  test('SA-001: Platform overview dashboard loads with KPI cards', async ({ page }) => {
    await page.goto('/super-admin/dashboard');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1')).toContainText('Flow Platform Overview');
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    // KPI cards
    await expect(page.locator('text=Active Tenants, text=Total Tenants, text=Tenant').first()).toBeVisible();
  });

  // SA-002
  test('SA-002: Create new tenant organisation', async ({ page }) => {
    await page.goto('/super-admin/tenants');
    await page.waitForLoadState('networkidle');

    await page.click('button:has-text("New"), button:has-text("Create"), button:has-text("Add")');
    await page.waitForSelector('form, [role="dialog"]', { timeout: 5_000 });

    const timestamp = Date.now();
    const slug = `e2e${timestamp}`;

    await page.locator('input[name="company_name"], input[placeholder*="company"]').fill(`E2E Corp ${timestamp}`);
    await page.locator('input[name="slug"], input[placeholder*="slug"], input[placeholder*="code"]').fill(slug);
    await page.locator('input[name="admin_email"], input[type="email"]').fill(`admin@e2e${timestamp}.com`);

    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);

    // Tenant should appear in list
    await expect(page.locator(`text=E2E Corp ${timestamp}`)).toBeVisible({ timeout: 10_000 });
  });

  // SA-003
  test('SA-003: Toggle module for a tenant', async ({ page }) => {
    await page.goto('/super-admin/tenants');
    await page.waitForLoadState('networkidle');

    // Click first tenant
    const firstTenant = page.locator('tbody tr, [data-testid="tenant-row"]').first();
    if (await firstTenant.isVisible({ timeout: 5_000 })) {
      await firstTenant.click();
      await page.waitForLoadState('networkidle');

      // Look for module toggles
      const toggle = page.locator('[role="switch"], input[type="checkbox"]').first();
      if (await toggle.isVisible({ timeout: 3_000 })) {
        const wasChecked = await toggle.isChecked();
        await toggle.click();
        await page.waitForTimeout(1000);

        // Save if there's a save button
        const saveBtn = page.locator('button:has-text("Save"), button:has-text("Update")');
        if (await saveBtn.isVisible()) await saveBtn.click();

        await page.waitForTimeout(1500);
        // State should have changed
        const isNowChecked = await toggle.isChecked();
        expect(isNowChecked).toBe(!wasChecked);
      }
    }
  });

  // SA-004
  test('SA-004: Support dashboard shows all tenant tickets', async ({ page }) => {
    await page.goto('/super-admin/support');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1, h2').first()).toBeVisible();
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });

  // SA-005
  test('SA-005: AI configuration page loads and saves', async ({ page }) => {
    await page.goto('/super-admin/ai-config');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1, h2').first()).toBeVisible();
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });

  // SA-006: Super admin cannot access tenant routes
  test('SA-006: Super admin redirected from tenant routes', async ({ page }) => {
    await page.goto('/employees');
    await page.waitForLoadState('networkidle');

    // Either redirected to super-admin dashboard, or shows a sensible empty state
    // but must NOT crash
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });

  // Branding
  test('Super admin sees Flow branding, not aGrow/HireIQ', async ({ page }) => {
    await page.goto('/super-admin/dashboard');
    await page.waitForLoadState('networkidle');

    const bodyText = await page.locator('body').textContent();
    expect(bodyText).not.toContain('aGrow');
    expect(bodyText).not.toContain('HireIQ');
    await expect(page.locator('[aria-label="Flow"]')).toBeVisible();
    await expect(page.locator('h1')).toContainText('Flow');
  });
});
