# Flow — End-to-End Test Strategy

## Testing Pyramid

```
              ┌─────────────┐
              │   E2E (8%)  │  Playwright — critical user journeys
              ├─────────────┤
              │Integration  │  Supertest — API routes + DB
              │   (25%)     │
              ├─────────────┤
              │  Unit (67%) │  Vitest — services, utils, components
              └─────────────┘
```

---

## Coverage Targets

| Layer        | Tool          | Target | Scope                                   |
|--------------|---------------|--------|-----------------------------------------|
| Unit         | Vitest        | ≥ 80%  | Business logic, utils, React components |
| Integration  | Supertest     | ≥ 70%  | All REST API endpoints                  |
| E2E          | Playwright    | 100%   | All critical user flows (all 4 roles)   |

---

## Application Roles

| Role         | Tenant    | Access                                          |
|--------------|-----------|-------------------------------------------------|
| `super_admin`| master DB | Platform admin — manage tenants, AI, support    |
| `admin`      | tenant DB | Full workforce management                       |
| `candidate`  | tenant DB | Own timesheets, absences, invoices              |
| `client`     | tenant DB | Invoice viewing, timesheet approvals            |

---

## E2E Flows (Playwright)

### AUTH-001: Authentication Flows

| ID      | Scenario                            | Steps                                                       | Expected                          |
|---------|-------------------------------------|-------------------------------------------------------------|-----------------------------------|
| A-001   | Super admin login                   | Enter email, no company code → Sign in                      | Redirect to /super-admin/dashboard|
| A-002   | Admin login with tenant code        | Enter code + email + password → Sign in                     | Redirect to /dashboard            |
| A-003   | Employee login with tenant code     | Enter code + email + password → Sign in                     | Redirect to /dashboard            |
| A-004   | Client login with tenant code       | Enter code + email + password → Sign in                     | Redirect to /dashboard            |
| A-005   | Wrong password                      | Enter valid email + wrong password                          | Error banner shown                |
| A-006   | Invalid tenant code                 | Enter non-existent company code                             | Error: tenant not found           |
| A-007   | Session persistence                 | Login → close tab → reopen URL                             | Stays logged in (cookie)          |
| A-008   | Logout                              | Click Sign out                                              | Redirect to /login, cookie cleared|
| A-009   | Must-change-password gate           | Login with temp password                                    | Redirected to /change-password    |
| A-010   | Expired / invalid token             | Tamper with cookie → hit API                                | 401 → redirect to /login         |

### ADMIN-001: Dashboard

| ID      | Scenario                            | Steps                                               | Expected                          |
|---------|-------------------------------------|-----------------------------------------------------|-----------------------------------|
| D-001   | Dashboard loads KPI cards           | Login as admin → visit /dashboard                   | Active employees, hours, revenue  |
| D-002   | Recent timesheets shown             | Dashboard loads                                     | Table with recent time entries     |
| D-003   | Pending counts visible              | Have pending timesheets / absences                  | Badges show pending counts        |

### ADMIN-002: Employee Management

| ID      | Scenario                            | Steps                                               | Expected                          |
|---------|-------------------------------------|-----------------------------------------------------|-----------------------------------|
| E-001   | View employee list                  | Navigate to /employees                              | Table with search + filter        |
| E-002   | Create employee                     | Fill form → Save                                    | Employee appears in list          |
| E-003   | Edit employee details               | Click employee → Edit → Save                        | Changes persisted                 |
| E-004   | Assign employee to client           | Edit employee → select client                       | Relationship saved                |
| E-005   | Set hourly rate                     | Edit employee → set rate                            | Rate stored                       |
| E-006   | Upload employee photo               | Edit → upload avatar                                | Photo displayed in profile        |
| E-007   | Deactivate employee                 | Edit → status → Inactive                            | Badge shows Inactive              |
| E-008   | Emergency contacts tab              | Open employee → Emergency Contacts tab              | Contacts listed / editable        |
| E-009   | Documents tab                       | Open employee → Documents tab                       | Documents listed                  |
| E-010   | Generate password for employee      | Create employee → auto-generated password shown     | Temp password visible in modal    |

### ADMIN-003: Timesheets

| ID      | Scenario                            | Steps                                               | Expected                          |
|---------|-------------------------------------|-----------------------------------------------------|-----------------------------------|
| T-001   | View pending timesheets             | Navigate to /timesheets → Pending tab               | List of pending entries           |
| T-002   | Approve timesheet                   | Click Approve on a pending entry                    | Status changes to approved        |
| T-003   | Reject timesheet with reason        | Click Reject → enter reason                         | Status changes to rejected        |
| T-004   | Bulk approve                        | Select multiple → Approve all                       | All selected approved             |
| T-005   | Filter by employee                  | Filter → select employee                            | Only that employee's entries      |
| T-006   | Filter by date range                | Set start + end date                                | Filtered correctly                |

