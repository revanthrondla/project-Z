# HireIQ — Time Tracking & Invoice Management

A full-stack web application for staffing agencies to track candidate hours, manage absences, and generate invoices.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + Tailwind CSS |
| Backend | Node.js + Express |
| Database | Built-in Node.js SQLite (`node:sqlite`) — no extra packages needed |
| Auth | JWT (JSON Web Tokens) |

## Prerequisites

- **Node.js v22+** (required for built-in SQLite support)
- npm

## Quick Start

```bash
# 1. Install all dependencies
npm run install:all

# 2. Start both servers
npm run dev
```

Or use the startup script:
```bash
bash start.sh
```

Then open **http://localhost:5173** in your browser.

## Demo Accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@hireiq.com | admin123 |
| Candidate (Dev) | alice@hireiq.com | candidate123 |
| Candidate (Design) | bob@hireiq.com | candidate123 |
| Candidate (PM) | carol@hireiq.com | candidate123 |
| Candidate (Analyst) | david@hireiq.com | candidate123 |

## Features

### Admin Portal
- **Dashboard** — KPI overview (active candidates, pending approvals, monthly hours, revenue)
- **Candidates** — Full CRUD, hourly rate management, client assignment, contract type
- **Clients** — Manage client companies with billing currency settings
- **Timesheets** — Review and approve/reject time entries with bulk actions
- **Absences** — Approve or reject absence requests (vacation, sick, personal, etc.)
- **Invoices** — Auto-generate invoices from approved time entries, print/export

### Candidate Portal
- **Dashboard** — Personal stats (hours, earnings, pending approvals)
- **Log Hours** — Submit daily time entries with project and description
- **My Absences** — Request and track absence history
- **My Invoices** — View invoices and print them

## Project Structure

```
HireIQ/
├── backend/
│   ├── server.js          # Express app & routes
│   ├── database.js        # SQLite setup & seed data
│   ├── middleware/
│   │   └── auth.js        # JWT middleware
│   └── routes/
│       ├── auth.js        # Login, me, change-password
│       ├── candidates.js  # Candidate CRUD + stats
│       ├── clients.js     # Client CRUD
│       ├── timeEntries.js # Time entry CRUD + bulk approve
│       ├── absences.js    # Absence CRUD
│       └── invoices.js    # Invoice generation & management
├── frontend/
│   └── src/
│       ├── pages/admin/   # Admin pages
│       ├── pages/candidate/ # Candidate pages
│       └── components/    # Shared layout components
└── start.sh               # Startup script
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Authenticate user |
| GET | `/api/candidates` | List candidates |
| POST | `/api/candidates` | Add candidate |
| GET | `/api/clients` | List clients |
| GET | `/api/time-entries` | List time entries (filterable) |
| POST | `/api/time-entries` | Log hours |
| POST | `/api/time-entries/bulk-approve` | Bulk approve/reject |
| GET | `/api/absences` | List absences |
| POST | `/api/invoices/generate` | Auto-generate invoice from approved entries |
| GET | `/api/dashboard/stats` | Admin dashboard statistics |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Backend port |
| `JWT_SECRET` | `hireiq-secret-key-2024` | JWT signing secret (change in production!) |
| `HIREIQ_DB_PATH` | `./backend/hireiq.db` | SQLite database path |

## Data Persistence

The SQLite database is stored at `backend/hireiq.db` and persists all data between restarts. Delete this file to reset to the seed data.
