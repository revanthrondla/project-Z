require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const compression  = require('compression');
const morgan       = require('morgan');
const rateLimit    = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path         = require('path');

const authRoutes             = require('./routes/auth');
const candidateRoutes        = require('./routes/candidates');
const clientRoutes           = require('./routes/clients');
const timeEntryRoutes        = require('./routes/timeEntries');
const absenceRoutes          = require('./routes/absences');
const invoiceRoutes          = require('./routes/invoices');
const jobRoutes              = require('./routes/jobs');
const notificationRoutes     = require('./routes/notifications');
const reportRoutes           = require('./routes/reports');
const uploadRoutes           = require('./routes/upload');
const clientPortalRoutes     = require('./routes/clientPortal');
const documentRoutes         = require('./routes/documents');
const superAdminRoutes       = require('./routes/superAdmin');
const settingsRoutes         = require('./routes/settings');
const agrowRoutes            = require('./routes/agrow');
const modulesRoutes          = require('./routes/modules');
const resumesRoutes          = require('./routes/resumes');
const payrollRoutes          = require('./routes/payroll');
const emailPaymentRoutes     = require('./routes/emailPayments');
const supportRoutes          = require('./routes/support');
const platformSupportRoutes  = require('./routes/platformSupport');
const aiChatRoutes           = require('./routes/aiChat');
const employeeProfileRoutes  = require('./routes/employeeProfile');

const app      = express();
const PORT     = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// ── Gzip compression ──────────────────────────────────────────────────────────
app.use(compression());

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:3001'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: NODE_ENV === 'production' ? 5 : 100,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => NODE_ENV === 'test',
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth/login', authLimiter);
app.use('/api', apiLimiter);

// ── Cookie & body parsing ─────────────────────────────────────────────────────
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Request logging ───────────────────────────────────────────────────────────
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── DB readiness gate ─────────────────────────────────────────────────────────
// The HTTP server starts immediately so Railway's healthcheck can pass.
// All /api/* routes except /health return 503 until DB init completes.
let dbReady = false;
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();   // always pass through
  if (!dbReady) {
    return res.status(503).json({
      error: 'Server is initialising. Please retry in a few seconds.',
      retry_after: 10,
    });
  }
  next();
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',              authRoutes);
app.use('/api/super-admin',       superAdminRoutes);
app.use('/api/candidates',        candidateRoutes);
app.use('/api/clients',           clientRoutes);
app.use('/api/time-entries',      timeEntryRoutes);
app.use('/api/absences',          absenceRoutes);
app.use('/api/invoices',          invoiceRoutes);
app.use('/api/jobs',              jobRoutes);
app.use('/api/notifications',     notificationRoutes);
app.use('/api/reports',           reportRoutes);
app.use('/api/upload',            uploadRoutes);
app.use('/api/client-portal',     clientPortalRoutes);
app.use('/api/documents',         documentRoutes);
app.use('/api/settings',          settingsRoutes);
app.use('/api/agrow',             agrowRoutes);
app.use('/api/modules',           modulesRoutes);
app.use('/api/resumes',           resumesRoutes);
app.use('/api/payroll',           payrollRoutes);
app.use('/api/email-payments',    emailPaymentRoutes);
app.use('/api/support',           supportRoutes);
app.use('/api/platform-support',  platformSupportRoutes);
app.use('/api/ai-chat',           aiChatRoutes);
app.use('/api/employees',         employeeProfileRoutes);

// ── Admin dashboard stats ─────────────────────────────────────────────────────
const { authenticate, requireAdmin, injectTenantDb } = require('./middleware/auth');

