import React, { useState, useRef, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useModules } from '../contexts/ModulesContext';
import { useNotifications } from '../hooks/useNotifications';
import AIChatWidget from './AIChatWidget';
import FlowLogo from './FlowLogo';

// ── Navigation definitions ────────────────────────────────────────────────────
// moduleKey: if set, item is hidden when that module is disabled for the tenant.

const superAdminNav = [
  { to: '/super-admin/dashboard', icon: '📊', label: 'Overview' },
  { to: '/super-admin/tenants',   icon: '🏢', label: 'Organisations' },
  { to: '/super-admin/support',   icon: '🎫', label: 'Platform Support' },
  { to: '/super-admin/ai-config', icon: '🤖', label: 'AI Configuration' },
];

const adminNav = [
  { to: '/dashboard',  icon: '📊', label: 'Dashboard' },
  // ── Field Ops ──────────────────────────────────────────────────────────────
  { to: '/field-scan',          icon: '📷', label: 'Field Scan',       section: 'Field Ops',   moduleKey: 'agrow_scan' },
  { to: '/agrow/scanned',       icon: '🌾', label: 'Scanned Products',                         moduleKey: 'agrow_scanned_products' },
  { to: '/agrow/analytics',     icon: '📈', label: 'Harvest Analytics',                        moduleKey: 'agrow_analytics' },
  { to: '/agrow/employees',     icon: '👷', label: 'Field Workers',                            moduleKey: 'agrow_employees' },
  { to: '/agrow/custom-fields', icon: '🔧', label: 'Custom Fields',                            moduleKey: 'agrow_custom_fields' },
  { to: '/agrow/languages',     icon: '🌐', label: 'Languages',                                moduleKey: 'agrow_languages' },
  // ── HR/Staffing ─────────────────────────────────────────────────────────────
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
  { to: '/settings',               icon: '⚙️', label: 'Settings' },
];

const candidateNav = [
  { to: '/dashboard',       icon: '📊', label: 'My Dashboard' },
  { to: '/field-scan',      icon: '📷', label: 'Field Scan',  section: 'Field Ops', moduleKey: 'agrow_scan' },
  { to: '/agrow/scanned',   icon: '🌾', label: 'My Scans',                          moduleKey: 'agrow_scanned_products' },
  { to: '/agrow/analytics', icon: '📈', label: 'Analytics',                         moduleKey: 'agrow_analytics' },
  { to: '/jobs',            icon: '💼', label: 'Jobs',        section: 'Work',      moduleKey: 'hr_jobs' },
  { to: '/log-hours',       icon: '⏱️', label: 'Log Hours' },
  { to: '/my-absences',     icon: '🏖️', label: 'My Absences',                       moduleKey: 'hr_absences' },
  { to: '/my-invoices',     icon: '📄', label: 'My Invoices',                       moduleKey: 'hr_invoices' },
  { to: '/my-resume',       icon: '📋', label: 'My Resume' },
  { to: '/documents',       icon: '📁', label: 'Documents',                         moduleKey: 'hr_documents' },
  { to: '/support',         icon: '🎫', label: 'Support',                           moduleKey: 'hr_support' },
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

// ── Notification Bell ─────────────────────────────────────────────────────────

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
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[17px] h-[17px] flex items-center justify-center px-1 leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden animate-fade-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50">
            <span className="font-semibold text-gray-900 text-sm">Notifications</span>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs text-emerald-600 hover:text-emerald-700 font-semibold transition-colors">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-12 text-center">
                <div className="text-3xl mb-2 opacity-30">🔔</div>
                <p className="text-gray-400 text-sm">No notifications yet</p>
              </div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer group border-b border-gray-50 last:border-0 ${!n.is_read ? 'bg-emerald-50/30' : ''}`}
                  onClick={() => !n.is_read && markRead(n.id)}
                >
                  <span className="text-base mt-0.5 shrink-0">{NOTIF_ICONS[n.type] || '🔔'}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-snug ${!n.is_read ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{n.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-snug line-clamp-2">{n.message}</p>
                    <p className="text-xs text-gray-400 mt-1">{timeAgo(n.created_at)}</p>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); deleteNotification(n.id); }}
                    className="shrink-0 text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all text-xl leading-none mt-0.5"
                    aria-label="Dismiss notification"
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

// ── Sidebar Nav Item ──────────────────────────────────────────────────────────

function NavItem({ item, collapsed, accentActive, onClick }) {
  return (
    <NavLink
      to={item.to}
      end={item.to.endsWith('dashboard') || item.to === '/'}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 mx-2 rounded-xl mb-0.5 text-sm font-medium
         transition-all duration-150 group relative
         ${isActive
           ? `${accentActive} shadow-sm`
           : 'text-gray-400 hover:text-white hover:bg-white/10'
         }`
      }
      title={collapsed ? item.label : undefined}
    >
      <span className="text-lg shrink-0 w-5 text-center">{item.icon}</span>
      {!collapsed && (
        <span className="truncate animate-fade-in">{item.label}</span>
      )}
      {/* Tooltip on collapsed */}
      {collapsed && (
        <div className="absolute left-full ml-2 px-2.5 py-1.5 bg-gray-800 text-white text-xs font-medium rounded-lg
                        opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50
                        translate-x-1 group-hover:translate-x-0 transition-all duration-150 shadow-lg">
          {item.label}
        </div>
      )}
    </NavLink>
  );
}

