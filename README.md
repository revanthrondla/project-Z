# Flow — Time Tracking, Absence Management & Invoice Platform

A full-stack multi-tenant web application for staffing agencies to track candidate hours, manage absences, and generate invoices — with per-tenant PostgreSQL schemas, role-based access, and an AI assistant.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + Tailwind CSS (Emerald design system) |
| Backend | Node.js + Express |
| Database | PostgreSQL — separate schema per tenant (`tenant_{slug}`) |
| Auth | JWT (httpOnly cookie, 8h expiry) |
| AI | Anthropic Claude / OpenAI (configurable per tenant) |

## Prerequisites

- **Node.js v18+**
- npm
- **PostgreSQL** — connection string in `DATABASE_URL`

## Quick Start

```bash
# 1. Install all dependencies (backend + frontend + tests)
npm run install:all

# 2. Copy and fill environment variables
cp .env.example .env

# 3. Start both servers (backend :3001, frontend :5173)
npm run dev
```

Then open **http://localhost:5173** in your browser.

## Demo Accounts (tenant: `hireiq`)

| Role | Email | Password |
|------|-------|----------|
| Super Admin | superadmin@flow.com | (set via DATABASE seed) |
| Admin | admin@hireiq.com | admin123 |
| Candidate (Dev) | alice@hireiq.com | candidate123 |
| Candidate (Design) | bob@hireiq.com | candidate123 |
| Client | client@hireiq.com | client123 |

## Features

### Super Admin Portal
- **Tenant Management** — Create, suspend, and manage all organizations
- **Module Control** — Enable/disable feature modules per tenant
- **AI Config** — Set global or per-tenant LLM provider and API key
- **Platform Support** — Respond to support tickets from tenant admins

### Admin Portal
- **Dashboard** — KPI overview (active employees, pending approvals, monthly hours, revenue)
- **Employees** — Full CRUD, hourly rate, client assignment, contract type, HR profiles
- **Clients** — Manage client companies with billing currency settings
- **Timesheets** — Review and approve/reject time entries with bulk actions
- **Absences** — Approve or reject absence requests
- **Invoices** — Auto-generate invoices from approved time entries; email payment import
- **Payroll** — Reconciliation view: expected vs actual pay and hours
- **AI Assistant** — Chat with Flow AI for insights across your tenant data

### Candidate Portal
- **Dashboard** — Personal stats (hours, earnings, pending approvals)
- **Log Hours** — Submit daily time entries with project and description
- **My Absences** — Request and track absence history
- **My Invoices** — View invoices; download PDF
- **Resume Builder** — Build and export your CV as PDF

### Client Portal
- **Timesheets** — View and approve candidate hours for billing
- **Invoices** — View and download invoices

## Project Structure

```
Flow/
├── backend/
│   ├── server.js              # Express app, route mounting, startup
│   ├── database.js            # PostgreSQL tenant DDL + provisioning
│   ├── masterDatabase.js      # Master schema (super_admins, tenants, modules)
│   ├── migrate.js             # Incremental migrations per tenant
│   ├── moduleRegistry.js      # Feature module definitions
│   ├── db/
│   │   ├── pool.js            # pg connection pool singleton
│   │   └── wrapper.js         # SQLite-compat wrapper (? → $N, RETURNING id)
│   ├── middleware/
│   │   └── auth.js            # authenticate, requireAdmin, requireSuperAdmin, requireModule
│   ├── routes/                # One file per resource domain
│   └── services/              # llmService, emailPaymentService, cryptoUtils
├── frontend/
│   └── src/
│       ├── pages/admin/       # Admin pages
│       ├── pages/candidate/   # Candidate pages
│       ├── pages/client/      # Client pages
│       ├── pages/superadmin/  # Super-admin pages
│       ├── pages/agrow/       # Field Ops module pages
│       └── components/        # Layout, FlowLogo, AIChatWidget
├── tests/
│   └── e2e/                   # Playwright end-to-end specs
└── package.json               # Root scripts (dev, build, test)
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | JWT signing secret — **change in production** |
| `PORT` | No (3001) | Backend HTTP port |
| `NODE_ENV` | No (development) | `development` or `production` |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS origins |
| `ANTHROPIC_API_KEY` | No | Default AI key (super-admin can override per tenant) |

## Running Tests

```bash
# Full Playwright E2E suite (starts frontend automatically)
npm run test:e2e

# Skip webserver start (if already running)
npm run test:e2e:skip-start

# Mobile viewports only
npm run test:e2e:mobile
```

## Multi-Tenancy

Each organization gets its own PostgreSQL schema (`tenant_{slug}`). All tables, data, and settings are fully isolated. The master schema holds super-admin accounts, tenant records, and module configurations.