### ADMIN-004: Invoices

| ID      | Scenario                            | Steps                                               | Expected                          |
|---------|-------------------------------------|-----------------------------------------------------|-----------------------------------|
| I-001   | View invoice list                   | Navigate to /invoices                               | Table of invoices                 |
| I-002   | Generate invoice for employee       | Click Generate → select period → Create             | Invoice created with correct total|
| I-003   | Invoice calculation correct         | Check hours × rate = total                          | Maths correct                     |
| I-004   | Print/download invoice PDF          | Click Print                                         | Print dialog opens with invoice   |
| I-005   | Mark invoice as paid                | Click Mark Paid                                     | Status → paid, badge green        |
| I-006   | Send invoice email                  | Click Send → confirm                                | Email queued / success toast      |
| I-007   | Filter by status                    | Filter dropdown → Pending                           | Only pending invoices             |

### ADMIN-005: Absences

| ID      | Scenario                            | Steps                                               | Expected                          |
|---------|-------------------------------------|-----------------------------------------------------|-----------------------------------|
| AB-001  | View absence requests               | Navigate to /absences                               | Calendar + list view              |
| AB-002  | Approve absence                     | Click Approve                                       | Status → approved                 |
| AB-003  | Reject absence                      | Click Reject                                        | Status → rejected                 |
| AB-004  | View absence by employee            | Filter by employee                                  | Filtered results                  |

### ADMIN-006: Clients

| ID      | Scenario                            | Steps                                               | Expected                          |
|---------|-------------------------------------|-----------------------------------------------------|-----------------------------------|
| CL-001  | Create client                       | Navigate to /clients → New → fill → Save            | Client in list                    |
| CL-002  | Edit client details                 | Click → Edit → Save                                 | Changes persisted                 |
| CL-003  | View linked employees               | Open client profile                                 | Employees shown                   |

### ADMIN-007: Reports

| ID      | Scenario                            | Steps                                               | Expected                          |
|---------|-------------------------------------|-----------------------------------------------------|-----------------------------------|
| R-001   | Hours report loads                  | Navigate to /reports → Hours tab                    | Chart + table rendered            |
| R-002   | Filter by date range                | Set date range → Apply                              | Filtered data                     |
| R-003   | Revenue report                      | Revenue tab                                         | Invoice totals by period          |
| R-004   | Export to CSV                       | Click Export                                        | CSV downloaded                    |

### ADMIN-008: Settings

| ID      | Scenario                            | Steps                                               | Expected                          |
|---------|-------------------------------------|-----------------------------------------------------|-----------------------------------|
| S-001   | Update company settings             | Settings → Company → Save                           | Settings persisted                |
| S-002   | Configure email polling             | Settings → Email → fill IMAP details → Save         | Config saved                      |
| S-003   | Enable/disable email polling        | Toggle switch                                       | State persisted                   |

### EMPLOYEE-001: Candidate Flows

| ID      | Scenario                            | Steps                                               | Expected                          |
|---------|-------------------------------------|-----------------------------------------------------|-----------------------------------|
| EMP-001 | View own dashboard                  | Login as candidate → /dashboard                     | My hours, absences, invoices      |
| EMP-002 | Log hours                           | Navigate to /log-hours → fill date/hours → Submit   | Entry created (pending)           |
| EMP-003 | Edit pending time entry             | Click Edit on pending entry → change hours → Save   | Updated correctly                 |
| EMP-004 | Cannot edit approved entry          | Try to edit approved entry                          | Edit button disabled / error      |
| EMP-005 | Submit absence request              | /my-absences → New → fill → Submit                  | Absence created (pending)         |
| EMP-006 | View own invoices                   | /my-invoices                                        | Invoice list shown                |
| EMP-007 | Print own invoice                   | Click Print on invoice                              | Print dialog opens                |
| EMP-008 | My Resume page                      | /my-resume                                          | Resume builder loads              |
| EMP-009 | Raise support ticket                | /support → New ticket                               | Ticket created                    |
| EMP-010 | Cannot access admin routes          | Navigate to /employees                              | Redirect to /dashboard or 403     |

### CLIENT-001: Client Portal Flows

| ID      | Scenario                            | Steps                                               | Expected                          |
|---------|-------------------------------------|-----------------------------------------------------|-----------------------------------|
| CP-001  | View invoices                       | Login as client → /invoices                         | Only their invoices visible       |
| CP-002  | Approve timesheet                   | /client-timesheets → Approve                        | Status updated                    |
| CP-003  | Download invoice                    | Print button on invoice                             | PDF opens                         |
| CP-004  | Cannot see other client data        | Attempt to view another client's invoice            | 403 or empty                      |

### SUPERADMIN-001: Platform Management

