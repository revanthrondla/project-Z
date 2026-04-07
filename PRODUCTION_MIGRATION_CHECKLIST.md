# HireIQ — Production Deployment Checklist
**Updated:** 2026-04-05
**App Version:** 1.2.0
**Stack:** Node.js 20 · Express 4 · SQLite (node:sqlite) · React 18 · Vite · Tailwind 3 · Docker

---

## Legend
- `[ ]` Action required before go-live
- `[x]` Already done / built into the codebase
- `⚠️` High priority / security-critical

---

## 1. ENVIRONMENT & SECRETS

- [ ] ⚠️ Copy `backend/.env.example` → `backend/.env` and fill in **all** values
- [ ] ⚠️ Generate and set `JWT_SECRET` (64-byte random hex):
  ```bash
  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
  ```
- [ ] ⚠️ Generate and set `ENCRYPTION_KEY` (32-byte random hex — required for email payment polling):
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- [ ] Set `NODE_ENV=production`
- [ ] Set `HIREIQ_DATA_DIR=/data` (matches the Docker volume mount path)
- [ ] Set `HIREIQ_DB_PATH=/data/hireiq.db`
- [ ] Set `ALLOWED_ORIGINS` to your production domain(s):
  ```
  ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
  ```
- [ ] If using the **AI Assistant module**: set `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY`
- [ ] Ensure `.env` is in `.gitignore` and **never committed** to version control
- [ ] For PaaS (Railway/Render): set all secrets via the platform's environment variable UI — do not commit them

---

## 2. INFRASTRUCTURE — CHOOSE ONE PATH

### Path A: PaaS (Railway or Render) — Recommended for most teams

#### Railway
- [ ] Push code to GitHub
- [ ] Create a new Railway project → "Deploy from GitHub repo"
- [ ] Railway auto-detects `railway.json` and `Dockerfile` — no extra config needed
- [ ] Add environment variables in Railway dashboard (Settings → Variables):
  - `JWT_SECRET`, `ENCRYPTION_KEY`, `ALLOWED_ORIGINS`, `ANTHROPIC_API_KEY` (if using AI)
- [ ] Add a **Volume** in Railway dashboard and set mount path to `/data`
- [ ] Set a custom domain in Railway → Settings → Networking
- [ ] Railway handles SSL automatically via Let's Encrypt

#### Render
- [ ] Push code to GitHub
- [ ] Connect repo in Render dashboard — Render auto-detects `render.yaml`
- [ ] Set secret env vars in Render dashboard (marked `sync: false` in `render.yaml`):
  - `JWT_SECRET`, `ENCRYPTION_KEY`, `ANTHROPIC_API_KEY` (if using AI)
- [ ] Render persistent disk is configured in `render.yaml` (5 GB at `/data`)
- [ ] Set custom domain in Render → Settings → Custom Domains
- [ ] Render handles SSL automatically

---

### Path B: Self-Hosted Docker (VPS / EC2 / DigitalOcean)

- [ ] Provision server: minimum **1 vCPU · 1 GB RAM · 20 GB disk** (SSD preferred)
- [ ] Install Docker Engine:
  ```bash
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER
  ```
- [ ] Install Docker Compose v2:
  ```bash
  sudo apt-get install docker-compose-plugin
  ```
- [ ] Clone the repo:
  ```bash
  git clone https://github.com/YOUR_ORG/hireiq.git /opt/hireiq
  cd /opt/hireiq
  ```
- [ ] Create `.env` from example and fill in all values:
  ```bash
  cp backend/.env.example backend/.env
  nano backend/.env
  ```
- [ ] Create a `docker-compose.override.yml` (optional) for host-specific overrides
- [ ] Pull and start:
  ```bash
  docker compose pull   # or: docker compose build
  docker compose up -d
  ```
- [ ] Verify health:
  ```bash
  docker compose ps
  curl http://localhost:3001/api/health
  ```
- [ ] Open firewall: only ports **80** and **443** externally; block port 3001 from public access
- [ ] Configure Nginx reverse proxy with SSL (see `nginx/nginx.conf` template in repo):
  - Replace `YOUR_DOMAIN` in `nginx/nginx.conf`
  - Obtain Let's Encrypt cert:
    ```bash
    docker compose run --rm certbot certonly --webroot -w /var/www/certbot -d YOUR_DOMAIN
    ```
  - Uncomment the HTTPS server block in `nginx/nginx.conf`
  - Reload Nginx: `docker compose exec nginx nginx -s reload`