app.get('/api/dashboard/stats', authenticate, injectTenantDb, requireAdmin, async (req, res) => {
  try {
    const db = req.db;
    const yearMonth = new Date().toISOString().slice(0, 7); // e.g. '2025-06'

    const [
      totalCandidates,
      totalClients,
      pendingTimesheets,
      pendingAbsences,
      monthlyHours,
      revenueThisMonth,
      recentActivity,
    ] = await Promise.all([
      db.prepare("SELECT COUNT(*)::int AS count FROM candidates WHERE status = 'active'").get(),
      db.prepare("SELECT COUNT(*)::int AS count FROM clients").get(),
      db.prepare("SELECT COUNT(*)::int AS count FROM time_entries WHERE status = 'pending'").get(),
      db.prepare("SELECT COUNT(*)::int AS count FROM absences WHERE status = 'pending'").get(),
      db.prepare(`
        SELECT COALESCE(SUM(hours), 0) AS hours FROM time_entries
        WHERE TO_CHAR(date, 'YYYY-MM') = $1 AND status != 'rejected'
      `).get(yearMonth),
      db.prepare(`
        SELECT COALESCE(SUM(total_amount), 0) AS total FROM invoices
        WHERE status = 'paid' AND TO_CHAR(period_start, 'YYYY-MM') = $1
      `).get(yearMonth),
      db.prepare(`
        SELECT 'timesheet' AS type, te.id, c.name AS candidate_name, te.date AS ref_date,
               te.hours || ' hrs - ' || COALESCE(te.project, 'General') AS detail,
               te.status, te.created_at
        FROM time_entries te JOIN candidates c ON te.candidate_id = c.id
        WHERE te.status = 'pending'
        UNION ALL
        SELECT 'absence' AS type, a.id, c.name AS candidate_name, a.start_date AS ref_date,
               a.type || ' (' || a.start_date || ' to ' || a.end_date || ')' AS detail,
               a.status, a.created_at
        FROM absences a JOIN candidates c ON a.candidate_id = c.id
        WHERE a.status = 'pending'
        ORDER BY 7 DESC LIMIT 10
      `).all(),
    ]);

    // Support ticket metrics — only if hr_support module enabled
    let openSupportTickets = { count: 0 }, urgentSupportTickets = { count: 0 };
    try {
      const { masterDb: mDb, seedDefaultModulesForTenant } = require('./masterDatabase');
      const { MODULE_REGISTRY: MR } = require('./moduleRegistry');
      const slug = req.user.tenantSlug;
      if (slug) {
        try { await seedDefaultModulesForTenant(slug); } catch {}
        const modRow = await mDb
          .prepare('SELECT enabled FROM tenant_modules WHERE tenant_slug = $1 AND module_key = $2')
          .get(slug, 'hr_support');
        const supportEnabled = modRow !== undefined && modRow !== null
          ? modRow.enabled
          : (MR.find(m => m.key === 'hr_support')?.default ?? true);

        if (supportEnabled) {
          [openSupportTickets, urgentSupportTickets] = await Promise.all([
            db.prepare("SELECT COUNT(*)::int AS count FROM support_tickets WHERE status IN ('open','in_progress')").get(),
            db.prepare("SELECT COUNT(*)::int AS count FROM support_tickets WHERE status != 'closed' AND priority IN ('urgent','high')").get(),
          ]);
        }
      }
    } catch { /* table may not exist yet on first boot */ }

    res.json({
      totalCandidates:     totalCandidates.count,
      totalClients:        totalClients.count,
      pendingTimesheets:   pendingTimesheets.count,
      pendingAbsences:     pendingAbsences.count,
      monthlyHours:        monthlyHours.hours,
      revenueThisMonth:    revenueThisMonth.total,
      openSupportTickets:  openSupportTickets.count,
      urgentSupportTickets: urgentSupportTickets.count,
      recentActivity,
    });
  } catch (err) {
    console.error('[dashboard/stats]', err.message);
    res.status(500).json({ error: 'Failed to load dashboard stats' });
  }
});

// ── Health check (exempt from dbReady gate) ───────────────────────────────────
app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  db_ready: dbReady,
  timestamp: new Date().toISOString(),
  env: NODE_ENV,
  uptime: process.uptime(),
}));

