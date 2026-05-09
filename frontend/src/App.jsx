import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ModulesProvider, useModules } from './contexts/ModulesContext';
import Layout from './components/Layout';

// ── Error Boundary ─────────────────────────────────────────────────────────────
// React 18: uncaught render errors unmount the entire tree and show a blank page.
// This class component catches errors and shows a diagnostic screen instead.
// Uses only inline styles so it renders even if the CSS bundle fails to load.

// Detect stale-chunk errors that happen after a new deployment:
// "Failed to fetch dynamically imported module" / "Importing a module script failed"
function isChunkLoadError(error) {
  const msg = error?.message || String(error);
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('Unable to preload CSS') ||
    msg.includes('ChunkLoadError')
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, isChunkError: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error, isChunkError: isChunkLoadError(error) };
  }

  componentDidCatch(error, info) {
    if (isChunkLoadError(error)) {
      // Stale assets after a new deployment — reload once automatically.
      // Guard against infinite reload loops with a sessionStorage flag.
      const RELOAD_KEY = 'flow_chunk_reload_attempted';
      if (!sessionStorage.getItem(RELOAD_KEY)) {
        sessionStorage.setItem(RELOAD_KEY, '1');
        console.warn('[ErrorBoundary] Stale chunk detected — reloading for fresh assets.');
        window.location.reload();
        return;
      }
      // If we already reloaded and still failing, fall through to show error UI
      console.error('[ErrorBoundary] Chunk reload did not resolve error:', error.message);
    } else {
      console.error('[ErrorBoundary] React render error:', error);
      console.error('[ErrorBoundary] Component stack:', info?.componentStack);
    }
    this.setState({ errorInfo: info });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const msg   = this.state.error?.message || String(this.state.error);
    const stack = this.state.errorInfo?.componentStack || '';
    const isChunk = this.state.isChunkError;

    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '24px', background: '#f9fafb',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}>
        <div style={{
          maxWidth: '600px', width: '100%', background: '#fff',
          borderRadius: '12px', padding: '32px',
          boxShadow: '0 1px 4px rgba(0,0,0,.08)',
          border: `1px solid ${isChunk ? '#d1fae5' : '#fecaca'}`,
        }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>{isChunk ? '🔄' : '⚠️'}</div>
          <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#111827', margin: '0 0 8px' }}>
            {isChunk ? 'New version available' : 'Something went wrong'}
          </h1>
          <p style={{ color: '#6b7280', fontSize: '14px', margin: '0 0 20px' }}>
            {isChunk
              ? 'Flow has been updated. Please reload the page to get the latest version.'
              : 'Flow encountered an unexpected error. The message below will help diagnose it.'}
          </p>
          {!isChunk && (
            <pre style={{
              background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px',
              padding: '12px 16px', fontSize: '12px', color: '#b91c1c',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              margin: '0 0 12px', maxHeight: '160px', overflowY: 'auto',
            }}>
              {msg}
            </pre>
          )}
          {!isChunk && stack && (
            <details style={{ marginBottom: '20px' }}>
              <summary style={{ cursor: 'pointer', fontSize: '12px', color: '#9ca3af', userSelect: 'none' }}>
                Component stack
              </summary>
              <pre style={{
                marginTop: '8px', background: '#f3f4f6', borderRadius: '6px',
                padding: '10px 14px', fontSize: '11px', color: '#374151',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                maxHeight: '200px', overflowY: 'auto',
              }}>
                {stack}
              </pre>
            </details>
          )}
          <button
            onClick={() => {
              sessionStorage.removeItem('flow_chunk_reload_attempted');
              window.location.reload();
            }}
            style={{
              background: isChunk ? '#10b981' : '#10b981', color: '#fff', border: 'none',
              borderRadius: '8px', padding: '10px 22px',
              fontSize: '14px', fontWeight: '600', cursor: 'pointer',
            }}
          >
            {isChunk ? '🔄 Reload to update' : 'Reload page'}
          </button>
        </div>
      </div>
    );
  }
}

