import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ModulesProvider, useModules } from './contexts/ModulesContext';
import Layout from './components/Layout';
import Login from './pages/Login';

// Admin pages
import AdminDashboard from './pages/admin/Dashboard';
import AdminCandidates from './pages/admin/Candidates';
import AdminClients from './pages/admin/Clients';
import AdminTimesheets from './pages/admin/Timesheets';
import AdminAbsences from './pages/admin/Absences';
import AdminInvoices from './pages/admin/Invoices';
import AdminJobs from './pages/admin/Jobs';
import AdminReports from './pages/admin/Reports';
import AdminImport from './pages/admin/Import';
import AdminDocuments from './pages/admin/Documents';
import AdminSettings from './pages/admin/Settings';

// aGrow pages
import FieldScan       from './pages/agrow/FieldScan';
import AGrowAnalytics  from './pages/agrow/Analytics';
import ScannedProducts from './pages/agrow/ScannedProducts';
import AgrowEmployees  from './pages/agrow/Employees';
import CustomFields    from './pages/agrow/CustomFields';
import Languages       from './pages/agrow/Languages';

// Candidate pages
import CandidateDashboard from './pages/candidate/Dashboard';
import LogHours from './pages/candidate/LogHours';
import MyAbsences from './pages/candidate/MyAbsences';
import MyInvoices from './pages/candidate/MyInvoices';
import CandidateJobs from './pages/candidate/Jobs';
import CandidateDocuments from './pages/candidate/Documents';

// Admin pages (new)
import ResumeBuilder          from './pages/admin/ResumeBuilder';
import PayrollReconciliation  from './pages/admin/PayrollReconciliation';
import EmailPayments          from './pages/admin/EmailPayments';

// Client portal pages
import ClientDashboard        from './pages/client/Dashboard';
import ClientInvoices         from './pages/client/Invoices';
import ClientDocuments        from './pages/client/Documents';
import ClientTimesheetApproval from './pages/client/TimesheetApproval';

// Candidate pages (new)
import MyResume from './pages/candidate/MyResume';

// Super-admin pages
import SuperAdminDashboard from './pages/superadmin/Dashboard';
import SuperAdminTenants from './pages/superadmin/Tenants';
import SuperAdminSupportDashboard from './pages/superadmin/SupportDashboard';
import PlatformAIConfig from './pages/superadmin/AIConfig';

// Support pages
import Support from './pages/Support';
import AdminSupportDashboard from './pages/admin/SupportDashboard';

// AI Assistant pages
import AIChatDocuments from './pages/admin/AIChatDocuments';
import AIChatWidget from './components/AIChatWidget';

// Employee profile
import EmployeeProfile from './pages/admin/EmployeeProfile';

// Auth pages
import ChangePassword from './pages/ChangePassword';

// ── Route guards ────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
    </div>
  );
}

