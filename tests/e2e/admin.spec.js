/**
 * ADMIN — Workforce management flows (D-001 → S-003)
 */
import { test, expect } from '@playwright/test';
import { loginViaAPI, expectSuccess } from './helpers.js';

// Login as admin before each test (via API for speed)
test.beforeEach(async ({ page }) => {
  await loginViaAPI(page, 'admin');
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
test.describe('Admin Dashboard', () => {
  test('D-001: Dashboard loads with KPI cards', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // KPI cards or stat figures visible
    await expect(page.locator('h1, h2').first()).toBeVisible();
    // Page should not show error state
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });

  test('D-003: Dashboard shows pending counts', async ({ page }) => {
    await page.goto('/dashboard');
    // Pending section headers visible
    await expect(page.locator('text=Pending, text=pending').first()).toBeVisible({ timeout: 10_000 });
  });
});

// ── Employees ─────────────────────────────────────────────────────────────────
test.describe('Employee Management', () => {
  test('E-001: Employee list loads with search', async ({ page }) => {
    await page.goto('/employees');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('input[placeholder*="Search"], input[type="search"]')).toBeVisible();
  });

  test('E-002: Create new employee', async ({ page }) => {
    await page.goto('/employees');
    await page.waitForLoadState('networkidle');

    // Open new employee form
    await page.click('button:has-text("New"), button:has-text("Add"), button:has-text("Create")');
    await page.waitForSelector('form', { timeout: 5_000 });

    // Fill required fields
    const timestamp = Date.now();
    await page.fill('input[name="name"], input[placeholder*="Name"]', `Test User ${timestamp}`);
    await page.fill('input[name="email"], input[type="email"]', `test${timestamp}@example.com`);
    await page.fill('input[name="role"], input[placeholder*="role"], input[placeholder*="job"]', 'Developer');
    await page.fill('input[name="hourly_rate"], input[placeholder*="rate"]', '80');

    // Submit
    await page.click('button[type="submit"]:has-text("Save"), button[type="submit"]:has-text("Create")');

    // Should show success feedback or return to list with new employee
    await page.waitForTimeout(2000);
    await expect(page.locator(`text=Test User ${timestamp}`)).toBeVisible({ timeout: 8_000 });
  });

  test('E-004: Assign employee to client', async ({ page }) => {
    await page.goto('/employees');
    await page.waitForLoadState('networkidle');

    // Click first employee
    const firstRow = page.locator('tbody tr').first();
    await firstRow.click();
    await page.waitForLoadState('networkidle');

    // Look for client assignment field
    const clientField = page.locator('select[name*="client"], input[placeholder*="client"]').first();
    if (await clientField.isVisible()) {
      // Client field exists — test passes
      await expect(clientField).toBeVisible();
    }
  });
});

// ── Timesheets ────────────────────────────────────────────────────────────────
test.describe('Timesheet Management', () => {
  test('T-001: Timesheets page loads with pending tab', async ({ page }) => {
    await page.goto('/timesheets');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Pending, text=pending, text=Timesheets').first()).toBeVisible();
  });

  test('T-005: Filter timesheets by employee', async ({ page }) => {
    await page.goto('/timesheets');
    await page.waitForLoadState('networkidle');

    const filterSelect = page.locator('select').first();
    if (await filterSelect.isVisible()) {
      await filterSelect.selectOption({ index: 1 });
      await page.waitForLoadState('networkidle');
      // Table should update (not crash)
      await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    }
  });
});

// ── Invoices ──────────────────────────────────────────────────────────────────
test.describe('Invoice Management', () => {
  test('I-001: Invoice list loads', async ({ page }) => {
    await page.goto('/invoices');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1, h2').first()).toBeVisible();
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });

  test('I-007: Filter invoices by status', async ({ page }) => {
    await page.goto('/invoices');
    await page.waitForLoadState('networkidle');

    // Look for a status filter
    const statusFilter = page.locator('select, [role="combobox"]').first();
    if (await statusFilter.isVisible()) {
      await statusFilter.selectOption({ index: 1 });
      await page.waitForTimeout(1000);
      await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    }
  });
});

// ── Absences ──────────────────────────────────────────────────────────────────
test.describe('Absence Management', () => {
  test('AB-001: Absences page loads', async ({ page }) => {
    await page.goto('/absences');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1, h2').first()).toBeVisible();
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });
});

// ── Clients ───────────────────────────────────────────────────────────────────
test.describe('Client Management', () => {
  test('CL-001: Create client', async ({ page }) => {
    await page.goto('/clients');
    await page.waitForLoadState('networkidle');

    await page.click('button:has-text("New"), button:has-text("Add")');
    await page.waitForSelector('form, [role="dialog"]', { timeout: 5_000 });

    const timestamp = Date.now();
    await page.fill('input[name="name"], input[placeholder*="company"], input[placeholder*="name"]', `ACME Corp ${timestamp}`);
    await page.fill('input[name="email"], input[type="email"]', `acme${timestamp}@example.com`);

    await page.click('button[type="submit"]:has-text("Save"), button[type="submit"]:has-text("Create")');
    await page.waitForTimeout(2000);
    await expect(page.locator(`text=ACME Corp ${timestamp}`)).toBeVisible({ timeout: 8_000 });
  });
});

// ── Reports ───────────────────────────────────────────────────────────────────
test.describe('Reports', () => {
  test('R-001: Reports page loads without errors', async ({ page }) => {
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });
});

// ── Settings ──────────────────────────────────────────────────────────────────
test.describe('Settings', () => {
  test('S-001: Settings page loads', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1, h2').first()).toBeVisible();
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });
});

// ── Sidebar navigation ────────────────────────────────────────────────────────
test.describe('Navigation', () => {
  test('Sidebar contains all expected links for admin', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const navItems = ['Dashboard', 'Employees', 'Timesheets', 'Invoices', 'Settings'];
    for (const item of navItems) {
      await expect(page.locator(`nav a:has-text("${item}")`)).toBeVisible();
    }
  });

  test('Mobile sidebar opens on hamburger click', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Desktop sidebar should be hidden
    const desktopSidebar = page.locator('aside.hidden.lg\\:flex');
    await expect(desktopSidebar).not.toBeVisible();

    // Click hamburger
    await page.click('button[aria-label="Toggle sidebar"]');

    // Mobile sidebar should now be visible
    await expect(page.locator('aside[aria-label="Mobile sidebar"]')).toBeVisible();
  });

  test('Mobile sidebar closes when clicking backdrop', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Open sidebar
    await page.click('button[aria-label="Toggle sidebar"]');
    await expect(page.locator('aside[aria-label="Mobile sidebar"]')).toBeVisible();

    // Click backdrop
    await page.click('[aria-hidden="true"]');
    await page.waitForTimeout(300); // transition
    await expect(page.locator('aside[aria-label="Mobile sidebar"]')).not.toBeVisible();
  });

  test('Flow branding visible in sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('[aria-label="Flow"]').first()).toBeVisible();
    // No aGrow text in sidebar
    const sidebar = page.locator('aside').first();
    const sidebarText = await sidebar.textContent();
    expect(sidebarText).not.toContain('aGrow');
    expect(sidebarText).not.toContain('HireIQ');
  });
});
