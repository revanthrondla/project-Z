# HireIQ — Role-Based Data Architecture Audit
**Date:** 2026-04-07
**Database:** PostgreSQL (schema-per-tenant model)
**Schemas:** `master` (platform-level) + `tenant_{slug}` (per-tenant)

---

## Overview

HireIQ uses **five distinct role types** with different data access scopes:

| Role | Scope | Lives In |
|---|---|---|
| **Super Admin** | Platform-wide (all tenants) | `master` schema |
| **Admin** | All data within their tenant | `tenant_{slug}` schema |
| **Employee** (Candidate) | Own profile, timesheets, absences | `tenant_{slug}` schema |
| **Client** | Own invoices, approved timesheets | `tenant_{slug}` schema |
| **System / API** | Background processes | Both schemas |

---

## MASTER SCHEMA — Platform-Level Data

Owned by Super Admins. Tenants never see this data directly.

### Tenants
| Table | Purpose | Key Columns |
|---|---|---|
| `tenants` | Tenant registry | `slug, name, plan, licence_expires_at, modules JSONB` |
| `tenant_modules` | Feature flags per tenant | `tenant_id, module_name, enabled` |

### Super Admin Users
| Table | Purpose | Key Columns |
|---|---|---|
| `super_admins` | Platform admin accounts | `name, email, password_hash, must_change_password` |

### Platform Support (Super Admin ↔ Tenant Admins)
| Table | Purpose | Key Columns |
|---|---|---|
| `platform_support_tickets` | Cross-tenant support tickets | `tenant_id, subject, category, status, priority` |
| `platform_support_messages` | Thread messages | `ticket_id, sender, sender_role, message` |

### Platform AI Config
| Table | Purpose | Key Columns |
|---|---|---|
| `platform_ai_config` | Global AI provider settings | `provider, model, api_key, allow_tenant_keys` |

---

## TENANT SCHEMA — Per-Tenant Data

All tables below live inside `tenant_{slug}` schemas. The `search_path` is set per-request via `injectTenantDb` middleware.

---

## 1. SUPER ADMIN — What They See Across the Platform

Super admins access **all tenant schemas** through the Super Admin dashboard. They do not log into individual tenants; instead they query each tenant DB directly.

**Data they manage:**

| Data Domain | Tables | Access Pattern |
|---|---|---|
| Tenant list & config | `master.tenants`, `master.tenant_modules` | Full CRUD |
| Tenant statistics | Per-tenant: `candidates`, `invoices`, `time_entries`, `absences` | Read-only aggregate stats |
| Licence management | `master.tenants.licence_expires_at`, `master.tenants.plan` | Full update |
| Platform support | `master.platform_support_tickets`, `master.platform_support_messages` | Full CRUD |
| Super admin accounts | `master.super_admins` | Create, password change |
| Platform AI settings | `master.platform_ai_config` | Full update |

**Dashboard stats per tenant (read-only):**
- Active employees (`candidates WHERE status = 'active'`)
- Pending timesheets (`time_entries WHERE status = 'pending'`)
- Pending absences (`absences WHERE status = 'pending'`)
- Outstanding invoices (`invoices WHERE status IN ('sent','approved','client_approved')`)

---

## 2. ADMIN (Tenant Admin) — Full Tenant Data Access

Admins own all data within their tenant schema. They can read and write every table.

### 2a. People & Access
| Table | Purpose | Key Columns |
|---|---|---|
| `users` | All login accounts (admin, candidate, client roles) | `name, email, password_hash, role, must_change_password` |
| `candidates` | Employee/contractor records | `name, email, phone, role (job title), hourly_rate, client_id, start_date, end_date, status, contract_type` |
| `clients` | Client company records | `name, contact_name, contact_email, contact_phone, address, billing_currency, user_id` |

### 2b. Time Tracking
| Table | Purpose | Key Columns |
|---|---|---|
| `time_entries` | Timesheet entries | `candidate_id, date, hours, description, project, status (pending/approved/rejected), approved_by` |

**Admin workflow:** Review pending time entries → approve/reject → feeds into invoice generation.

### 2c. Absence Management
| Table | Purpose | Key Columns |
|---|---|---|
| `absences` | Absence requests | `candidate_id, start_date, end_date, type, status, notes, approved_by` |
| `absence_policies` | Leave policy rules | `name, absence_type, accrual_method, days_per_year, carry_over_days, requires_approval` |
| `absence_balances` | Per-employee leave balances | `candidate_id, policy_id, year, entitlement, taken, pending, carry_over` |

**Absence types:** vacation, sick, personal, public_holiday, other
**Leave accrual methods:** fixed, accrual, unlimited

