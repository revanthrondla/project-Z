/**
 * AUTH — Authentication flow tests (A-001 → A-010)
 */
import { test, expect } from '@playwright/test';
import { loginAs, loginViaAPI, CREDS } from './helpers.js';

test.describe('Authentication', () => {

  test.beforeEach(async ({ page }) => {
    // Clear cookies between tests for isolation
    await page.context().clearCookies();
  });

  // ── A-001: Super admin login ────────────────────────────────────────────────
  test('A-001: Super admin login redirects to platform dashboard', async ({ page }) => {
    await loginAs(page, 'superAdmin');
    await expect(page).toHaveURL(/super-admin\/dashboard/);
    await expect(page.locator('h1')).toContainText('Flow Platform Overview');
  });

  // ── A-002: Admin login with tenant code ────────────────────────────────────
  test('A-002: Admin login with tenant code redirects to dashboard', async ({ page }) => {
    await loginAs(page, 'admin');
    await expect(page).toHaveURL(/dashboard/);
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  // ── A-003: Employee login ───────────────────────────────────────────────────
  test('A-003: Employee login redirects to dashboard', async ({ page }) => {
    await loginAs(page, 'employee');
    await expect(page).toHaveURL(/dashboard/);
  });

  // ── A-005: Wrong password shows error ──────────────────────────────────────
  test('A-005: Wrong password shows error message', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#companyCode', 'hireiq');
    await page.fill('#email', 'admin@hireiq.com');
    await page.fill('#password', 'wrongpassword999');
    await page.click('button[type="submit"]');

    await expect(page.locator('[role="alert"], .text-red-700')).toBeVisible({ timeout: 8_000 });
    // Must stay on login page
    await expect(page).toHaveURL(/login/);
  });

  // ── A-006: Invalid tenant code ─────────────────────────────────────────────
  test('A-006: Invalid tenant code shows error', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#companyCode', 'does-not-exist-xyz');
    await page.fill('#email', 'admin@hireiq.com');
    await page.fill('#password', 'admin123');
    await page.click('button[type="submit"]');

    await expect(page.locator('[role="alert"], .text-red-700')).toBeVisible({ timeout: 8_000 });
    await expect(page).toHaveURL(/login/);
  });

  // ── A-007: Session persistence ─────────────────────────────────────────────
  test('A-007: Session persists after page reload', async ({ page }) => {
    await loginAs(page, 'admin');
    await expect(page).toHaveURL(/dashboard/);

    // Reload
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should still be on dashboard, not redirected to /login
    await expect(page).not.toHaveURL(/login/);
    await expect(page).toHaveURL(/dashboard/);
  });

  // ── A-008: Logout clears session ───────────────────────────────────────────
  test('A-008: Logout redirects to login and clears session', async ({ page }) => {
    await loginAs(page, 'admin');

    // Find and click Sign out
    await page.click('button:has-text("Sign out")');
    await expect(page).toHaveURL(/login/);

    // Try to navigate back — should redirect to login
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/login/);
  });

  // ── A-010: No token → redirect to login ────────────────────────────────────
  test('A-010: Unauthenticated access to protected route redirects to login', async ({ page }) => {
    // Clear cookies, then try to access protected route directly
    await page.context().clearCookies();
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/login/);
  });

  // ── Branding validation ─────────────────────────────────────────────────────
  test('Login page displays Flow branding with emerald theme', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('[aria-label="Flow"]')).toBeVisible();
    await expect(page.locator('h2')).toContainText('Welcome back');
    // Check page title
    await expect(page).toHaveTitle('Flow');
    // No "aGrow" or "HireIQ" visible on page
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).not.toContain('aGrow');
    expect(bodyText).not.toContain('HireIQ');
  });

  // ── Demo account quick-fill ─────────────────────────────────────────────────
  test('Demo account card pre-fills form', async ({ page }) => {
    await page.goto('/login');
    // Click Admin demo card
    await page.click('button:has-text("👑 Admin")');
    // Check form was filled
    await expect(page.locator('#email')).toHaveValue('admin@hireiq.com');
    await expect(page.locator('#companyCode')).toHaveValue('hireiq');
  });

  // ── Password visibility toggle ──────────────────────────────────────────────
  test('Password show/hide toggle works', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#password', 'mypassword');

    const passwordInput = page.locator('#password');
    await expect(passwordInput).toHaveAttribute('type', 'password');

    // Click show
    await page.click('button[aria-label="Show password"]');
    await expect(passwordInput).toHaveAttribute('type', 'text');

    // Click hide
    await page.click('button[aria-label="Hide password"]');
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });

  // ── Mobile: login page responsive ──────────────────────────────────────────
  test('Login page is usable on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');

    // Form should be visible and usable
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    // Left brand panel should be hidden on mobile
    await expect(page.locator('text=smarter way to manage your workforce')).toBeHidden();
  });
});
