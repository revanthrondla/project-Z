import React, { useState, useEffect } from 'react';
import api from '../../api';

const STATUS_BADGE = {
  active:   'bg-green-100 text-green-700',
  inactive: 'bg-gray-100 text-gray-600',
  pending:  'bg-yellow-100 text-yellow-700',
};

const CONTRACT_BADGE = {
  contractor: 'bg-blue-100 text-emerald-700',
  employee:   'bg-purple-100 text-purple-700',
  'part-time':'bg-orange-100 text-orange-700',
};

export default function ClientDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/client-portal/dashboard')
      .then(r => setData(r.data))
      .catch(() => setError('Failed to load dashboard. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600"/></div>;
  if (error) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <p className="text-gray-500">⚠️ {error}</p>
      <button onClick={() => window.location.reload()} className="btn-primary">Retry</button>
    </div>
  );

  const { client, candidates, recentTimesheets, kpis } = data;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Welcome, {client.name}</h1>
        <p className="text-gray-500 mt-1">Overview of your team and their hours</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Active Candidates', value: kpis.total_candidates, icon: '👥', color: 'text-emerald-600 bg-emerald-50' },
          { label: 'Approved Hours', value: `${kpis.total_approved_hours?.toFixed(1)}h`, icon: '✅', color: 'text-green-600 bg-green-50' },
          { label: 'Pending Hours', value: `${kpis.total_pending_hours?.toFixed(1)}h`, icon: '⏳', color: 'text-yellow-600 bg-yellow-50' },
          { label: 'Total Cost', value: `$${Number(kpis.total_cost || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, icon: '💰', color: 'text-purple-600 bg-purple-50' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl ${k.color}`}>{k.icon}</div>
            <div>
              <p className="text-xl font-bold text-gray-900">{k.value}</p>
              <p className="text-xs text-gray-500">{k.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Candidates list */}
        <div className="xl:col-span-3 bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Your Team ({candidates.length})</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {candidates.length === 0 ? (
              <p className="px-5 py-8 text-center text-gray-400 text-sm">No candidates assigned to your account yet.</p>
            ) : (
              candidates.map(c => (
                <div key={c.id} className="px-5 py-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center text-sm font-bold text-emerald-700 shrink-0">
                        {c.name[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{c.name}</p>
                        <p className="text-sm text-gray-500">{c.role}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{c.email}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="flex gap-1.5 justify-end flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[c.status] || 'bg-gray-100 text-gray-600'}`}>{c.status}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CONTRACT_BADGE[c.contract_type] || 'bg-gray-100 text-gray-600'}`}>{c.contract_type}</span>
                      </div>
                      <p className="text-sm font-semibold text-gray-900 mt-1">${c.hourly_rate}/hr</p>
                    </div>
                  </div>
                  {/* Hours bar */}
                  <div className="mt-3 grid grid-cols-3 gap-3 text-xs text-center">
                    <div>
                      <p className="font-semibold text-green-600">{Number(c.approved_hours || 0).toFixed(1)}h</p>
                      <p className="text-gray-400">Approved</p>
                    </div>
                    <div>
                      <p className="font-semibold text-yellow-600">{Number(c.pending_hours || 0).toFixed(1)}h</p>
                      <p className="text-gray-400">Pending</p>
                    </div>
                    <div>
                      <p className="font-semibold text-emerald-600">${Number(c.approved_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                      <p className="text-gray-400">Cost</p>
                    </div>
                  </div>
                  {c.start_date && (
                    <p className="text-xs text-gray-400 mt-2">
                      Since {c.start_date}{c.end_date ? ` · Until ${c.end_date}` : ''}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent timesheets */}
        <div className="xl:col-span-2 bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Recent Time Entries</h2>
          </div>
          <div className="divide-y divide-gray-50 max-h-[500px] overflow-y-auto">
            {recentTimesheets.length === 0 ? (
              <p className="px-5 py-8 text-center text-gray-400 text-sm">No time entries yet.</p>
            ) : (
              recentTimesheets.map(t => (
                <div key={t.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{t.candidate_name}</p>
                      <p className="text-xs text-gray-500">{t.date} · {t.project || 'General'}</p>
                      {t.description && <p className="text-xs text-gray-400 truncate">{t.description}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-gray-900">{t.hours}h</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        t.status === 'approved' ? 'bg-green-100 text-green-700' :
                        t.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                      }`}>{t.status}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