### 2d. Invoicing & Billing
| Table | Purpose | Key Columns |
|---|---|---|
| `invoices` | Invoices to clients | `invoice_number, candidate_id, client_id, period_start/end, total_hours, hourly_rate, total_amount, status, due_date` |
| `invoice_line_items` | Line-item breakdown | `invoice_id, date, description, hours, rate, amount` |
| `invoice_payments` | Payment records against invoices | `invoice_id, amount, payment_date, payment_method, reference_number, recorded_by` |

**Invoice lifecycle:** draft → sent → approved → client_approved → paid (or overdue/cancelled)

### 2e. Payroll
| Table | Purpose | Key Columns |
|---|---|---|
| `payroll_runs` | Payroll batch runs | `pay_period, period_start, period_end, status, total_gross, total_net, created_by, approved_by` |
| `payroll_items` | Per-employee line in a run | `payroll_run_id, candidate_id, hours_worked, hourly_rate, gross_pay, deductions, net_pay` |

**Payroll status:** draft → processing → completed → cancelled

### 2f. Recruitment
| Table | Purpose | Key Columns |
|---|---|---|
| `job_postings` | Open job positions | `title, description, skills, client_id, location, contract_type, hourly_rate_min/max, status, created_by` |
| `job_applications` | Candidate applications | `job_id, candidate_id, status, cover_letter, applied_at` |

**Application status:** applied → reviewing → shortlisted → rejected → hired

### 2g. Documents & Signatures
| Table | Purpose | Key Columns |
|---|---|---|
| `documents` | Uploaded documents (contracts, policies) | `title, file_name, file_path, file_size, mime_type, category, signature_type, required_signers, status, candidate_id, client_id` |
| `document_signatures` | Signature status per signer | `document_id, signer_role, signer_id, status (pending/signed/rejected), signed_at, ip_address` |

### 2h. Email Payment Polling
| Table | Purpose | Key Columns |
|---|---|---|
| `email_settings` | IMAP credentials for payment polling | `enabled, imap_host, imap_port, imap_user, imap_password (encrypted)` |
| `email_payment_imports` | Parsed payment notifications from email | `email_uid, parsed_amount, parsed_payment_date, parsed_reference, parsed_employee_names JSONB, matched_invoice_id, mismatch_flags JSONB, status (pending/confirmed/rejected/ignored)` |

### 2i. Tenant Support
| Table | Purpose | Key Columns |
|---|---|---|
| `support_tickets` | Employee/client-raised issues | `user_id, subject, description, category, status, priority, assigned_to` |
| `support_ticket_messages` | Thread messages on tickets | `ticket_id, user_id, message, is_staff` |

### 2j. Settings & Configuration
| Table | Purpose | Key Columns |
|---|---|---|
| `settings` | Key-value config store | `key, value` (e.g. company name, currency, date format) |
| `ai_settings` | AI assistant configuration | `provider, model, api_key, system_prompt_suffix, allow_tenant_keys` |

### 2k. AI Assistant (Admin-Controlled)
| Table | Purpose | Key Columns |
|---|---|---|
| `ai_settings` | Provider & model selection | `provider (anthropic/openai), model, api_key` |
| `ai_documents` | Knowledge base documents | `title, file_name, file_type, file_size, content, search_vector (TSVECTOR)` |
| `ai_document_chunks` | Chunked content for RAG | `document_id, chunk_index, content, embedding` |
| `ai_conversations` | Chat session history | `user_id, title, context_type` |
| `ai_messages` | Individual messages in a conversation | `conversation_id, role (user/assistant/system), content, tool_data JSONB` |

### 2l. Audit Trail
| Table | Purpose | Key Columns |
|---|---|---|
| `audit_logs` | Immutable change log | `table_name, record_id, action (INSERT/UPDATE/DELETE), changed_by, old_values JSONB, new_values JSONB, ip_address` |

---

## 3. EMPLOYEE (Candidate) — Own Data Only

Employees log in via their `users` record. They are linked to a `candidates` row via `candidates.user_id`.

### 3a. Personal Profile
| Table | What Employee Sees | Editable? |
|---|---|---|
| `candidates` | Own row: name, email, phone, job title, hourly rate, status | Name, phone only (admin controls rate/status) |
| `employee_contact_ext` | Extended contact: alt phone, personal email, home address, LinkedIn | Self-editable |
| `emergency_contacts` | 1–N emergency contacts (name, relationship, phone1, phone2, email) | Self-editable |

