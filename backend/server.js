require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const compression  = require('compression');
const morgan       = require('morgan');
const rateLimit    = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path         = require('path');

// Initialize master DB + default tenant DB at startup
require('./masterDatabase');
require('./database');

const authRoutes        = require('./routes/auth');
const candidateRoutes   = require('./routes/candidates');
const clientRoutes      = require('./routes/clients');
const timeEntryRoutes   = require('./routes/timeEntries');
const absenceRoutes     = require('./routes/absences');
const invoiceRoutes     = require('./routes/invoices');
const jobRoutes         = require('./routes/jobs');
const notificationRoutes = require('./routes/notifications');
const reportRoutes      = require('./routes/reports');
const uploadRoutes      = require('./routes/upload');
const clientPortalRoutes = require('./routes/clientPortal');
const documentRoutes    = require('./routes/documents');
const superAdminRoutes  = require('./routes/superAdmin');
const settingsRoutes    = require('./routes/settings');
const agrowRoutes       = require('./routes/agrow');
const modulesRoutes     = require('./routes/modules');
const resumesRoutes       = require('./routes/resumes');
const payrollRoutes       = require('./routes/payroll');
const emailPaymentRoutes  = require('./routes/emailPayments');
const supportRoutes         = require('./routes/support');
const platformSupportRoutes = require('./routes/platformSupport');
const aiChatRoutes          = require('./routes/aiChat');
const employeeProfileRoutes = require('./routes/employeeProfile');

const app = express();
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Disabled so React SPA can load inline scripts
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
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: NODE_ENV === 'production' ? 5 : 100, // relaxed in dev/test so repeated logins don't lock you out
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => NODE_ENV === 'test', // skip entirely during automated tests
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 300,             // 300 requests/min per IP
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth/login', authLimiter); // rate-limit login only, not /me, /logout, /change-password
app.use('/api', apiLimiter);