// Clear the chunk-reload guard on every successful JS execution so future
// deploys can auto-reload again (guard only prevents infinite loops within
// a single page load attempt, not across separate visits).
sessionStorage.removeItem('flow_chunk_reload_attempted');

// ── Eagerly loaded (needed on every page load) ────────────────────────────────
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';

// ── Lazily loaded — each becomes its own JS chunk ────────────────────────────

// Admin pages
const AdminDashboard        = lazy(() => import('./pages/admin/Dashboard'));
const AdminCandidates       = lazy(() => import('./pages/admin/Candidates'));
const AdminClients          = lazy(() => import('./pages/admin/Clients'));
const AdminTimesheets       = lazy(() => import('./pages/admin/Timesheets'));
const AdminAbsences         = lazy(() => import('./pages/admin/Absences'));
const AdminInvoices         = lazy(() => import('./pages/admin/Invoices'));
const AdminJobs             = lazy(() => import('./pages/admin/Jobs'));
const AdminReports          = lazy(() => import('./pages/admin/Reports'));
const AdminImport           = lazy(() => import('./pages/admin/Import'));
const AdminDocuments        = lazy(() => import('./pages/admin/Documents'));
const AdminSettings         = lazy(() => import('./pages/admin/Settings'));
const ResumeBuilder         = lazy(() => import('./pages/admin/ResumeBuilder'));
const PayrollReconciliation = lazy(() => import('./pages/admin/PayrollReconciliation'));
const EmailPayments         = lazy(() => import('./pages/admin/EmailPayments'));
const AdminSupportDashboard = lazy(() => import('./pages/admin/SupportDashboard'));
const AIChatDocuments       = lazy(() => import('./pages/admin/AIChatDocuments'));
const EmployeeProfile       = lazy(() => import('./pages/admin/EmployeeProfile'));
const AdminProjects         = lazy(() => import('./pages/admin/Projects'));
const AdminExpenses         = lazy(() => import('./pages/admin/Expenses'));

// Field Ops pages
const FieldScan       = lazy(() => import('./pages/agrow/FieldScan'));
const AGrowAnalytics  = lazy(() => import('./pages/agrow/Analytics'));
const ScannedProducts = lazy(() => import('./pages/agrow/ScannedProducts'));
const AgrowEmployees  = lazy(() => import('./pages/agrow/Employees'));
const CustomFields    = lazy(() => import('./pages/agrow/CustomFields'));
const Languages       = lazy(() => import('./pages/agrow/Languages'));

// Candidate pages
const CandidateDashboard = lazy(() => import('./pages/candidate/Dashboard'));
const LogHours           = lazy(() => import('./pages/candidate/LogHours'));
const MyAbsences         = lazy(() => import('./pages/candidate/MyAbsences'));
const MyInvoices         = lazy(() => import('./pages/candidate/MyInvoices'));
const CandidateJobs      = lazy(() => import('./pages/candidate/Jobs'));
const CandidateDocuments = lazy(() => import('./pages/candidate/Documents'));
const MyResume           = lazy(() => import('./pages/candidate/MyResume'));

// Client portal pages
const ClientDashboard        = lazy(() => import('./pages/client/Dashboard'));
const ClientInvoices         = lazy(() => import('./pages/client/Invoices'));
const ClientDocuments        = lazy(() => import('./pages/client/Documents'));
const ClientTimesheetApproval = lazy(() => import('./pages/client/TimesheetApproval'));

// Recruiter pages
const RecruiterDashboard = lazy(() => import('./pages/recruiter/Dashboard'));
const RecruiterC2CJobs   = lazy(() => import('./pages/recruiter/C2CJobs'));
const AdminRecruiters    = lazy(() => import('./pages/admin/Recruiters'));

// C2C Jobs for candidates
const CandidateC2CJobs = lazy(() => import('./pages/candidate/C2CJobs'));

