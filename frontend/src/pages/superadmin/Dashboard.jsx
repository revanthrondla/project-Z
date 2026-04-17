import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

// ── Tiny helpers ───────────────────────────────────────────────────────────────

function KPI({ label, value, sub, color = 'blue' }) {
  const colors = {
    blue:   'bg-emerald-50 border-blue-200 text-emerald-700',
    green:  'bg-green-50 border-green-200 text-green-700',
    amber:  'bg-amber-50 border-amber-200 text-amber-700',
    red:    'bg-red-50 border-red-200 text-red-700',
    purple: 'bg-purple-50 border-purple-200 text-purple-700',
  };
  return (
    <div className={`rounded-xl border p-5 ${colors[color]}`}>
      <p className="text-sm font-medium opacity-75">{label}</p>
      <p className="text-3xl font-bold mt-1">{value ?? '—'}</p>
      {sub && <p className="text-xs mt-1 opacity-60">{sub}</p>}
    </div>
  );
}

const STATUS_CONFIG = {
  new:           { label: 'New',          cls: 'bg-blue-100 text-blue-700' },
  contacted:     { label: 'Contacted',    cls: 'bg-amber-100 text-amber-700' },
  qualified:     { label: 'Qualified',    cls: 'bg-emerald-100 text-emerald-700' },
  disqualified:  { label: 'Disqualified', cls: 'bg-gray-100 text-gray-500' },
  converted:     { label: 'Converted',    cls: 'bg-purple-100 text-purple-700' },
};

const STATUS_ORDER = ['new', 'contacted', 'qualified', 'disqualified', 'converted'];

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || { label: status, cls: 'bg-gray-100 text-gray-500' };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Leads section ─────────────────────────────────────────────────────────────

