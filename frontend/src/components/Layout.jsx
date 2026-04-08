import React, { useState, useRef, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useModules } from '../contexts/ModulesContext';
import { useNotifications } from '../hooks/useNotifications';
import AIChatWidget from './AIChatWidget';
import FlowLogo from './FlowLogo';

// ── Navigation definitions ────────────────────────────────────────────────────
// moduleKey: if set, item is hidden when that module is disabled for the tenant.
// No moduleKey = always visible (core navigation like Dashboard, Settings).

const superAdminNav = [
  { to: '/super-admin/dashboard', icon: '📊', label: 'Overview' },
  { to: '/super-admin/tenants',   icon: '🏢', label: 'Organisations' },
  { to: '/super-admin/support',   icon: '🎫', label: 'Platform Support' },
  { to: '/super-admin/ai-config', icon: '🤖', label: 'AI Configuration' },
];

const adminNav = [
  { to: '/dashboard',  icon: '📊', label: 'Dashboard' },
  // ── aGrow ──────────────────────────────────────────────────
  { to: '/field-scan',          icon: '📷', label: 'Field Scan',       section: 'Field Ops',   moduleKey: 'agrow_scan' },
  { to: '/agrow/scanned',       icon: '🌾', label: 'Scanned Products',                     moduleKey: 'agrow_scanned_products' },
  { to: '/agrow/analytics',     icon: '📈', label: 'Harvest Analytics',                    moduleKey: 'agrow_analytics' },
  { to: '/agrow/employees',     icon: '👷', label: 'Field Workers',                        moduleKey: 'agrow_employees' },
  { to: '/agrow/custom-fields', icon: '🔧', label: 'Custom Fields',                        moduleKey: 'agrow_custom_fields' },
  { to: '/agrow/languages',     icon: '🌐', label: 'Languages',                            moduleKey: 'agrow_languages' },
  // ── HR/Staffing ─────────────────────────────────────────────
  { to: '/employees', icon: '👥', label: 'Employees',  section: 'Staffing', moduleKey: 'hr_candidates' },
  { to: '/jobs',       icon: '💼', label: 'Jobs',                              moduleKey: 'hr_jobs' },
  { to: '/clients',    icon: '🏢', label: 'Clients',                           moduleKey: 'hr_clients' },
  { to: '/timesheets', icon: '⏱️', label: 'Timesheets',                        moduleKey: 'hr_timesheets' },
  { to: '/absences',   icon: '🏖️', label: 'Absences',                          moduleKey: 'hr_absences' },
  { to: '/invoices',   icon: '📄', label: 'Invoices',                          moduleKey: 'hr_invoices' },
  { to: '/documents',              icon: '📁', label: 'Documents',              moduleKey: 'hr_documents' },
  { to: '/reports',               icon: '📉', label: 'Reports',                moduleKey: 'hr_reports' },
  { to: '/import',                icon: '📥', label: 'Import',                 moduleKey: 'hr_import' },
  // ── Payroll & Tools ─────────────────────────────────────────────────────────
  { to: '/payroll-reconciliation', icon: '💰', label: 'Payroll',        section: 'Payroll & Tools' },
  { to: '/email-payments',         icon: '📧', label: 'Email Payments'  },
  { to: '/resume-builder',         icon: '📄', label: 'Resume Builder', moduleKey: 'hr_candidates' },
  { to: '/support-admin',          icon: '🎫', label: 'Support',        section: 'Support', moduleKey: 'hr_support' },
  { to: '/ai-documents',           icon: '🧠', label: 'AI Knowledge Base', moduleKey: 'ai_assistant' },
  { to: '/settings',               icon: '⚙️', label: 'Settings' },   // always visible
];

const candidateNav = [
  { to: '/dashboard',       icon: '📊', label: 'My Dashboard' },
  { to: '/field-scan',      icon: '📷', label: 'Field Scan',  section: 'Field Ops', moduleKey: 'agrow_scan' },
  { to: '/agrow/scanned',   icon: '🌾', label: 'My Scans',                      moduleKey: 'agrow_scanned_products' },
  { to: '/agrow/analytics', icon: '📈', label: 'Analytics',                     moduleKey: 'agrow_analytics' },
  { to: '/jobs',            icon: '💼', label: 'Jobs',        section: 'Work',  moduleKey: 'hr_jobs' },
  { to: '/log-hours',       icon: '⏱️', label: 'Log Hours' },   // always visible
  { to: '/my-absences',     icon: '🏖️', label: 'My Absences',                   moduleKey: 'hr_absences' },
  { to: '/my-invoices',     icon: '📄', label: 'My Invoices',                   moduleKey: 'hr_invoices' },
  { to: '/my-resume',       icon: '📋', label: 'My Resume' },
  { to: '/documents',       icon: '📁', label: 'Documents',                     moduleKey: 'hr_documents' },
  { to: '/support',         icon: '🎫', label: 'Support',                       moduleKey: 'hr_support' },
];

const clientNav = [
  { to: '/dashboard',         icon: '📊', label: 'Dashboard' },
  { to: '/invoices',          icon: '📄', label: 'Invoices',            moduleKey: 'hr_invoices' },
  { to: '/client-timesheets', icon: '⏱️', label: 'Timesheet Approvals', moduleKey: 'hr_timesheets' },
  { to: '/documents',         icon: '📁', label: 'Documents',           moduleKey: 'hr_documents' },
  { to: '/support',           icon: '🎫', label: 'Support',             moduleKey: 'hr_support' },
];

function navForRole(role) {
  if (role === 'super_admin') return superAdminNav;
  if (role === 'admin')       return adminNav;
  if (role === 'client')      return clientNav;
  return candidateNav;
}

