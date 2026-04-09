import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ModulesProvider, useModules } from './contexts/ModulesContext';
import Layout from './components/Layout';

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

// Super-admin pages
const SuperAdminDashboard        = lazy(() => import('./pages/superadmin/Dashboard'));
const SuperAdminTenants          = lazy(() => import('./pages/superadmin/Tenants'));
const SuperAdminSupportDashboard = lazy(() => import('./pages/superadmin/SupportDashboard'));
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
  const defaultPath = user?.role === 'super_admin' ? '/super-admin/dashboard' : '/dashboard';

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

        {/* Documents — module-gated, role-aware */}
        <Route path="documents" element={
          user?.role === 'admin'
            ? <ModuleRoute moduleKey="hr_documents" adminOnly><Lazy><AdminDocuments /></Lazy></ModuleRoute>
            : user?.role === 'client'
              ? <ModuleRoute moduleKey="hr_documents"><Lazy><ClientDocuments /></Lazy></ModuleRoute>
              : <ModuleRoute moduleKey="hr_documents"><Lazy><CandidateDocuments /></Lazy></ModuleRoute>
        } />

        {/* Admin: Reports + Import + Settings */}
        <Route path="reports"  element={<ModuleRoute moduleKey="hr_reports" adminOnly><Lazy><AdminReports /></Lazy></ModuleRoute>} />
        <Route path="import"   element={<ModuleRoute moduleKey="hr_import"  adminOnly><Lazy><AdminImport /></Lazy></ModuleRoute>} />
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
    <BrowserRouter>
      <AuthProvider>
        <ModulesProvider>
          <AppRoutes />
        </ModulesProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