function LeadsSection() {
  const [leads, setLeads]           = useState([]);
  const [stats, setStats]           = useState(null);
  const [loading, setLoading]       = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [updatingId, setUpdatingId] = useState(null);

  const load = (filter = statusFilter) => {
    setLoading(true);
    const params = filter !== 'all' ? `?status=${filter}&limit=10` : '?limit=10';
    Promise.all([
      api.get(`/api/super-admin/demo-requests${params}`),
      api.get('/api/super-admin/demo-requests/stats'),
    ]).then(([lr, sr]) => {
      setLeads(lr.data.leads || []);
      setStats(sr.data);
    }).catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFilterChange = (f) => {
    setStatusFilter(f);
    load(f);
  };

  const handleStatusChange = async (id, newStatus) => {
    setUpdatingId(id);
    try {
      await api.patch(`/api/super-admin/demo-requests/${id}/status`, { status: newStatus });
      setLeads(prev => prev.map(l => l.id === id ? { ...l, status: newStatus } : l));
    } catch (err) {
      console.error('Status update failed:', err);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div>
      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-5">
          {[
            { key: 'total',   label: 'Total Leads', color: 'blue' },
            { key: 'new',     label: 'New',         color: 'blue' },
            { key: 'contacted', label: 'Contacted', color: 'amber' },
            { key: 'qualified', label: 'Qualified', color: 'green' },
            { key: 'converted', label: 'Converted', color: 'purple' },
            { key: 'this_week', label: 'This Week', color: 'green' },
          ].map(({ key, label, color }) => (
            <KPI key={key} label={label} value={stats[key]} color={color} />
          ))}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {['all', ...STATUS_ORDER].map(f => (
          <button
            key={f}
            onClick={() => handleFilterChange(f)}
            className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
              statusFilter === f
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-emerald-400 hover:text-emerald-600'
            }`}
          >
            {f === 'all' ? 'All' : STATUS_CONFIG[f]?.label || f}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
          </div>
        ) : leads.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-4xl mb-3">📬</div>
            <p className="text-gray-500 text-sm">No demo requests yet.</p>
            <p className="text-gray-400 text-xs mt-1">They'll appear here once visitors submit the form on the marketing site.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Lead</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Company</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Message</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {leads.map(lead => (
                  <tr key={lead.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">{lead.name}</p>
                      <a
                        href={`mailto:${lead.email}`}
                        className="text-xs text-emerald-600 hover:underline"
                      >
                        {lead.email}
                      </a>
                      {lead.phone && (
                        <p className="text-xs text-gray-400 mt-0.5">{lead.phone}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {lead.company || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 max-w-xs">
                      {lead.message
                        ? <span title={lead.message} className="line-clamp-2">{lead.message}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={lead.status}
                        disabled={updatingId === lead.id}
                        onChange={e => handleStatusChange(lead.id, e.target.value)}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white cursor-pointer focus:outline-none focus:border-emerald-400"
                      >
                        {STATUS_ORDER.map(s => (
                          <option key={s} value={s}>{STATUS_CONFIG[s]?.label || s}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                      {timeAgo(lead.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main dashboard ─────────────────────────────────────────────────────────────

export default function SuperAdminDashboard() {
  const [stats, setStats]               = useState(null);
  const [supportStats, setSupportStats] = useState(null);
  const [tenants, setTenants]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [activeTab, setActiveTab]       = useState('overview');

  useEffect(() => {
    Promise.all([
      api.get('/api/super-admin/stats'),
      api.get('/api/super-admin/tenants'),
      api.get('/api/platform-support/stats').catch(() => ({ data: null })),
    ]).then(([s, t, ps]) => {
      setStats(s.data);
      setTenants(t.data.slice(0, 5));
      setSupportStats(ps.data);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600" />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Flow Platform Overview</h1>
          <p className="text-sm text-gray-500 mt-1">Super-admin dashboard — manage all provisioned organisations</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {[
          { key: 'overview', label: 'Overview' },
          { key: 'leads',    label: 'Demo Leads' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab.key
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Overview tab ── */}
      {activeTab === 'overview' && (
        <>
          {/* Platform KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            <KPI label="Total Tenants"    value={stats?.total}           color="blue"   />
            <KPI label="Active"           value={stats?.active}          color="green"  />
            <KPI label="Trial"            value={stats?.trial}           color="amber"  />
            <KPI label="Suspended"        value={stats?.suspended}       color="red"    />
            <KPI label="Total Candidates" value={stats?.totalCandidates} color="purple" />
            <KPI label="Total Clients"    value={stats?.totalClients}    color="blue"   sub="across all tenants" />
          </div>

          {/* Platform Support KPIs */}
          {supportStats && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-800">Platform Support</h2>
                <Link to="/super-admin/support" className="text-sm text-emerald-600 hover:underline">View all tickets →</Link>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KPI label="Total Tickets" value={supportStats.total}       color="blue"   />
                <KPI label="Open"          value={supportStats.open}        color="amber"  />
                <KPI label="In Progress"   value={supportStats.in_progress} color="purple" />
                <KPI label="Urgent / High" value={(supportStats.urgent || 0) + (supportStats.high_priority || 0)} color="red" sub="need attention" />
              </div>
            </div>
          )}

          {/* Recent tenants */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">Recently Provisioned</h2>
              <a href="/super-admin/tenants" className="text-sm text-emerald-600 hover:underline">View all →</a>
            </div>
            <div className="divide-y divide-gray-50">
              {tenants.length === 0 && (
                <p className="px-5 py-8 text-center text-gray-400 text-sm">No organisations provisioned yet.</p>
              )}
              {tenants.map(t => (
                <div key={t.id} className="flex items-center gap-4 px-5 py-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                    {t.company_logo
                      ? <img src={t.company_logo} alt="" className="w-9 h-9 rounded-lg object-cover" />
                      : t.company_name[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-gray-900 truncate">{t.company_name}</p>
                    <p className="text-xs text-gray-400">Code: <span className="font-mono">{t.slug}</span></p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    t.status === 'active'   ? 'bg-green-100 text-green-700'
                    : t.status === 'trial' ? 'bg-amber-100 text-amber-700'
                    : 'bg-red-100 text-red-700'
                  }`}>{t.status}</span>
                  <div className="text-right text-xs text-gray-500 shrink-0">
                    <p>{t.candidate_count ?? 0} candidates</p>
                    <p>{t.client_count ?? 0} clients</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Demo Leads tab ── */}
      {activeTab === 'leads' && <LeadsSection />}
    </div>
  );
}