/** Requires any authenticated user */
function PrivateRoute({ children, adminOnly = false, clientOnly = false }) {
  const { user, loading, mustChangePw } = useAuth();
  if (loading) return <Spinner />;
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
  if (loading) return <Spinner />;
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

  if (authLoading || modLoading) return <Spinner />;
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

// ── Route tree ───────────────────────────────────────────────────────────────

function AppRoutes() {
  const { user } = useAuth();

  // Determine where to redirect "/" and unknown paths based on role
  const defaultPath = user?.role === 'super_admin' ? '/super-admin/dashboard' : '/dashboard';

  return (
    <Routes>
      {/* Public */}
      <Route
        path="/login"
        element={
          user
            ? <Navigate to={defaultPath} replace />
            : <Login />
        }
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
        <Route path="dashboard" element={<SuperAdminDashboard />} />
        <Route path="tenants"   element={<SuperAdminTenants />} />
        <Route path="support"   element={<SuperAdminSupportDashboard />} />
        <Route path="ai-config" element={<PlatformAIConfig />} />
      </Route>

      {/* ── Tenant user shell ─────────────────────────────────────────── */}
      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        {/* Shared dashboard (role-aware) */}
        <Route path="dashboard" element={
          user?.role === 'admin'
            ? <PrivateRoute adminOnly><AdminDashboard /></PrivateRoute>
            : user?.role === 'client'
              ? <PrivateRoute clientOnly><ClientDashboard /></PrivateRoute>
              : <CandidateDashboard />
        } />

        {/* Admin-only routes — module-gated */}
        <Route path="employees" element={<ModuleRoute moduleKey="hr_candidates" adminOnly><AdminCandidates /></ModuleRoute>} />
        <Route path="employees/:id" element={<ModuleRoute moduleKey="hr_candidates" adminOnly><EmployeeProfile /></ModuleRoute>} />
        <Route path="clients"    element={<ModuleRoute moduleKey="hr_clients"    adminOnly><AdminClients /></ModuleRoute>} />
        <Route path="timesheets" element={<ModuleRoute moduleKey="hr_timesheets" adminOnly><AdminTimesheets /></ModuleRoute>} />
        <Route path="absences" element={
          user?.role === 'admin'
            ? <ModuleRoute moduleKey="hr_absences" adminOnly><AdminAbsences /></ModuleRoute>
            : <ModuleRoute moduleKey="hr_absences"><MyAbsences /></ModuleRoute>
        } />
        <Route path="invoices" element={
          user?.role === 'admin'
            ? <ModuleRoute moduleKey="hr_invoices" adminOnly><AdminInvoices /></ModuleRoute>
            : user?.role === 'client'
              ? <ModuleRoute moduleKey="hr_invoices"><ClientInvoices /></ModuleRoute>
              : <ModuleRoute moduleKey="hr_invoices"><MyInvoices /></ModuleRoute>
        } />

        {/* Jobs — module-gated, role-aware */}
        <Route path="jobs" element={
          user?.role === 'admin'
            ? <ModuleRoute moduleKey="hr_jobs" adminOnly><AdminJobs /></ModuleRoute>
            : <ModuleRoute moduleKey="hr_jobs"><CandidateJobs /></ModuleRoute>
        } />

        {/* Documents — module-gated, role-aware */}
        <Route path="documents" element={
          user?.role === 'admin'
            ? <ModuleRoute moduleKey="hr_documents" adminOnly><AdminDocuments /></ModuleRoute>
            : user?.role === 'client'
              ? <ModuleRoute moduleKey="hr_documents"><ClientDocuments /></ModuleRoute>
              : <ModuleRoute moduleKey="hr_documents"><CandidateDocuments /></ModuleRoute>
        } />

        {/* Admin: Reports + Import + Settings (Settings always allowed) */}
        <Route path="reports"  element={<ModuleRoute moduleKey="hr_reports" adminOnly><AdminReports /></ModuleRoute>} />
        <Route path="import"   element={<ModuleRoute moduleKey="hr_import"  adminOnly><AdminImport /></ModuleRoute>} />
        <Route path="settings" element={<PrivateRoute adminOnly><AdminSettings /></PrivateRoute>} />

        {/* Admin: Resume Builder + Payroll Reconciliation + Email Payments */}
        <Route path="resume-builder"         element={<ModuleRoute moduleKey="hr_candidates" adminOnly><ResumeBuilder /></ModuleRoute>} />
        <Route path="payroll-reconciliation" element={<PrivateRoute adminOnly><PayrollReconciliation /></PrivateRoute>} />
        <Route path="email-payments"         element={<PrivateRoute adminOnly><EmailPayments /></PrivateRoute>} />

        {/* ── aGrow routes — module-gated ──────────────────────────── */}
        <Route path="field-scan"          element={<ModuleRoute moduleKey="agrow_scan"><FieldScan /></ModuleRoute>} />
        <Route path="agrow/analytics"     element={<ModuleRoute moduleKey="agrow_analytics"><AGrowAnalytics /></ModuleRoute>} />
        <Route path="agrow/scanned"       element={<ModuleRoute moduleKey="agrow_scanned_products"><ScannedProducts /></ModuleRoute>} />
        <Route path="agrow/employees"     element={<ModuleRoute moduleKey="agrow_employees" adminOnly><AgrowEmployees /></ModuleRoute>} />
        <Route path="agrow/custom-fields" element={<ModuleRoute moduleKey="agrow_custom_fields" adminOnly><CustomFields /></ModuleRoute>} />
        <Route path="agrow/languages"     element={<ModuleRoute moduleKey="agrow_languages" adminOnly><Languages /></ModuleRoute>} />

        {/* Client portal: Timesheet Approval */}
        <Route path="client-timesheets" element={<PrivateRoute clientOnly><ClientTimesheetApproval /></PrivateRoute>} />

        {/* Candidate-only routes */}
        <Route path="log-hours"    element={<PrivateRoute><LogHours /></PrivateRoute>} />
        <Route path="my-absences"  element={<PrivateRoute><MyAbsences /></PrivateRoute>} />
        <Route path="my-invoices"  element={<PrivateRoute><MyInvoices /></PrivateRoute>} />
        <Route path="my-resume"    element={<PrivateRoute><MyResume /></PrivateRoute>} />

        {/* Support — employee/client portal (module-gated) */}
        <Route path="support"       element={<ModuleRoute moduleKey="hr_support"><Support /></ModuleRoute>} />

        {/* Support — admin management (module-gated, admin only) */}
        <Route path="support-admin" element={<ModuleRoute moduleKey="hr_support" adminOnly><AdminSupportDashboard /></ModuleRoute>} />

        {/* AI Assistant — admin knowledge-base document management */}
        <Route path="ai-documents" element={<ModuleRoute moduleKey="ai_assistant" adminOnly><AIChatDocuments /></ModuleRoute>} />
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