- [ ] Enable Docker restart policy (already set `restart: unless-stopped` in `docker-compose.yml`)
- [ ] Set up log rotation for Docker JSON logs (already capped at 10 MB × 5 files in `docker-compose.yml`)

---

## 3. DATABASE & MIGRATIONS

- [x] Migrations run **automatically at startup** via `migrate.js` — idempotent, safe to re-run
- [x] Master database (`master.db`) and per-tenant databases provisioned on first startup
- [x] **All 31 migrations included** — current schema version includes:
  - Core tables: `users`, `candidates`, `clients`, `time_entries`, `absences`, `invoices`, `jobs`, `notifications`, `documents`, `settings`
  - Module tables: `support_tickets`, `support_messages`, `platform_ai_config`, `ai_documents`, `ai_document_chunks`, `email_settings`, `email_payment_events`
  - Employee profile tables (migrations 21–31): `employee_contact_ext`, `emergency_contacts`, `employment_history`, `bank_accounts`, `leave_balances`, `employee_assets`, `employee_benefits`, `performance_reviews`, `training_records`, `employee_licenses`
  - Payroll: `payroll_runs`, `payroll_entries`
  - Multi-tenancy master tables: `tenants`, `tenant_modules`
- [ ] ⚠️ Set up **automated database backups** — SQLite `.backup` command is safe to run on a live database:
  ```bash
  # Daily backup cron — add to host crontab or a cron container
  0 2 * * * docker compose -f /opt/hireiq/docker-compose.yml exec -T app \
    sqlite3 /data/hireiq.db ".backup /data/backups/hireiq-$(date +\%Y\%m\%d).db" && \
    find /opt/hireiq/data/backups -name "*.db" -mtime +30 -delete
  ```
- [ ] Test backup restore before go-live:
  ```bash
  sqlite3 /data/backups/hireiq-YYYYMMDD.db "SELECT COUNT(*) FROM users;"
  ```
- [x] SQLite WAL mode enabled automatically — supports concurrent reads with one writer
- [ ] ⚠️ Do **not** run multiple Node.js instances pointing at the same SQLite file (SQLite is single-writer). Scale vertically, not horizontally.
- [ ] Back up per-tenant databases stored in `HIREIQ_DATA_DIR/tenants/` in addition to the master DB

---

## 4. DOCKER IMAGE & BUILD

- [x] Multi-stage `Dockerfile` in repo root:
  - Stage 1: `node:20-alpine` builds the React frontend (`npm run build`)
  - Stage 2: Production image copies built frontend into `frontend/dist/` and installs only `--omit=dev` backend deps
- [x] `.dockerignore` excludes: `node_modules`, `*.db`, `data/`, `.env`, `tests/`, `docs/`
- [x] Container runs as non-root user `hireiq` (security best practice)
- [x] Health check configured: `GET /api/health` every 30 s
- [x] `restart: unless-stopped` in `docker-compose.yml` (equivalent to PM2 auto-restart)
- [ ] Build the image locally to verify before deploying:
  ```bash
  docker build -t hireiq:latest .
  docker run --rm -p 3001:3001 -e JWT_SECRET=test -e NODE_ENV=production hireiq:latest
  curl http://localhost:3001/api/health
  ```

---

## 5. SECURITY