// ── Main Layout ───────────────────────────────────────────────────────────────

export default function Layout() {
  const { user, logout, isSuperAdmin } = useAuth();
  const { hasModule } = useModules();
  const navigate = useNavigate();

  // Desktop: collapsed/expanded
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Mobile: visible/hidden overlay
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile sidebar on route change
  useEffect(() => { setMobileOpen(false); }, []);

  // Filter nav items
  const rawNav = navForRole(user?.role);
  const nav = isSuperAdmin
    ? rawNav
    : rawNav.filter(item => !item.moduleKey || hasModule(item.moduleKey));

  // Colour tokens — super-admin gets purple, regular users get emerald
  const accentActive = isSuperAdmin
    ? 'bg-purple-500 text-white'
    : 'bg-emerald-500 text-white';

  const accentDot = isSuperAdmin ? 'bg-purple-400' : 'bg-emerald-400';
  const accentAvatarBg = isSuperAdmin ? 'bg-purple-600' : 'bg-emerald-600';

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const roleLabel = () => {
    if (isSuperAdmin) return 'Flow Staff';
    if (user?.tenantName) return user.tenantName;
    return user?.role ?? '';
  };

  // Sidebar collapsed state (desktop only)
  const isCollapsed = !sidebarOpen;

  // ── Sidebar JSX (shared between desktop + mobile) ──────────────────────────
  const SidebarContent = ({ onNavClick }) => (
    <>
      {/* Logo area */}
      <div className={`flex items-center px-4 py-4 border-b border-white/10 ${isCollapsed ? 'justify-center' : ''}`}>
        <FlowLogo size={isCollapsed ? 'xs' : 'sm'} iconOnly={isCollapsed} inverted />
        {!isCollapsed && (
          <div className="ml-0 min-w-0 flex-1">
            {isSuperAdmin && (
              <p className="text-xs text-purple-300 font-semibold mt-0.5 pl-0.5 truncate">Platform Admin</p>
            )}
            {!isSuperAdmin && user?.tenantName && (
              <p className="text-xs text-emerald-300 font-medium mt-0.5 pl-0.5 truncate">{user.tenantName}</p>
            )}
          </div>
        )}
      </div>

      {/* Nav links */}
      <nav className="flex-1 py-3 overflow-y-auto no-scrollbar" aria-label="Main navigation">
        {nav.map((item, idx) => {
          const prevItem = nav[idx - 1];
          const showSection = item.section && item.section !== prevItem?.section;
          return (
            <React.Fragment key={item.to}>
              {showSection && !isCollapsed && (
                <p className="px-5 pt-4 pb-1.5 text-[10px] font-bold text-gray-500 uppercase tracking-[0.08em]">
                  {item.section}
                </p>
              )}
              {showSection && isCollapsed && (
                <div className="my-2 mx-3 border-t border-white/10" />
              )}
              <NavItem
                item={item}
                collapsed={isCollapsed}
                accentActive={accentActive}
                onClick={onNavClick}
              />
            </React.Fragment>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="border-t border-white/10 p-3">
        <div className={`flex items-center gap-3 ${isCollapsed ? 'justify-center' : ''}`}>
          <div className={`w-8 h-8 ${accentAvatarBg} rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0`}>
            {user?.name?.[0]?.toUpperCase()}
          </div>
          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{user?.name}</p>
              <p className="text-xs text-gray-400 capitalize truncate">{roleLabel()}</p>
            </div>
          )}
        </div>
        {!isCollapsed && (
          <button
            onClick={handleLogout}
            className="mt-3 w-full flex items-center gap-2 px-3 py-2 rounded-lg
                       text-xs text-gray-400 hover:text-white hover:bg-white/10
                       transition-colors duration-150"
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign out
          </button>
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">

      {/* ── Mobile backdrop ────────────────────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Desktop Sidebar ─────────────────────────────────────────────────── */}
      <aside
        className={`
          hidden lg:flex flex-col sidebar-transition shrink-0
          bg-gray-900 text-white
          ${sidebarOpen ? 'w-60' : 'w-16'}
        `}
        aria-label="Sidebar"
      >
        <SidebarContent onNavClick={undefined} />
      </aside>

      {/* ── Mobile Sidebar (overlay) ─────────────────────────────────────────── */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 flex flex-col w-64
          bg-gray-900 text-white sidebar-transition
          lg:hidden
          ${mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}
        `}
        aria-label="Mobile sidebar"
      >
        {/* Mobile close button */}
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Close sidebar"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <SidebarContent onNavClick={() => setMobileOpen(false)} />
      </aside>

      {/* ── Main content area ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top bar */}
        <header className="bg-white border-b border-gray-100 px-4 sm:px-6 py-3 flex items-center gap-3 shrink-0 h-14">
          {/* Hamburger — mobile opens overlay, desktop collapses inline */}
          <button
            onClick={() => {
              if (window.innerWidth < 1024) {
                setMobileOpen(o => !o);
              } else {
                setSidebarOpen(o => !o);
              }
            }}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors shrink-0"
            aria-label="Toggle sidebar"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Mobile logo (shown when sidebar closed) */}
          <div className="lg:hidden">
            <FlowLogo size="xs" />
          </div>

          <div className="flex-1" />

          {/* Notifications */}
          {!isSuperAdmin && <NotificationBell />}

          {/* User pill */}
          <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-gray-100">
            <span className={`w-2 h-2 rounded-full ${accentDot} animate-pulse`} />
            <span className="text-sm font-medium text-gray-700 capitalize">
              {isSuperAdmin ? 'Super Admin' : user?.role}
            </span>
            {user?.tenantName && !isSuperAdmin && (
              <span className="text-gray-400 text-xs truncate max-w-[120px]">· {user.tenantName}</span>
            )}
          </div>

          {/* Avatar button */}
          <div className={`w-8 h-8 ${accentAvatarBg} rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0 cursor-pointer`}
               title={user?.name}>
            {user?.name?.[0]?.toUpperCase()}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6" id="main-content">
          <Outlet />
        </main>
      </div>

      {/* AI Chat Widget */}
      {!isSuperAdmin && <AIChatWidget />}
    </div>
  );
}