| ID      | Scenario                            | Steps                                               | Expected                          |
|---------|-------------------------------------|-----------------------------------------------------|-----------------------------------|
| SA-001  | Platform overview dashboard         | Login as super_admin → /super-admin/dashboard       | KPI cards visible                 |
| SA-002  | Create new tenant                   | /super-admin/tenants → New → fill → Create          | Tenant provisioned                |
| SA-003  | Enable/disable modules per tenant   | Open tenant → toggle module → Save                  | Module state persisted            |
| SA-004  | View support tickets                | /super-admin/support                                | All tenant tickets visible        |
| SA-005  | Configure AI platform settings      | /super-admin/ai-config → fill → Save                | AI config saved                   |
| SA-006  | Cannot access tenant routes         | Navigate to /employees                              | Redirect or empty (no tenant DB)  |

### AI-001: AI Assistant

| ID      | Scenario                            | Steps                                               | Expected                          |
|---------|-------------------------------------|-----------------------------------------------------|-----------------------------------|
| AI-001  | Open chat widget                    | Click floating 🤖 button                            | Chat panel slides in              |
| AI-002  | Send message — data query           | Ask "How many employees are active?"                | Response with number              |
| AI-003  | Create employee via AI              | Ask "Create employee John Smith..."                 | Tool call shown, employee created |
| AI-004  | Start new chat                      | Click pencil icon                                   | Conversation cleared              |
| AI-005  | View chat history                   | Click clock icon → sidebar                          | Previous conversations listed     |
| AI-006  | Widget mobile responsive            | Open on 375px viewport                              | Widget full-screen, usable        |

---

## Integration Test Plan (Supertest / Jest)

### Auth Routes (`/api/auth/*`)
- POST /login: valid credentials, wrong password, missing fields, unknown tenant
- GET  /me: valid token, expired token, no token
- POST /logout: cookie cleared

### Candidates Routes (`/api/candidates/*`)
- GET  /: returns list, requires admin auth
- POST /: creates candidate, validates required fields
- PATCH /:id: updates, returns 404 for unknown
- DELETE /:id: soft-deletes (if implemented)

### Time Entries Routes (`/api/time-entries/*`)
- GET /: admin sees all, candidate sees own
- POST /: creates entry, validates date/hours
- PATCH /:id/approve: admin only
- PATCH /:id/reject: admin only, requires reason

### Invoices Routes (`/api/invoices/*`)
- GET /: admin sees all, candidate sees own
- POST /generate: calculates total correctly (hours × rate)
- PATCH /:id/status: mark paid, mark sent

### Absence Routes (`/api/absences/*`)
- GET /, POST /, PATCH /:id/approve, PATCH /:id/reject

### AI Chat (`/api/ai-chat/*`)
- POST /message: requires auth, handles tool calls
- GET /conversations: returns user's conversations
- DELETE /conversations/:id: deletes conversation

---

## Unit Test Plan (Vitest)

### Frontend
- `FlowLogo` renders correct gradient colours
- `Layout` shows correct nav items per role
- `Login` form validation, demo account fill
- `AuthContext` login/logout state transitions
- `useNotifications` hook: polling, mark-read, delete

### Backend
- `migrate.js`: migration IDs sorted, idempotent
- `masterDatabase.js`: seed creates super-admin, default tenant
- `emailPaymentService.js`: amount parsing, invoice matching
- Invoice calculation: hours × rate = total (floating point safe)
- Date filtering: `TO_CHAR` and `EXTRACT` queries

---

## Accessibility Checklist (per page)

- [ ] All interactive elements reachable by keyboard (Tab, Enter, Space)
- [ ] Focus ring visible (emerald `outline-2`)
- [ ] `aria-label` on icon-only buttons
- [ ] Form inputs have associated `<label>` with `htmlFor`
- [ ] Colour contrast ≥ 4.5:1 (emerald-600 on white: ✅ passes)
- [ ] Skip-to-content link for screen readers
- [ ] Loading states announced via `aria-live="polite"`
- [ ] Error messages associated with fields via `aria-describedby`

---

## Performance Benchmarks

| Metric                      | Target    |
|-----------------------------|-----------|
| LCP (Largest Contentful Paint) | < 2.5s  |
| FID / INP                   | < 100ms   |
| CLS                         | < 0.1     |
| API response (p95)          | < 500ms   |
| DB query (p95)              | < 100ms   |
| Bundle size (gzipped)       | < 300kb   |

---

## Test Environments

| Environment | URL                        | DB                    |
|-------------|----------------------------|-----------------------|
| Local       | http://localhost:5173       | PostgreSQL (local)    |
| CI          | Ephemeral Docker            | PostgreSQL (container)|
| Staging     | https://staging.flow.app    | PostgreSQL (Railway)  |
| Production  | https://flow.app            | PostgreSQL (Railway)  |