// Super-admin pages
const SuperAdminDashboard        = lazy(() => import('./pages/superadmin/Dashboard'));
const SuperAdminTenants          = lazy(() => import('./pages/superadmin/Tenants'));
const SuperAdminSupportDashboard = lazy(() => import('./pages/superadmin/SupportDashboard'));
const SuperAdminSecurity         = lazy(() => import('./pages/superadmin/Security'));
const PlatformAIConfig           = lazy(() => import('./pages/superadmin/AIConfig'));

// Support
const Support = lazy(() => import('./pages/Support'));

// AI Chat widget (loaded on-demand — only renders inside Layout)
// AIChatWidget is lazily imported by Layout.jsx — no import needed here

// ── Loading fallback ──────────────────────────────────────────────────────────

function PageSpinner() {
  return (
    <div className="flex items-center justify-center h-screen" aria-label="Loading page">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600" />
    </div>
  );
}

/** Wrap any lazy component in a route-level Suspense boundary */
function Lazy({ children }) {
  return <Suspense fallback={<PageSpinner />}>{children}</Suspense>;
}

// ── Route guards ─────────────────────────────────────────────────────────────

/** Requires any authenticated user */
function PrivateRoute({ children, adminOnly = false, clientOnly = false }) {
  const { user, loading, mustChangePw } = useAuth();
  if (loading) return <PageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  // Force password change before allowing access to any protected page
  if (mustChangePw) return <Navigate to="/change-password" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/dashboard" replace />;
  if (clientOnly && user.role !== 'client') return <Navigate to="/dashboard" replace />;
  return children;
}

/** Requires super_admin role */
function SuperAdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <PageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'super_admin') return <Navigate to="/dashboard" replace />;
  return children;
}

/** Requires recruiter role (admin or recruiter) */
function RecruiterRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <PageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!['recruiter', 'admin'].includes(user.role)) return <Navigate to="/dashboard" replace />;
  return children;
}

/**
 * ModuleRoute — gate a page behind a module key.
 * If the module is disabled for this tenant, shows a locked-feature screen
 * instead of a redirect (so the user understands it's a subscription feature).
 */
function ModuleRoute({ moduleKey, children, adminOnly = false }) {
  const { user, loading: authLoading } = useAuth();
  const { hasModule, loading: modLoading } = useModules();

  if (authLoading || modLoading) return <PageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/dashboard" replace />;

  if (!hasModule(moduleKey)) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 text-center">
        <div className="text-6xl mb-4">🔒</div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">Module Not Enabled</h2>
        <p className="text-gray-500 max-w-sm">
          This feature is not included in your current subscription.
          Contact your administrator to enable it.
        </p>
        <p className="mt-3 text-xs text-gray-400 font-mono bg-gray-100 px-3 py-1 rounded-full">
          {moduleKey}
        </p>
      </div>
    );
  }

  return children;
}

// ── Route tree ────────────────────────────────────────────────────────────────

