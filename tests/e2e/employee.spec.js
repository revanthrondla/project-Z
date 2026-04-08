/**
 * EMPLOYEE (Candidate) — Time logging, absences, invoices (EMP-001 → EMP-010)
 */
import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await loginViaAPI(page, 'employee');
});

test.describe('Employee Portal', () => {

  // EMP-001
  test('EMP-001: Employee dashboard loads', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1, h2').first()).toBeVisible();
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });

  // EMP-002
  test('EMP-002: Log hours creates a pending time entry', async ({ page }) => {
    await page.goto('/log-hours');
    await page.waitForLoadState('networkidle');

    // Fill date
    const today = new Date().toISOString().split('T')[0];
    const dateInput = page.locator('input[type="date"]').first();
    await dateInput.fill(today);

    // Fill hours
    await page.locator('input[name="hours"], input[placeholder*="hours"]').fill('8');

    // Optional description
    const descInput = page.locator('input[name="description"], textarea[name="description"]');
    if (await descInput.isVisible()) {
      await descInput.fill('Development work');
    }

    // Submit
    await page.click('button[type="submit"]:has-text("Log"), button[type="submit"]:has-text("Submit"), button[type="submit"]:has-text("Save")');
    await page.waitForTimeout(2000);

    // Success: entry visible or success banner
    const hasEntry = await page.locator('text=8h, text=8.0').isVisible({ timeout: 5_000 }).catch(() => false);
    const hasSuccess = await page.locator('text=logged, text=saved, text=created').isVisible({ timeout: 3_000 }).catch(() => false);
    expect(hasEntry || hasSuccess).toBeTruthy();
  });

  // EMP-004
  test('EMP-004: Cannot edit an approved time entry', async ({ page }) => {
    await page.goto('/log-hours');
    await page.waitForLoadState('networkidle');

    // If there are approved entries, edit button should be disabled or absent
    const approvedBadge = page.locator('text=approved').first();
    if (await approvedBadge.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const approvedRow = approvedBadge.locator('..');
      const editBtn = approvedRow.locator('button:has-text("Edit")');
      if (await editBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await expect(editBtn).toBeDisabled();
      }
    }
  });

  // EMP-005
  test('EMP-005: Submit absence request', async ({ page }) => {
    await page.goto('/my-absences');
    await page.waitForLoadState('networkidle');

    await page.click('button:has-text("New"), button:has-text("Request"), button:has-text("Add")');
    await page.waitForSelector('form, [role="dialog"]', { timeout: 5_000 });

    // Fill absence form
    const today = new Date().toISOString().split('T')[0];
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    await page.locator('input[type="date"]').nth(0).fill(today);
    await page.locator('input[type="date"]').nth(1).fill(nextWeek);

    // Type select
    const typeSelect = page.locator('select[name="type"], select').first();
    if (await typeSelect.isVisible()) await typeSelect.selectOption('vacation');

    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });

  // EMP-006
  test('EMP-006: View own invoices', async ({ page }) => {
    await page.goto('/my-invoices');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1, h2').first()).toBeVisible();
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });

  // EMP-009
  test('EMP-009: Raise a support ticket', async ({ page }) => {
    await page.goto('/support');
    await page.waitForLoadState('networkidle');

    await page.click('button:has-text("New"), button:has-text("Open"), button:has-text("Create")');
    await page.waitForSelector('form, [role="dialog"]', { timeout: 5_000 });

    await page.locator('input[name="subject"], input[placeholder*="subject"]').fill('Test issue from E2E');
    await page.locator('textarea[name="message"], textarea[placeholder*="message"]').fill('This is a test support ticket created by Playwright E2E test.');

    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });

  // EMP-010
  test('EMP-010: Employee cannot access admin routes', async ({ page }) => {
    await page.goto('/employees');
    await page.waitForLoadState('networkidle');

    // Should be redirected to dashboard, or see a 403/access denied page
    const isRedirected = page.url().includes('/dashboard');
    const hasForbidden = await page.locator('text=403, text=Forbidden, text=Access denied, text=not allowed').isVisible({ timeout: 3_000 }).catch(() => false);
    expect(isRedirected || hasForbidden).toBeTruthy();
  });

  // Mobile responsiveness
  test('Mobile: Log Hours page is usable on 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/log-hours');
    await page.waitForLoadState('networkidle');

    // Core form elements visible and not cut off
    await expect(page.locator('input[type="date"]').first()).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });
});
