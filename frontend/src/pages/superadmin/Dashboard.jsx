import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

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

export default function SuperAdminDashboard() {
  const [stats, setStats]           = useState(null);
  const [supportStats, setSupportStats] = useState(null);
  const [tenants, setTenants]       = useState([]);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/api/super-admin/stats'),
      api.get('/api/super-admin/tenants'),
      api.get('/api/platform-support/stats').catch(() => ({ data: null })),
    ]).then(([s, t, ps]) => {
      setStats(s.data);
      setTenants(t.data.slice(0, 5)); // recent 5
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
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Flow Platform Overview</h1>
        <p className="text-sm text-gray-500 mt-1">Super-admin dashboard — manage all provisioned organisations</p>
      </div>

      {/* Platform KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <KPI label="Total Tenants"       value={stats?.total}            color="blue"   />
        <KPI label="Active"              value={stats?.active}           color="green"  />
        <KPI label="Trial"               value={stats?.trial}            color="amber"  />
        <KPI label="Suspended"           value={stats?.suspended}        color="red"    />
        <KPI label="Total Candidates"    value={stats?.totalCandidates}  color="purple" />
        <KPI label="Total Clients"       value={stats?.totalClients}     color="blue"   sub="across all tenants" />
      </div>

      {/* Platform Support KPIs */}
      {supportStats && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-800">Platform Support</h2>
            <Link to="/super-admin/support" className="text-sm text-emerald-600 hover:underline">View all tickets →</Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPI label="Total Tickets"   value={supportStats.total}       color="blue"   />
            <KPI label="Open"            value={supportStats.open}        color="amber"  />
            <KPI label="In Progress"     value={supportStats.in_progress} color="purple" />
            <KPI label="Urgent / High"   value={(supportStats.urgent || 0) + (supportStats.high_priority || 0)} color="red" sub="need attention" />
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
                t.status === 'active'    ? 'bg-green-100 text-green-700'
                : t.status === 'trial'  ? 'bg-amber-100 text-amber-700'
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
    </div>
  );
}