### 3b. Employment & Compensation History
| Table | What Employee Sees | Notes |
|---|---|---|
| `employment_history` | Effective-dated roles (position_title, start_date, end_date, remuneration, currency, frequency) | Read-only; admin-managed |
| `bank_accounts` | Own bank/payment details (account_number, routing_number, swift_code, IBAN) | Self-editable |

### 3c. Time Tracking
| Table | What Employee Sees | Can Submit? |
|---|---|---|
| `time_entries` | Own entries only | Yes — creates pending entries |
| `invoices` | Own approved invoices | Read-only |

### 3d. Absence & Leave
| Table | What Employee Sees | Can Submit? |
|---|---|---|
| `absences` | Own absence requests | Yes — creates pending absences |
| `leave_balances` | Own leave balance (entitlement_days, used_days, carry_over_days) | Read-only |

### 3e. Resume Builder
| Table | What Employee Sees | Editable? |
|---|---|---|
| `candidate_resumes` | Own resume: headline, summary, experience JSONB, education JSONB, skills JSONB, certifications JSONB, languages JSONB | Full self-edit; PDF export available |

### 3f. Benefits & Compensation
| Table | What Employee Sees | Notes |
|---|---|---|
| `employee_benefits` | Own benefits (benefit_type, provider, value, currency, effective_date) | Read-only; admin-managed |
| `leave_balances` | Annual leave balance by type | Read-only |

### 3g. Assets
| Table | What Employee Sees | Notes |
|---|---|---|
| `employee_assets` | Assets checked out to them (category, description, serial_number, checkout_date) | Read-only |

### 3h. Training & Certifications
| Table | What Employee Sees | Notes |
|---|---|---|
| `training_records` | Own training history (name, training_date, content, results, certificate_url) | Read-only; admin-managed |
| `employee_licenses` | Own licences/documents (document_type, expiry_date, status) | Read-only |

### 3i. Performance
| Table | What Employee Sees | Notes |
|---|---|---|
| `performance_reviews` | Own reviews (review_date, overall_score, evaluation, next_steps) | Read-only; reviewer-managed |

### 3j. Notifications
| Table | What Employee Sees | Notes |
|---|---|---|
| `notifications` | Own notifications only | System-generated |

### 3k. Support
| Table | What Employee Sees | Notes |
|---|---|---|
| `support_tickets` | Own tickets | Can create, add messages |
| `support_ticket_messages` | Messages on own tickets | Can reply |

### 3l. AI Chat
| Table | What Employee Sees | Notes |
|---|---|---|
| `ai_conversations` | Own conversations | Can create |
| `ai_messages` | Own conversation messages | Own only |

### 3m. Job Applications
| Table | What Employee Sees | Notes |
|---|---|---|
| `job_postings` | All open postings | Read-only |
| `job_applications` | Own applications | Can apply |

---

## 4. CLIENT — Invoice & Timesheet View

Clients log in via their `users` record (role = 'client'). They are linked to a `clients` row via `clients.user_id`.

### 4a. Invoices (Own Only)
| Table | What Client Sees | Can Do? |
|---|---|---|
| `invoices` | Invoices addressed to their client_id | Read, approve (`client_approved`), add notes |
| `invoice_line_items` | Line items on their invoices | Read-only |
| `invoice_payments` | Payments recorded against their invoices | Read-only |

### 4b. Timesheet Visibility
| Table | What Client Sees | Notes |
|---|---|---|
| `time_entries` | Approved entries for employees assigned to them | Read-only (for invoice validation) |

### 4c. Documents
| Table | What Client Sees | Notes |
|---|---|---|
| `documents` | Documents addressed to their `client_id` | Read, sign (digital signature flow) |
| `document_signatures` | Their signing status | Can sign |

### 4d. Support
| Table | What Client Sees | Notes |
|---|---|---|
| `support_tickets` | Own tickets | Can create, reply |
| `support_ticket_messages` | Messages on own tickets | Can reply |

### 4e. Notifications
| Table | What Client Sees | Notes |
|---|---|---|
| `notifications` | Own notifications | Read-only |

---

## 5. AGROW MODULE — Agricultural Workforce Extension

Separate domain tables for agricultural workforce management. Accessible to Admin users when the `agrow` module is enabled.

| Table | Purpose | Key Columns |
|---|---|---|
| `ag_languages` | Supported worker languages | `language_name, language_code, is_default` |
| `ag_custom_field_definitions` | Custom field schema for workers/products | `field_name, field_type, applies_to, options JSONB, required` |
| `ag_employees` | Agricultural worker records | `employee_name, employee_number, crew_name, entity_name, ranch, badge_number, gender, start_date, custom_fields JSONB` |
| `ag_products` | Produce/commodity records | `commodity, ranch, entity, location, crate_count, metric, custom_fields JSONB` |
| `ag_scanned_products` | Barcode/RFID scan records | `product_name, quantity, unit, user_name, scanned_at, synced` |
| `ag_analytics_snapshots` | Point-in-time harvesting analytics | `snapshot_date, harvesting_data JSONB, metrics JSONB` |

