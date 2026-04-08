import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

function StatCard({ icon, label, value, sub, color = 'blue', to }) {
  const colors = {
    blue: 'bg-emerald-50 text-emerald-600',
    green: 'bg-green-50 text-green-600',
    yellow: 'bg-yellow-50 text-yellow-600',
    purple: 'bg-purple-50 text-purple-600',
    red: 'bg-red-50 text-red-600',
  };
  const card = (
    <div className="card p-5 hover:shadow-md transition-shadow">
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${colors[color]}`}>{icon}</div>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        </div>
      </div>
    </div>
  );
  return to ? <Link to={to}>{card}</Link> : card;
}

function ActivityBadge({ status }) {
  const map = {
    pending: 'badge-pending',
    approved: 'badge-approved',
    rejected: 'badge-rejected',
  };
  return <span className={map[status] || 'badge-pending'}>{status}</span>;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/dashboard/stats')
      .then(r => setStats(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
    </div>
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">Welcome back! Here's what's happening today.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon="👥" label="Active Employees" value={stats?.totalCandidates} color="blue" to="/employees" />
        <StatCard icon="🏢" label="Clients" value={stats?.totalClients} color="purple" to="/clients" />
        <StatCard icon="⏳" label="Pending Timesheets" value={stats?.pendingTimesheets} color="yellow" to="/timesheets" />
        <StatCard icon="🏖️" label="Pending Absences" value={stats?.pendingAbsences} color="red" to="/absences" />
        <StatCard icon="⏱️" label="Hours This Month" value={stats?.monthlyHours?.toFixed(1)} color="green" />
        <StatCard
          icon="💰"
          label="Revenue This Month"
          value={`$${(stats?.revenueThisMonth || 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`}
          color="green"
          to="/invoices"
        />
        <StatCard icon="🎫" label="Open Support Tickets" value={stats?.openSupportTickets ?? 0} color="blue" to="/support-admin" />
        <StatCard icon="🚨" label="Urgent / High Priority" value={stats?.urgentSupportTickets ?? 0} color="red" to="/support-admin" />
      </div>

      {/* Recent Activity */}
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Pending Approvals</h2>
          <div className="flex gap-2">
            <Link to="/timesheets" className="text-sm text-emerald-600 hover:underline">View timesheets →</Link>
          </div>
        </div>
        {!stats?.recentActivity?.length ? (
          <div className="px-6 py-10 text-center text-gray-400">
            <div className="text-3xl mb-2">✅</div>
            <p>All caught up! No pending approvals.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {stats.recentActivity.map((item, i) => (
              <div key={i} className="px-6 py-4 flex items-center gap-4 hover:bg-gray-50">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-base ${item.type === 'timesheet' ? 'bg-emerald-50' : 'bg-orange-50'}`}>
                  {item.type === 'timesheet' ? '⏱️' : '🏖️'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{item.candidate_name}</p>
                  <p className="text-xs text-gray-500 truncate">{item.detail}</p>
                </div>
                <div className="flex items-center gap-2">
                  <ActivityBadge status={item.status} />
                  <Link
                    to={item.type === 'timesheet' ? '/timesheets' : '/absences'}
                    className="text-xs text-emerald-600 hover:underline"
                  >
                    Review
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
