/**
 * Access Review — SOC 2 CC6.3
 * Periodic user access certification report for admins.
 * Lists all users with role, MFA status, last login, and flags dormant accounts.
 */
import { useState, useEffect, useCallback } from 'react';
import api from '../../api';

const ROLE_LABELS = {
  admin:     'Admin',
  recruiter: 'Recruiter',
  employee:  'Employee',
  client:    'Client',
};

const ROLE_COLORS = {
  admin:     'bg-purple-100 text-purple-800',
  recruiter: 'bg-blue-100 text-blue-800',
  employee:  'bg-green-100 text-green-800',
  client:    'bg-yellow-100 text-yellow-800',
};

function daysAgo(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function exportCsv(report) {
  const headers = ['Name', 'Email', 'Role', 'MFA Enabled', 'MFA Method', 'Last Login', 'Days Since Login', 'Must Change Password', 'Employee Status', 'Account Created'];
  const rows = report.users.map(u => {
    const days = daysAgo(u.last_login_at);
    return [
      u.name, u.email,
      ROLE_LABELS[u.role] || u.role,
      u.mfa_enabled ? 'Yes' : 'No',
      u.mfa_method || '—',
      fmtDate(u.last_login_at),
      days !== null ? days : 'Never',
      u.must_change_password ? 'Yes' : 'No',
      u.employee_status || '—',
      fmtDate(u.created_at),
    ];
  });
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `access-review-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function LockedAccountsPanel() {
  const [locked,    setLocked]    = useState([]);
  const [lLoading,  setLLoading]  = useState(true);
  const [unlocking, setUnlocking] = useState(null);

  const loadLocked = useCallback(() => {
    setLLoading(true);
    api.get('/settings/locked-accounts')
      .then(r => setLocked(r.data))
      .catch(() => {})
      .finally(() => setLLoading(false));
  }, []);

  useEffect(() => { loadLocked(); }, [loadLocked]);

  const unlock = async email => {
    setUnlocking(email);
    try {
      await api.delete(`/settings/locked-accounts/${encodeURIComponent(email)}`);
      loadLocked();
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to unlock account');
    } finally {
      setUnlocking(null);
    }
  };

  if (lLoading) return <div className="py-6 text-center text-gray-400 text-sm">Loading locked accounts…</div>;

  if (locked.length === 0) return (
    <div className="py-6 text-center text-green-600 text-sm font-medium">✓ No accounts are currently locked out</div>
  );

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-red-50 border-b border-red-200 text-left text-xs text-red-700 uppercase tracking-wide">
          <th className="px-4 py-3">Email</th>
          <th className="px-4 py-3">Failed Attempts</th>
          <th className="px-4 py-3">Locked Until</th>
          <th className="px-4 py-3">Last Attempt</th>
          <th className="px-4 py-3"></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {locked.map(acc => (
          <tr key={acc.email} className="hover:bg-red-50/50">
            <td className="px-4 py-3 font-medium text-gray-900">{acc.email}</td>
            <td className="px-4 py-3 text-red-600 font-semibold">{acc.attempts}</td>
            <td className="px-4 py-3 text-gray-600">{fmtDate(acc.locked_until)}</td>
            <td className="px-4 py-3 text-gray-500">{fmtDate(acc.last_attempt_at)}</td>
            <td className="px-4 py-3">
              <button
                onClick={() => unlock(acc.email)}
                disabled={unlocking === acc.email}
                className="px-3 py-1 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {unlocking === acc.email ? 'Unlocking…' : 'Unlock'}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AccessReview() {
  const [report,  setReport]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [filter,  setFilter]  = useState('all'); // all | no_mfa | dormant | must_change

  useEffect(() => {
    api.get('/settings/access-review')
      .then(r => setReport(r.data))
      .catch(e => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = report?.users?.filter(u => {
    if (filter === 'no_mfa')     return !u.mfa_enabled;
    if (filter === 'dormant')    return !u.last_login_at || daysAgo(u.last_login_at) > 90;
    if (filter === 'must_change') return u.must_change_password;
    return true;
  }) ?? [];

  if (loading) return <div className="p-8 text-gray-500">Loading access review…</div>;
  if (error)   return <div className="p-8 text-red-600">Error: {error}</div>;

  const { summary, generatedAt } = report;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Access Review</h1>
          <p className="text-sm text-gray-500 mt-1">
            SOC 2 CC6.3 — Generated {new Date(generatedAt).toLocaleString()}
          </p>
        </div>
        <button
          onClick={() => exportCsv(report)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
        >
          ⬇ Export CSV
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Users',         value: summary.totalUsers,    color: 'bg-blue-50 border-blue-200 text-blue-800',    icon: '👥' },
          { label: 'MFA Enabled',         value: summary.mfaEnabled,    color: 'bg-green-50 border-green-200 text-green-800', icon: '🔐' },
          { label: 'Dormant (90+ days)',  value: summary.noRecentLogin, color: 'bg-amber-50 border-amber-200 text-amber-800', icon: '⚠️' },
          { label: 'Must Change PW',      value: summary.mustChangePw,  color: 'bg-red-50 border-red-200 text-red-800',       icon: '🔑' },
        ].map(card => (
          <div key={card.label} className={`border rounded-xl p-4 ${card.color}`}>
            <div className="text-2xl mb-1">{card.icon}</div>
            <div className="text-3xl font-bold">{card.value}</div>
            <div className="text-sm font-medium mt-1">{card.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {[
          { key: 'all',         label: `All (${report.users.length})` },
          { key: 'no_mfa',      label: `No MFA (${summary.totalUsers - summary.mfaEnabled})` },
          { key: 'dormant',     label: `Dormant (${summary.noRecentLogin})` },
          { key: 'must_change', label: `Must Change PW (${summary.mustChangePw})` },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              filter === f.key
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-left text-gray-600">
              <th className="px-4 py-3 font-semibold">User</th>
              <th className="px-4 py-3 font-semibold">Role</th>
              <th className="px-4 py-3 font-semibold">MFA</th>
              <th className="px-4 py-3 font-semibold">Last Login</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Flags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">No users match this filter</td>
              </tr>
            )}
            {filtered.map(u => {
              const days     = daysAgo(u.last_login_at);
              const dormant  = days === null || days > 90;
              const flags    = [];
              if (!u.mfa_enabled)         flags.push({ label: 'No MFA',          bg: 'bg-red-100 text-red-700' });
              if (dormant)                flags.push({ label: days === null ? 'Never logged in' : `${days}d inactive`, bg: 'bg-amber-100 text-amber-700' });
              if (u.must_change_password) flags.push({ label: 'Must change PW',  bg: 'bg-orange-100 text-orange-700' });

              return (
                <tr key={u.id} className={dormant ? 'bg-amber-50/40' : 'hover:bg-gray-50'}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{u.name}</div>
                    <div className="text-xs text-gray-500">{u.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[u.role] || 'bg-gray-100 text-gray-700'}`}>
                      {ROLE_LABELS[u.role] || u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.mfa_enabled
                      ? <span className="text-green-600 font-medium">✓ {u.mfa_method || 'enabled'}</span>
                      : <span className="text-red-500 font-medium">✗ None</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {u.last_login_at
                      ? <>{fmtDate(u.last_login_at)} <span className="text-gray-400">({days}d ago)</span></>
                      : <span className="text-red-400">Never</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    {u.employee_status
                      ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          u.employee_status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                        }`}>{u.employee_status}</span>
                      : <span className="text-gray-400">—</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {flags.map((f, i) => (
                        <span key={i} className={`px-2 py-0.5 rounded-full text-xs font-medium ${f.bg}`}>{f.label}</span>
                      ))}
                      {flags.length === 0 && <span className="text-green-500 text-xs">✓ OK</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer note */}
      <p className="mt-4 text-xs text-gray-400 text-center">
        This report is generated in real-time from your tenant's user directory. Review quarterly per SOC 2 CC6.3.
      </p>

      {/* Locked Accounts */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">🔒 Locked Accounts</h2>
        <p className="text-sm text-gray-500 mb-3">
          Accounts locked after repeated failed login attempts. Admins can unlock early.
        </p>
        <div className="bg-white rounded-xl border border-red-200 overflow-hidden shadow-sm">
          <LockedAccountsPanel />
        </div>
      </div>
    </div>
  );
}