// ── Serve React frontend (SPA) ────────────────────────────────────────────────
const FRONTEND_DIST = path.join(__dirname, '../frontend/dist');
app.use(express.static(FRONTEND_DIST, {
  maxAge: NODE_ENV === 'production' ? '1d' : 0,
  etag: true,
}));
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
  if (NODE_ENV !== 'production') console.error(err.stack);
  res.status(err.status || 500).json({
    error: NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ── Licence expiry notification check ────────────────────────────────────────
async function checkLicenceExpiry() {
  const { createNotification } = require('./routes/notifications');
  const { getTenantDb }        = require('./database');
  const { masterDb: licMasterDb } = require('./masterDatabase');
  const today = new Date().toISOString().split('T')[0];

  const tenants = await licMasterDb
    .prepare("SELECT slug FROM tenants WHERE status = $1")
    .all('active');

  for (const tenant of tenants) {
    try {
      const db = await getTenantDb(tenant.slug);
      if (!db) continue;

      const expiring = await db.prepare(`
        SELECT el.*, c.name AS employee_name, c.id AS cand_id
        FROM employee_licenses el
        JOIN candidates c ON c.id = el.candidate_id
        WHERE el.expiry_date IS NOT NULL
          AND el.expiry_date >= $1::date
          AND el.expiry_date <= ($1::date + el.reminder_days_before * INTERVAL '1 day')
          AND (el.reminded_at IS NULL OR el.reminded_at::date < $1::date)
          AND c.deleted_at IS NULL
      `).all(today);

      const expired = await db.prepare(`
        SELECT el.*, c.name AS employee_name, c.id AS cand_id
        FROM employee_licenses el
        JOIN candidates c ON c.id = el.candidate_id
        WHERE el.expiry_date IS NOT NULL
          AND el.expiry_date < $1::date
          AND el.status != 'expired'
          AND c.deleted_at IS NULL
      `).all(today);

      for (const lic of expired) {
        await db.prepare(
          "UPDATE employee_licenses SET status = 'expired', updated_at = NOW() WHERE id = $1"
        ).run(lic.id);
      }

      if (expiring.length === 0 && expired.length === 0) continue;

      const admins = await db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
      for (const admin of admins) {
        for (const lic of expiring) {
          const daysLeft = Math.ceil((new Date(lic.expiry_date) - new Date(today)) / 86400000);
          createNotification(
            db, admin.id,
            'warning',
            `Licence Expiring Soon — ${lic.employee_name}`,
            `${lic.document_type} expires in ${daysLeft} day(s) on ${lic.expiry_date}`,
            `/employees/${lic.cand_id}?tab=licenses`,
            'licence_expiry'
          );
          await db.prepare(
            'UPDATE employee_licenses SET reminded_at = NOW() WHERE id = $1'
          ).run(lic.id);
        }
        for (const lic of expired) {
          createNotification(
            db, admin.id,
            'error',
            `Licence Expired — ${lic.employee_name}`,
            `${lic.document_type} expired on ${lic.expiry_date} — action required`,
            `/employees/${lic.cand_id}?tab=licenses`,
            'licence_expired'
          );
        }
      }
    } catch (err) {
      console.error(`[LicenceCheck] Error for tenant ${tenant.slug}:`, err.message);
    }
  }
  console.log(`🔖 Licence expiry check completed at ${new Date().toISOString()}`);
}

// ── Email inbox auto-poll (cron) ──────────────────────────────────────────────
function startEmailPoller() {
  const cron = require('node-cron');
  const { pollInbox }  = require('./services/emailPaymentService');
  const { decrypt }    = require('./services/cryptoUtils');
  const { getTenantDb } = require('./database');
  const { masterDb }   = require('./masterDatabase');

  cron.schedule('*/5 * * * *', async () => {
    try {
      const tenants = await masterDb
        .prepare("SELECT slug FROM tenants WHERE status = 'active'")
        .all();

      for (const tenant of tenants) {
        try {
          const db = await getTenantDb(tenant.slug);
          let s = await db.prepare('SELECT * FROM email_settings WHERE id = 1').get();
          if (!s || !s.enabled || !s.imap_user || !s.imap_password) continue;

          s = { ...s, imap_password: decrypt(s.imap_password) };
          const intervalMs = (s.poll_interval || 30) * 60 * 1000;
          const lastPolled = s.last_polled_at ? new Date(s.last_polled_at).getTime() : 0;
          if (Date.now() - lastPolled < intervalMs) continue;

          console.log(`📧 [EmailPoll] Polling inbox for tenant: ${tenant.slug}`);
          const result = await pollInbox(s, db);
          if (result.processed > 0) {
            console.log(`📧 [EmailPoll] ${tenant.slug}: ${result.processed} new payment email(s) imported`);
          }
          if (result.errors?.length) {
            console.warn(`📧 [EmailPoll] ${tenant.slug} errors:`, result.errors);
            try {
              const { createNotification } = require('./routes/notifications');
              const admins = await db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
              const errSummary = result.errors.slice(0, 3).join('; ');
              for (const admin of admins) {
                createNotification(
                  db, admin.id,
                  'error',
                  'Email Inbox Poll Failed',
                  `${result.errors.length} error(s) while polling email inbox: ${errSummary}`,
                  null, 'email_poll'
                );
              }
            } catch (notifErr) {
              console.error('[EmailPoll] Could not create admin notification:', notifErr.message);
            }
          }
        } catch (tenantErr) {
          console.error(`[EmailPoll] Error for tenant ${tenant.slug}:`, tenantErr.message);
        }
      }
    } catch (err) {
      console.error('[EmailPoll] Scheduler error:', err.message);
    }
  });
  console.log('📧 Email payment auto-poll scheduler started (checks every 5 min)');
}

// ── Async startup ─────────────────────────────────────────────────────────────
async function start() {
  // ── Step 1: Bind HTTP port FIRST ─────────────────────────────────────────
  // Railway (and Docker) healthchecks fire as soon as the container starts.
  // We listen immediately so /api/health returns 200 right away.
  // All other /api/* routes return 503 via the dbReady gate above until
  // the database is fully initialised.
  await new Promise((resolve, reject) => {
    const server = app.listen(PORT, resolve);
    server.on('error', reject);
  });
  console.log(`\n🚀 Flow HTTP listening on port ${PORT} [${NODE_ENV}] — DB initialising…`);

  // ── Step 2: Initialise database ───────────────────────────────────────────
  try {
    const { initMaster } = require('./masterDatabase');
    await initMaster();

    const { runAllMigrations } = require('./migrate');
    await runAllMigrations();

    // ── Step 3: Open all routes ───────────────────────────────────────────
    dbReady = true;
    console.log('✅ Database ready — all API routes are now open');

    if (NODE_ENV !== 'production') {
      console.log('\n📝 Test accounts:');
      console.log('   Admin:     admin@hireiq.com  / admin123  (tenant: hireiq)');
      console.log('   Candidate: alice@hireiq.com  / candidate123  (tenant: hireiq)\n');
    }

    // ── Step 4: Start background jobs ─────────────────────────────────────
    startEmailPoller();

    checkLicenceExpiry().catch(err =>
      console.error('[LicenceCheck] Startup check failed:', err.message)
    );
    setInterval(() => {
      checkLicenceExpiry().catch(err =>
        console.error('[LicenceCheck] Scheduled check failed:', err.message)
      );
    }, 24 * 60 * 60 * 1000);

  } catch (err) {
    console.error('[FATAL] DB initialisation failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

start();