function AppRoutes() {
  const { user } = useAuth();

  // Determine where to redirect "/" based on role
  const defaultPath = user?.role === 'super_admin' ? '/super-admin/dashboard' : user?.role === 'recruiter' ? '/recruiter/dashboard' : '/dashboard';

  return (
    <Routes>
      {/* Public */}
      <Route
        path="/login"
        element={user ? <Navigate to={defaultPath} replace /> : <Login />}
      />

      {/* Force-password-change page — accessible while logged in */}
      <Route path="/change-password" element={<ChangePassword />} />
      <Route path="/" element={<Navigate to={defaultPath} replace />} />

      {/* ── Recruiter portal ───────────────────────────────────────────── */}
      <Route
        path="/recruiter"
        element={
          <RecruiterRoute>
            <Layout />
          </RecruiterRoute>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<Lazy><RecruiterDashboard /></Lazy>} />
        <Route path="jobs"      element={<Lazy><RecruiterC2CJobs /></Lazy>} />
      </Route>

      {/* ── Super-admin shell ──────────────────────────────────────────── */}
      <Route
        path="/super-admin"
        element={
          <SuperAdminRoute>
            <Layout />
          </SuperAdminRoute>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<Lazy><SuperAdminDashboard /></Lazy>} />
        <Route path="tenants"   element={<Lazy><SuperAdminTenants /></Lazy>} />
        <Route path="support"   element={<Lazy><SuperAdminSupportDashboard /></Lazy>} />
        <Route path="security"  element={<Lazy><SuperAdminSecurity /></Lazy>} />
        <Route path="ai-config" element={<Lazy><PlatformAIConfig /></Lazy>} />
      </Route>

      {/* ── Tenant user shell ─────────────────────────────────────────── */}
      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        {/* Shared dashboard (role-aware) */}
        <Route path="dashboard" element={
          user?.role === 'admin'
            ? <PrivateRoute adminOnly><Lazy><AdminDashboard /></Lazy></PrivateRoute>
            : user?.role === 'client'
              ? <PrivateRoute clientOnly><Lazy><ClientDashboard /></Lazy></PrivateRoute>
              : <Lazy><CandidateDashboard /></Lazy>
        } />

        {/* Admin-only routes — module-gated */}
        <Route path="employees"    element={<ModuleRoute moduleKey="hr_candidates" adminOnly><Lazy><AdminCandidates /></Lazy></ModuleRoute>} />
        <Route path="employees/:id" element={<ModuleRoute moduleKey="hr_candidates" adminOnly><Lazy><EmployeeProfile /></Lazy></ModuleRoute>} />
        <Route path="clients"      element={<ModuleRoute moduleKey="hr_clients"    adminOnly><Lazy><AdminClients /></Lazy></ModuleRoute>} />
        <Route path="recruiters"   element={<PrivateRoute adminOnly><Lazy><AdminRecruiters /></Lazy></PrivateRoute>} />
        <Route path="timesheets"   element={<ModuleRoute moduleKey="hr_timesheets" adminOnly><Lazy><AdminTimesheets /></Lazy></ModuleRoute>} />
        <Route path="absences" element={
          user?.role === 'admin'
            ? <ModuleRoute moduleKey="hr_absences" adminOnly><Lazy><AdminAbsences /></Lazy></ModuleRoute>
            : <ModuleRoute moduleKey="hr_absences"><Lazy><MyAbsences /></Lazy></ModuleRoute>
        } />
        <Route path="invoices" element={
          user?.role === 'admin'
            ? <ModuleRoute moduleKey="hr_invoices" adminOnly><Lazy><AdminInvoices /></Lazy></ModuleRoute>
            : user?.role === 'client'
              ? <ModuleRoute moduleKey="hr_invoices"><Lazy><ClientInvoices /></Lazy></ModuleRoute>
              : <ModuleRoute moduleKey="hr_invoices"><Lazy><MyInvoices /></Lazy></ModuleRoute>
        } />

        {/* Jobs — module-gated, role-aware */}
        <Route path="jobs" element={
          user?.role === 'admin'
            ? <ModuleRoute moduleKey="hr_jobs" adminOnly><Lazy><AdminJobs /></Lazy></ModuleRoute>
            : <ModuleRoute moduleKey="hr_jobs"><Lazy><CandidateJobs /></Lazy></ModuleRoute>
        } />

        {/* C2C Jobs for candidates */}
        <Route path="c2c-jobs" element={<Lazy><CandidateC2CJobs /></Lazy>} />

        {/* Documents — module-gated, role-aware */}
        <Route path="documents" element={
          user?.role === 'admin'
            ? <ModuleRoute moduleKey="hr_documents" adminOnly><Lazy><AdminDocuments /></Lazy></ModuleRoute>
            : user?.role === 'client'
              ? <ModuleRoute moduleKey="hr_documents"><Lazy><ClientDocuments /></Lazy></ModuleRoute>
              : <ModuleRoute moduleKey="hr_documents"><Lazy><CandidateDocuments /></Lazy></ModuleRoute>
        } />

        {/* Admin: Reports + Import + Settings */}
        <Route path="reports"   element={<ModuleRoute moduleKey="hr_reports" adminOnly><Lazy><AdminReports /></Lazy></ModuleRoute>} />
        <Route path="projects"  element={<ModuleRoute moduleKey="hr_timesheets" adminOnly><Lazy><AdminProjects /></Lazy></ModuleRoute>} />
        <Route path="expenses"  element={<PrivateRoute><Lazy><AdminExpenses /></Lazy></PrivateRoute>} />
        <Route path="import"    element={<ModuleRoute moduleKey="hr_import"  adminOnly><Lazy><AdminImport /></Lazy></ModuleRoute>} />
        <Route path="settings" element={<PrivateRoute adminOnly><Lazy><AdminSettings /></Lazy></PrivateRoute>} />

        {/* Admin: Resume Builder + Payroll + Email Payments */}
        <Route path="resume-builder"         element={<ModuleRoute moduleKey="hr_candidates" adminOnly><Lazy><ResumeBuilder /></Lazy></ModuleRoute>} />
        <Route path="payroll-reconciliation" element={<PrivateRoute adminOnly><Lazy><PayrollReconciliation /></Lazy></PrivateRoute>} />
        <Route path="email-payments"         element={<PrivateRoute adminOnly><Lazy><EmailPayments /></Lazy></PrivateRoute>} />

        {/* ── Field Ops routes — module-gated ────────────────────────── */}
        <Route path="field-scan"          element={<ModuleRoute moduleKey="agrow_scan"><Lazy><FieldScan /></Lazy></ModuleRoute>} />
        <Route path="agrow/analytics"     element={<ModuleRoute moduleKey="agrow_analytics"><Lazy><AGrowAnalytics /></Lazy></ModuleRoute>} />
        <Route path="agrow/scanned"       element={<ModuleRoute moduleKey="agrow_scanned_products"><Lazy><ScannedProducts /></Lazy></ModuleRoute>} />
        <Route path="agrow/employees"     element={<ModuleRoute moduleKey="agrow_employees" adminOnly><Lazy><AgrowEmployees /></Lazy></ModuleRoute>} />
        <Route path="agrow/custom-fields" element={<ModuleRoute moduleKey="agrow_custom_fields" adminOnly><Lazy><CustomFields /></Lazy></ModuleRoute>} />
        <Route path="agrow/languages"     element={<ModuleRoute moduleKey="agrow_languages" adminOnly><Lazy><Languages /></Lazy></ModuleRoute>} />

        {/* Client portal */}
        <Route path="client-timesheets" element={<PrivateRoute clientOnly><Lazy><ClientTimesheetApproval /></Lazy></PrivateRoute>} />

        {/* Candidate-only routes */}
        <Route path="log-hours"    element={<PrivateRoute><Lazy><LogHours /></Lazy></PrivateRoute>} />
        <Route path="my-absences"  element={<PrivateRoute><Lazy><MyAbsences /></Lazy></PrivateRoute>} />
        <Route path="my-invoices"  element={<PrivateRoute><Lazy><MyInvoices /></Lazy></PrivateRoute>} />
        <Route path="my-resume"    element={<PrivateRoute><Lazy><MyResume /></Lazy></PrivateRoute>} />

        {/* Support */}
        <Route path="support"       element={<ModuleRoute moduleKey="hr_support"><Lazy><Support /></Lazy></ModuleRoute>} />
        <Route path="support-admin" element={<ModuleRoute moduleKey="hr_support" adminOnly><Lazy><AdminSupportDashboard /></Lazy></ModuleRoute>} />

        {/* AI Assistant */}
        <Route path="ai-documents" element={<ModuleRoute moduleKey="ai_assistant" adminOnly><Lazy><AIChatDocuments /></Lazy></ModuleRoute>} />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to={defaultPath} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ErrorBoundary>
          <AuthProvider>
            <ModulesProvider>
              <AppRoutes />
            </ModulesProvider>
          </AuthProvider>
        </ErrorBoundary>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
