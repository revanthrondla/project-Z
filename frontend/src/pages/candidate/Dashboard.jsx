import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api';

function StatCard({ icon, label, value, color = 'blue' }) {
  const colors = { blue: 'bg-blue-50 text-blue-600', green: 'bg-green-50 text-green-600', yellow: 'bg-yellow-50 text-yellow-600', purple: 'bg-purple-50 text-purple-600' };
  return (
    <div className="card p-5">
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${colors[color]}`}>{icon}</div>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
}

export default function CandidateDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [recentEntries, setRecentEntries] = useState([]);
  const [candidate, setCandidate] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.candidateId) return;
    Promise.all([
      api.get(`/api/candidates/${user.candidateId}/stats`),
      api.get(`/api/candidates/${user.candidateId}`),
      api.get('/api/time-entries', { params: { candidate_id: user.candidateId } })
    ]).then(([s, c, te]) => {
      setStats(s.data);
      setCandidate(c.data);
      setRecentEntries(te.data.slice(0, 5));
    }).finally(() => setLoading(false));
  }, [user]);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>;

  const paidTotal = stats?.invoiceStats?.find(i => i.status === 'paid')?.total || 0;
  const pendingTotal = stats?.invoiceStats?.find(i => i.status === 'sent')?.total || 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Welcome back, {user?.name?.split(' ')[0]}! 👋</h1>
        <p className="text-gray-500 mt-1">
          {candidate?.role} · {candidate?.client_name ? `Placed at ${candidate.client_name}` : 'No client assigned'} · ${candidate?.hourly_rate}/hr
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon="⏱️" label="Hours This Month" value={(stats?.monthlyHours || 0).toFixed(1)} color="blue" />
        <StatCard icon="📅" label="Hours This Year" value={(stats?.yearlyHours || 0).toFixed(1)} color="purple" />
        <StatCard icon="⏳" label="Pending Approvals" value={stats?.pendingEntries || 0} color="yellow" />
        <StatCard icon="💰" label="Total Earned" value={`$${paidTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} color="green" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Recent Time Entries */}
        <div className="card lg:col-span-2">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Recent Time Entries</h2>
            <Link to="/log-hours" className="text-sm text-blue-600 hover:underline">Log hours →</Link>
          </div>
          {recentEntries.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <div className="text-3xl mb-2">⏱️</div>
              <p>No time entries yet</p>
              <Link to="/log-hours" className="mt-2 inline-block text-blue-600 text-sm hover:underline">Log your first hours</Link>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {recentEntries.map(e => (
                <div key={e.id} className="px-6 py-3 flex items-center gap-4">
                  <div className="text-sm text-gray-400 w-24 shrink-0">{e.date}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{e.project || 'General'}</p>
                    <p className="text-xs text-gray-400 truncate">{e.description || '—'}</p>
                  </div>
                  <div className="text-sm font-medium text-gray-700 shrink-0">{e.hours}h</div>
                  <span className={`badge-${e.status} shrink-0`}>{e.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions + Absence Summary */}
        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Quick Actions</h3>
            <div className="space-y-2">
              <Link to="/log-hours" className="flex items-center gap-3 p-3 rounded-lg hover:bg-blue-50 transition-colors group">
                <span className="text-xl">⏱️</span>
                <div>
                  <p className="text-sm font-medium text-gray-900 group-hover:text-blue-700">Log Today's Hours</p>
                  <p className="text-xs text-gray-400">Track your work time</p>
                </div>
              </Link>
              <Link to="/my-absences" className="flex items-center gap-3 p-3 rounded-lg hover:bg-orange-50 transition-colors group">
                <span className="text-xl">🏖️</span>
                <div>
                  <p className="text-sm font-medium text-gray-900 group-hover:text-orange-700">Request Absence</p>
                  <p className="text-xs text-gray-400">Vacation, sick day, etc.</p>
                </div>
              </Link>
              <Link to="/my-invoices" className="flex items-center gap-3 p-3 rounded-lg hover:bg-green-50 transition-colors group">
                <span className="text-xl">📄</span>
                <div>
                  <p className="text-sm font-medium text-gray-900 group-hover:text-green-700">View Invoices</p>
                  <p className="text-xs text-gray-400">${pendingTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })} pending</p>
                </div>
              </Link>
            </div>
          </div>

          {stats?.absenceStats?.length > 0 && (
            <div className="card p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Approved Absences</h3>
              <div className="space-y-2">
                {stats.absenceStats.map(a => (
                  <div key={a.type} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 capitalize">{a.type}</span>
                    <span className="font-medium text-gray-900">{a.count} day{a.count !== 1 ? 's' : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