// ── Cookie parsing (must be before routes so req.cookies is populated) ────────
app.use(cookieParser());

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Request logging ───────────────────────────────────────────────────────────
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/super-admin',   superAdminRoutes);
app.use('/api/candidates',    candidateRoutes);
app.use('/api/clients',       clientRoutes);
app.use('/api/time-entries',  timeEntryRoutes);
app.use('/api/absences',      absenceRoutes);
app.use('/api/invoices',      invoiceRoutes);
app.use('/api/jobs',          jobRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reports',       reportRoutes);
app.use('/api/upload',        uploadRoutes);
app.use('/api/client-portal', clientPortalRoutes);
app.use('/api/documents',     documentRoutes);
app.use('/api/settings',      settingsRoutes);
app.use('/api/agrow',         agrowRoutes);
app.use('/api/modules',       modulesRoutes);
app.use('/api/resumes',        resumesRoutes);
app.use('/api/payroll',        payrollRoutes);
app.use('/api/email-payments',    emailPaymentRoutes);
app.use('/api/support',           supportRoutes);
app.use('/api/platform-support',  platformSupportRoutes);
app.use('/api/ai-chat',           aiChatRoutes);
app.use('/api/employees',         employeeProfileRoutes);

// ── Admin dashboard stats ─────────────────────────────────────────────────────
const { authenticate, requireAdmin, injectTenantDb } = require('./middleware/auth');

app.get('/api/dashboard/stats', authenticate, injectTenantDb, requireAdmin, (req, res) => {
  const db = req.db;
  const totalCandidates = db.prepare("SELECT COUNT(*) as count FROM candidates WHERE status = 'active'").get();
  const totalClients = db.prepare("SELECT COUNT(*) as count FROM clients").get();
  const pendingTimesheets = db.prepare("SELECT COUNT(*) as count FROM time_entries WHERE status = 'pending'").get();
  const pendingAbsences = db.prepare("SELECT COUNT(*) as count FROM absences WHERE status = 'pending'").get();
  const monthlyHours = db.prepare(`
    SELECT COALESCE(SUM(hours), 0) as hours FROM time_entries
    WHERE date LIKE ? AND status != 'rejected'
  `).get(`${new Date().toISOString().slice(0, 7)}%`);
  const revenueThisMonth = db.prepare(`
    SELECT COALESCE(SUM(total_amount), 0) as total FROM invoices
    WHERE status = 'paid' AND period_start LIKE ?
  `).get(`${new Date().toISOString().slice(0, 7)}%`);
  const recentActivity = db.prepare(`
    SELECT 'timesheet' as type, te.id, c.name as candidate_name, te.date as ref_date,
           te.hours || ' hrs - ' || COALESCE(te.project, 'General') as detail, te.status, te.created_at
    FROM time_entries te JOIN candidates c ON te.candidate_id = c.id
    WHERE te.status = 'pending'
    UNION ALL
    SELECT 'absence' as type, a.id, c.name as candidate_name, a.start_date as ref_date,
           a.type || ' (' || a.start_date || ' to ' || a.end_date || ')' as detail, a.status, a.created_at
    FROM absences a JOIN candidates c ON a.candidate_id = c.id
    WHERE a.status = 'pending'
    ORDER BY 7 DESC LIMIT 10
  `).all();

  // Support ticket metrics — only if hr_support module is enabled for this tenant
  let openSupportTickets = { count: 0 }, urgentSupportTickets = { count: 0 };
  try {
    const { masterDb: mDb, seedDefaultModulesForTenant } = require('./masterDatabase');
    const { MODULE_REGISTRY: MR } = require('./moduleRegistry');
    const slug = req.user.tenantSlug;
    if (slug) {
      try { seedDefaultModulesForTenant(slug); } catch {}
      const modRow = mDb
        .prepare('SELECT enabled FROM tenant_modules WHERE tenant_slug = ? AND module_key = ?')
        .get(slug, 'hr_support');
      const supportEnabled = modRow !== undefined
        ? modRow.enabled
        : (MR.find(m => m.key === 'hr_support')?.default ?? true);

      if (supportEnabled) {
        openSupportTickets   = db.prepare("SELECT COUNT(*) as count FROM support_tickets WHERE status IN ('open','in_progress')").get();
        urgentSupportTickets = db.prepare("SELECT COUNT(*) as count FROM support_tickets WHERE status != 'closed' AND priority IN ('urgent','high')").get();
      }
    }
  } catch { /* table may not exist yet on first boot before migration */ }

  res.json({
    totalCandidates: totalCandidates.count,
    totalClients: totalClients.count,
    pendingTimesheets: pendingTimesheets.count,
    pendingAbsences: pendingAbsences.count,
    monthlyHours: monthlyHours.hours,
    revenueThisMonth: revenueThisMonth.total,
    openSupportTickets: openSupportTickets.count,
    urgentSupportTickets: urgentSupportTickets.count,
    recentActivity
  });
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({
  status: 'ok',
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

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 aGrow running on http://localhost:${PORT} [${NODE_ENV}]`);
  if (NODE_ENV !== 'production') {
    console.log('\n📝 Test accounts:');
    console.log('   Admin:     admin@hireiq.com  / admin123');
    console.log('   Candidate: alice@hireiq.com  / candidate123\n');
  }

  // ── Auto-poll email inbox on a configurable schedule ───────────────────────
  const cron = require('node-cron');
  const { pollInbox } = require('./services/emailPaymentService');
  const { decrypt } = require('./services/cryptoUtils');
  const { getTenantDb } = require('./database');
  const { masterDb } = require('./masterDatabase');

  // Run every 5 minutes; actual poll only happens if tenant has polling enabled
  // and their interval has elapsed since last_polled_at.
  cron.schedule('*/5 * * * *', async () => {
    try {
      const tenants = masterDb.prepare("SELECT slug FROM tenants WHERE status = 'active'").all();
      for (const tenant of tenants) {
        const db = getTenantDb(tenant.slug);
        const s  = db.prepare('SELECT * FROM email_settings WHERE id = 1').get();
        if (!s || !s.enabled || !s.imap_user || !s.imap_password) continue;
        // Decrypt stored IMAP password before passing to the IMAP client
        s = { ...s, imap_password: decrypt(s.imap_password) };

        // Check if poll interval has elapsed
        const intervalMs   = (s.poll_interval || 30) * 60 * 1000;
        const lastPolled   = s.last_polled_at ? new Date(s.last_polled_at).getTime() : 0;
        if (Date.now() - lastPolled < intervalMs) continue;

        console.log(`📧 [EmailPoll] Polling inbox for tenant: ${tenant.slug}`);
        const result = await pollInbox(s, db);
        if (result.processed > 0) {
          console.log(`📧 [EmailPoll] ${tenant.slug}: ${result.processed} new payment email(s) imported`);
        }
        if (result.errors?.length) {
          console.warn(`📧 [EmailPoll] ${tenant.slug} errors:`, result.errors);

          // Surface the failure to all admins via the in-app notification system
          try {
            const { createNotification } = require('./routes/notifications');
            const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
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
      }
    } catch (err) {
      console.error('[EmailPoll] Scheduler error:', err.message);
    }
  });
  console.log('📧 Email payment auto-poll scheduler started (checks every 5 min)');
});

// ── Licence expiry notification check (runs on startup + daily) ───────────────
async function checkLicenceExpiry() {
  const { createNotification } = require('./routes/notifications');
  const today = new Date().toISOString().split('T')[0];

  const { getTenantDb } = require('./database');
  const { masterDb: licMasterDb } = require('./masterDatabase');
  for (const tenant of licMasterDb.prepare('SELECT slug FROM tenants WHERE status = ?').all('active')) {
    try {
      const db = getTenantDb(tenant.slug);
      if (!db) continue;

      // Find licences expiring within their reminder window (not yet notified today)
      const expiring = db.prepare(`
        SELECT el.*, c.name AS employee_name, c.id AS cand_id
        FROM employee_licenses el
        JOIN candidates c ON c.id = el.candidate_id
        WHERE el.expiry_date IS NOT NULL
          AND el.expiry_date >= ?
          AND el.expiry_date <= date(?, '+' || el.reminder_days_before || ' days')
          AND (el.reminded_at IS NULL OR date(el.reminded_at) < ?)
          AND c.deleted_at IS NULL
      `).all(today, today, today);

      // Find already expired licences (notify once per day)
      const expired = db.prepare(`
        SELECT el.*, c.name AS employee_name, c.id AS cand_id
        FROM employee_licenses el
        JOIN candidates c ON c.id = el.candidate_id
        WHERE el.expiry_date IS NOT NULL
          AND el.expiry_date < ?
          AND el.status != 'expired'
          AND c.deleted_at IS NULL
      `).all(today);

      // Mark expired licences
      for (const lic of expired) {
        db.prepare("UPDATE employee_licenses SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(lic.id);
      }

      if (expiring.length === 0 && expired.length === 0) continue;

      const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
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
          db.prepare('UPDATE employee_licenses SET reminded_at = CURRENT_TIMESTAMP WHERE id = ?').run(lic.id);
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

// Run immediately on startup, then every 24 hours
checkLicenceExpiry().catch(err => console.error('[LicenceCheck] Startup check failed:', err.message));
setInterval(() => {
  checkLicenceExpiry().catch(err => console.error('[LicenceCheck] Scheduled check failed:', err.message));
}, 24 * 60 * 60 * 1000);