// ── Notification bell (tenant users only) ─────────────────────────────────────

const NOTIF_ICONS = {
  timesheet_approved:    '✅',
  timesheet_rejected:    '❌',
  absence_approved:      '✅',
  absence_rejected:      '❌',
  job_application_new:   '📋',
  job_application_update:'💼',
};

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function NotificationBell() {
  const { notifications, unreadCount, open, setOpen, markRead, markAllRead, deleteNotification } = useNotifications();
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [setOpen]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
        title="Notifications"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-gray-200 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="font-semibold text-gray-900 text-sm">Notifications</span>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs text-blue-600 hover:underline font-medium">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm">No notifications yet</div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer group border-b border-gray-50 last:border-0 ${!n.is_read ? 'bg-blue-50/40' : ''}`}
                  onClick={() => !n.is_read && markRead(n.id)}
                >
                  <span className="text-lg mt-0.5 shrink-0">{NOTIF_ICONS[n.type] || '🔔'}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-snug ${!n.is_read ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{n.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-snug">{n.message}</p>
                    <p className="text-xs text-gray-400 mt-1">{timeAgo(n.created_at)}</p>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); deleteNotification(n.id); }}
                    className="shrink-0 text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all text-lg leading-none mt-0.5"
                    title="Dismiss"
                  >×</button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main layout ────────────────────────────────────────────────────────────────

export default function Layout() {
  const { user, logout, isSuperAdmin } = useAuth();
  const { hasModule } = useModules();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Filter nav items: super_admin always sees all; others filter by module enablement
  const rawNav = navForRole(user?.role);
  const nav = isSuperAdmin
    ? rawNav
    : rawNav.filter(item => !item.moduleKey || hasModule(item.moduleKey));

  // Super-admin uses purple accents; regular users use Flow indigo
  const accentActive   = isSuperAdmin ? 'bg-purple-600 text-white' : 'bg-indigo-600 text-white';
  const accentLogo     = isSuperAdmin ? 'bg-purple-500' : 'bg-indigo-500';
  const accentDot      = isSuperAdmin ? 'bg-purple-500' : user?.role === 'admin' ? 'bg-indigo-500' : 'bg-indigo-400';

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const roleLabel = () => {
    if (isSuperAdmin) return 'Flow Staff';
    if (user?.tenantName) return user.tenantName;
    return user?.role ?? '';
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-60' : 'w-16'} bg-gray-900 text-white flex flex-col transition-all duration-200 shrink-0`}>
        {/* Logo area */}
        <div className="px-4 py-4 border-b border-gray-700">
          <FlowLogo size={sidebarOpen ? 'sm' : 'xs'} iconOnly={!sidebarOpen} inverted />
          {sidebarOpen && isSuperAdmin && (
            <p className="text-xs text-purple-300 font-medium mt-1 pl-0.5">Platform Admin</p>
          )}
          {sidebarOpen && !isSuperAdmin && user?.tenantName && (
            <p className="text-xs text-gray-400 truncate mt-1 pl-0.5">{user.tenantName}</p>
          )}
        </div>

        {/* Nav links */}
        <nav className="flex-1 py-4 overflow-y-auto">
          {nav.map((item, idx) => {
            // Show a section header only when this item introduces a new section
            // AND there's at least one item remaining in that section (already guaranteed
            // by the filter above — if we reach this item, it's visible).
            const prevItem = nav[idx - 1];
            const showSection = item.section && item.section !== prevItem?.section;
            return (
              <React.Fragment key={item.to}>
                {showSection && sidebarOpen && (
                  <p className="px-4 pt-4 pb-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {item.section}
                  </p>
                )}
                <NavLink
                  to={item.to}
                  end={item.to.endsWith('dashboard') || item.to === '/'}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg mb-0.5 text-sm transition-colors ${
                      isActive ? accentActive : 'text-gray-400 hover:text-white hover:bg-gray-800'
                    }`
                  }
                >
                  <span className="text-lg shrink-0">{item.icon}</span>
                  {sidebarOpen && <span>{item.label}</span>}
                </NavLink>
              </React.Fragment>
            );
          })}
        </nav>

        {/* User profile footer */}
        <div className="border-t border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 ${accentLogo} rounded-full flex items-center justify-center text-sm font-bold shrink-0`}>
              {user?.name?.[0]?.toUpperCase()}
            </div>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user?.name}</p>
                <p className="text-xs text-gray-400 capitalize truncate">{roleLabel()}</p>
              </div>
            )}
          </div>
          {sidebarOpen && (
            <button
              onClick={handleLogout}
              className="mt-3 w-full text-left text-xs text-gray-400 hover:text-red-400 transition-colors py-1"
            >
              🚪 Sign out
            </button>
          )}
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
          >
            ☰
          </button>
          <div className="flex-1" />

          {/* Notifications — hide for super-admin (they have no tenant DB) */}
          {!isSuperAdmin && <NotificationBell />}

          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span className={`w-2 h-2 rounded-full ${accentDot}`} />
            <span className="capitalize">{isSuperAdmin ? 'Super Admin' : user?.role}</span>
            {user?.tenantName && !isSuperAdmin && (
              <>
                <span className="text-gray-300">|</span>
                <span className="text-gray-500 text-xs truncate max-w-32">{user.tenantName}</span>
              </>
            )}
            <span className="text-gray-300">|</span>
            <span>{user?.name}</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>

      {/* AI Assistant floating widget — visible to all tenant users when module is enabled */}
      {!isSuperAdmin && <AIChatWidget />}
    </div>
  );
}