---

## Summary: Table Count by Role Domain

| Domain | Tables | Roles with Access |
|---|---|---|
| Platform identity | 5 (master schema) | Super Admin only |
| People & access | 3 | Admin (full), Employee/Client (own row) |
| Time tracking | 1 | Admin, Employee (own), Client (approved) |
| Absence management | 3 | Admin (full), Employee (own requests) |
| Invoicing & payments | 3 | Admin (full), Client (own invoices) |
| Payroll | 2 | Admin only |
| Recruitment | 2 | Admin (full), Employee (apply) |
| Employee profile (extended) | 10 | Admin (full), Employee (own, mostly read) |
| Documents & signatures | 2 | Admin (full), Employee/Client (own) |
| Email payment polling | 2 | Admin only |
| Support tickets | 2 | All roles (own tickets) |
| Notifications | 1 | All roles (own) |
| AI assistant | 5 | Admin (manage), All (chat) |
| Settings & config | 2 | Admin only |
| Audit log | 1 | Admin (read), System (write) |
| Agrow module | 6 | Admin (agrow-enabled tenants) |
| **Total (tenant schema)** | **46** | — |
| **Total (master schema)** | **5** | Super Admin |
| **Grand total** | **51** | — |

---

## Migration Status

All 51 tables are now correctly defined. The migration sequence is:

| Migration | Description | Status |
|---|---|---|
| 1 | Add `must_change_password` to users | ✅ Applied to all schemas |
| 2 | Add `user_id` to clients | ✅ Applied |
| 3 | Add `client_approved` status to invoices | ✅ Applied |
| 4 | Create `invoice_payments` | ✅ Applied |
| 5 | Create `payroll_runs` + `payroll_items` | ✅ Applied |
| 6 | Add `updated_at` triggers | ✅ Applied |
| 7 | Create employee profile tables (emergency_contacts, bank_details, employment_history, salary_history, candidate_documents) | ✅ Applied |
| 8 | Create `audit_logs` | ✅ Applied |
| 9 | Create AI/chat tables (`ai_conversations`, `ai_messages`, `tenant_ai_config`) | ✅ Applied |
| 10 | Create `absence_policies` + `absence_balances` | ✅ Applied |
| **11** | **Schema normalisation: rename legacy tables, add missing columns** | ✅ **NEW — Handles existing schemas** |

**Migration 11 specifically handles:**
- `tenant_ai_config` → `ai_settings`
- `support_messages` → `support_ticket_messages`
- `email_payment_events` → `email_payment_imports`
- `payroll_entries` → `payroll_items`
- Added `ai_messages.tool_data JSONB`
- Added `ai_documents.file_name`, `file_type`, `file_size`
- Backfills `ai_documents.search_vector` (PostgreSQL FTS) for old schemas
- Fixes `email_settings` column names (`host` → `imap_host`, etc.)

---

## Code Fixes Applied This Session

| File | Fix |
|---|---|
| `backend/database.js` | Added `tool_data JSONB` to `ai_messages`; added `file_name/file_type/file_size` to `ai_documents` |
| `backend/migrate.js` | Added migration 11 (schema normalisation); added `.sort()` to runner so array order is irrelevant |
| `backend/routes/aiChat.js` | Replaced SQLite FTS5 `searchDocuments` with PostgreSQL `tsvector` / `websearch_to_tsquery`; fixed `job_title` → `role AS job_title` in all candidate queries; fixed missing `await` on `getTenantAISettings` / `getPlatformAIConfig`; fixed `bcrypt.hashSync` → async `bcrypt.hash` |
| `backend/routes/auth.js` | Fixed 2× `bcrypt.hashSync` → async; fixed SQLite `must_change_password = 0` → `FALSE` |
| `backend/routes/candidates.js` | Fixed `bcrypt.hashSync` → async |
| `backend/routes/clientPortal.js` | Fixed `bcrypt.hashSync` → async |
| `backend/routes/upload.js` | Fixed `bcrypt.hashSync` → async |
| `backend/routes/timeEntries.js` | Fixed `date LIKE '2024-%'` → `TO_CHAR(date, 'YYYY-MM') = ?` |
| `backend/routes/invoices.js` | Fixed `period_start LIKE '2024%'` → `EXTRACT(YEAR FROM period_start)::TEXT = ?` |