- [x] **Helmet** — HTTP security headers (X-Frame-Options, HSTS, X-Content-Type-Options, etc.)
- [x] **CORS** — Configurable via `ALLOWED_ORIGINS` env var; rejects all unlisted origins
- [x] **Rate limiting** — Login: 5 req/15 min per IP (prod) · API: 300 req/min per IP
- [x] **JWT authentication** — All protected API routes require a valid Bearer token
- [x] **Role-based access** — `super_admin`, `admin`, `candidate`, `client` roles enforced per route
- [x] **Multi-tenant isolation** — Each tenant has a separate SQLite database; `injectTenantDb` middleware enforces tenant scoping
- [x] **Parameterized SQL** — All queries use `db.prepare()` with bound params (no SQL injection risk)
- [x] **Password hashing** — bcryptjs with cost factor 10
- [x] **Bank account masking** — Only last 4 digits returned in API responses
- [x] **Encrypted IMAP passwords** — Stored using AES-256 via `ENCRYPTION_KEY`
- [x] **Global error handler** — Stack traces hidden in production
- [ ] ⚠️ **Change the default super-admin password** after first login
- [ ] ⚠️ **Change default tenant admin passwords** before sharing access
- [ ] ⚠️ **Change or disable seeded test accounts** (`alice@hireiq.com`) in production tenants
- [ ] ⚠️ Ensure `JWT_SECRET` and `ENCRYPTION_KEY` are stored securely (platform secrets, not in code)
- [ ] Enable **HTTPS** before any real user data is entered (SSL via platform or Nginx + Let's Encrypt)
- [ ] Consider adding input validation middleware (`zod` or `express-validator`) on high-risk routes
- [ ] Review and audit `ALLOWED_ORIGINS` — remove `localhost` entries in production

---

## 6. MULTI-TENANCY

- [x] Master database (`master.db`) tracks all tenants in the `tenants` table
- [x] Per-tenant databases stored at `HIREIQ_DATA_DIR/tenants/{slug}.db`
- [x] `injectTenantDb` middleware resolves `req.db` from the authenticated user's `tenantSlug`
- [x] Tenant provisioning: creates DB, runs migrations, seeds admin user, sets default modules
- [x] Module registry (`moduleRegistry.js`) — 14 toggleable modules with defaults
- [x] `tenant_modules` table in master DB stores per-tenant module overrides
- [ ] Create your first production tenant via the Super Admin dashboard (`/super-admin/tenants`)
- [ ] Set module enablement for each tenant based on their subscription tier
- [ ] Verify tenant isolation: an authenticated user from Tenant A cannot access Tenant B's data

---

## 7. MODULES VERIFIED

| Module Key | Feature | Status |
|---|---|---|
| `hr_candidates` | Employee management + profiles | ✅ |
| `hr_clients` | Client management | ✅ |
| `hr_timesheets` | Time entry + approval workflow | ✅ |
| `hr_absences` | Absence management | ✅ |
| `hr_invoices` | Invoice lifecycle + client portal | ✅ |
| `hr_jobs` | Job postings + applications | ✅ |
| `hr_documents` | Document storage per role | ✅ |
| `hr_reports` | Hours, revenue, absence reports | ✅ |
| `hr_import` | CSV bulk import (7 entity types) | ✅ |
| `hr_support` | Support ticket system | ✅ |
| `ai_assistant` | AI chat + knowledge base RAG | ✅ |
| `agrow_scan` | Field scan (aGrow vertical) | ✅ |
| `agrow_analytics` | Field analytics | ✅ |
| `agrow_employees` | aGrow employee management | ✅ |

---

## 8. EMPLOYEE PROFILE FEATURES (NEW in v1.2.0)

- [x] 10-tab employee profile system at `/employees/:id`
- [x] Contact details (extended: alt phone, personal email, home address)
- [x] Emergency contacts
- [x] Position & salary history (visual timeline)
- [x] Bank accounts (last 4 digits only in API responses)
- [x] Leave balances (cross-referenced with approved absences)
- [x] Company assets
- [x] Benefits
- [x] Performance reviews (star rating 1–5)
- [x] Training records
- [x] Licences & permits with expiry tracking + urgency badges
- [x] Licence expiry notifications: startup check + 24 h interval, push to admin notifications
- [x] Employee profile summary endpoint (`/api/employees/:id/summary`) aggregates warnings
- [x] CSV import extended: `emergency_contacts`, `employment_history`, `training_records`
- [ ] Confirm licence reminder window (`reminder_days_before`) is set appropriately per licence type

---

## 9. BACKGROUND JOBS

- [x] **Email payment polling** — cron runs every 5 min; skips tenants where polling is disabled or interval not elapsed
- [x] **Licence expiry check** — runs at startup and every 24 h; marks expired licences, notifies admins
- [x] Both jobs are in-process (Node.js `setInterval` / `node-cron`) — no external job queue required
- [ ] Verify email polling works end-to-end if you use the Email Payments module (configure in Settings → Email)
- [ ] Monitor notification volume — licence reminders fire once per day per admin per expiring licence

---

## 10. FRONTEND BUILD

- [x] Vite production build — output to `frontend/dist/`
- [x] SPA routing — all non-API `GET` requests return `index.html` (handled in `server.js`)
- [x] Static file caching — `1d` cache headers in production
- [x] Gzip compression — via `compression` middleware (~70% size reduction)
- [x] Module-gated routes — disabled modules show a "🔒 Module Not Enabled" screen
- [x] Role-aware routing — same URL shows different pages per user role (admin vs candidate vs client)
- [ ] Update page `<title>` in `frontend/index.html` if desired
- [ ] Add a `favicon.ico` to `frontend/public/`
- [ ] Consider adding a `robots.txt` (public app → allow; internal app → disallow all)
- [ ] Run `npm run build` in `frontend/` and commit the resulting `dist/` only if NOT using Docker build

---

## 11. POST-LAUNCH CHECKLIST

- [ ] Verify SSL certificate (`https://yourdomain.com` shows green padlock)
- [ ] Test all role logins: super_admin → admin → candidate → client
- [ ] Test CSV import for each of the 7 entity types with sample data
- [ ] Test invoice lifecycle: create → send → client approve → mark paid
- [ ] Test absence approval workflow end-to-end
- [ ] Test timesheet submit → admin approve
- [ ] Test AI assistant (if enabled): upload a document, ask a question
- [ ] Test support ticket creation and admin response
- [ ] Set up uptime monitoring on `GET /api/health` (UptimeRobot, BetterStack, etc.)
- [ ] Configure external log aggregation if needed (Papertrail, Logtail, Datadog, etc.)
- [ ] Schedule regular database backups and test a restore
- [ ] Review rate limit thresholds after seeing real traffic patterns
- [ ] Enable Render/Railway auto-deploy on push to `main` branch (already default behavior)

---

## 12. DEPLOYMENT COMMANDS — DOCKER SELF-HOSTED

```bash
# First-time setup
git clone https://github.com/YOUR_ORG/hireiq.git /opt/hireiq && cd /opt/hireiq
cp backend/.env.example backend/.env && nano backend/.env
docker compose up -d --build
docker compose logs -f app   # watch startup + migrations

# Health check
curl http://localhost:3001/api/health

# View running containers
docker compose ps

# Restart app only (e.g. after env var change)
docker compose restart app

# Full redeploy after code push
git pull
docker compose up -d --build
docker compose logs -f app

# Database backup (manual)
docker compose exec app sqlite3 /data/hireiq.db ".backup /data/backups/hireiq-manual.db"

# View logs
docker compose logs app --tail 100 -f
```

---

## SUMMARY TABLE

| Category | Status | Notes |
|---|---|---|
| Docker multi-stage build | ✅ Done | `Dockerfile` in repo root |
| Docker Compose config | ✅ Done | Named volumes, health check, log rotation |
| Railway deployment config | ✅ Done | `railway.json` |
| Render deployment config | ✅ Done | `render.yaml` with persistent disk |
| Nginx config (self-hosted) | ✅ Done | `nginx/nginx.conf` template |
| Environment variables | ✅ Done | `backend/.env.example` fully updated |
| Multi-tenancy | ✅ Done | Separate DB per tenant |
| Employee profile system | ✅ Done | 10 HR data categories, 31 migrations |
| Module system | ✅ Done | 14 modules, per-tenant toggles |
| Background jobs | ✅ Done | Email poll + licence expiry check |
| JWT secret rotation | ⚠️ Required | Generate before go-live |
| Encryption key | ⚠️ Required | Generate before go-live (email payments) |
| Default password change | ⚠️ Required | Admin + test accounts |
| Database backups | ⚠️ Required | Schedule before go-live |
| SSL/TLS | ⚠️ Required | Via platform or Let's Encrypt |
| Custom domain | ⚠️ Required | Set in platform + ALLOWED_ORIGINS |
| AI API keys | Optional | Required only if ai_assistant module enabled |
