import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useModules } from '../../contexts/ModulesContext';
import api from '../../api';

// ── Compact clock-in/out widget ───────────────────────────────────────────────
function useElapsedMins(sinceTs) {
  const [mins, setMins] = useState(0);
  useEffect(() => {
    if (!sinceTs) { setMins(0); return; }
    const tick = () => setMins(Math.floor((Date.now() - new Date(sinceTs)) / 60000));
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, [sinceTs]);
  return mins;
}

function ClockMiniWidget() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const { hasModule } = useModules();

  const load = useCallback(() => {
    api.get('/api/attendance/status')
      .then(r => setStatus(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const elapsedMins = useElapsedMins(status?.clocked_in_at);

  const doAction = async (endpoint, body = {}) => {
    setActionLoading(true);
    try { await api.post(`/api/attendance/${endpoint}`, body); load(); }
    catch { /* silent — user can go to full page */ }
    finally { setActionLoading(false); }
  };

  if (!hasModule('hr_timesheets')) return null;
  if (loading) return null;

  const live = status?.live_status || 'not_started';
  const isIn    = live === 'clocked_in';
  const isBreak = live === 'on_break';
  const isOut   = live === 'clocked_out' || live === 'not_started';

  const h = String(Math.floor(elapsedMins / 60)).padStart(2, '0');
  const m = String(elapsedMins % 60).padStart(2, '0');

  return (
    <div className={`card p-4 flex items-center gap-4 mb-6 border-l-4 ${
      isIn ? 'border-emerald-500' : isBreak ? 'border-amber-400' : 'border-gray-200'
    }`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ${
        isIn ? 'bg-emerald-50' : isBreak ? 'bg-amber-50' : 'bg-gray-50'
      }`}>
        {isIn ? '🟢' : isBreak ? '⏸️' : '⭕'}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">
          {isIn ? `Clocked in — ${h}:${m}` : isBreak ? 'On break' : 'Not clocked in'}
        </p>
        <p className="text-xs text-gray-400">
          {isIn && status?.clocked_in_at
            ? `Since ${new Date(status.clocked_in_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
            : isOut ? 'Tap to start your day' : 'Break in progress'}
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        {isOut && (
          <button
            onClick={() => doAction('clock-in')}
            disabled={actionLoading}
            className="btn-primary text-xs px-3 py-1.5"
          >
            {actionLoading ? '…' : '🟢 Clock In'}
          </button>
        )}
        {isIn && (
          <>
            <button
              onClick={() => doAction('break-start')}
              disabled={actionLoading}
              className="btn-secondary text-xs px-3 py-1.5"
            >Break</button>
            <button
              onClick={() => doAction('clock-out')}
              disabled={actionLoading}
              className="text-xs px-3 py-1.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
            >Clock Out</button>
          </>
        )}
        {isBreak && (
          <button
            onClick={() => doAction('break-end')}
            disabled={actionLoading}
            className="btn-primary text-xs px-3 py-1.5"
          >End Break</button>
        )}
        <Link to="/clock" className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 hover:underline">
          Full view →
        </Link>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color = 'blue' }) {
  const colors = { blue: 'bg-emerald-50 text-emerald-600', green: 'bg-green-50 text-green-600', yellow: 'bg-yellow-50 text-yellow-600', purple: 'bg-purple-50 text-purple-600' };
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
    if (!user?.employeeId) return;
    Promise.all([
      api.get(`/api/employees/${user.employeeId}/stats`),
      api.get(`/api/employees/${user.employeeId}`),
      api.get('/api/time-entries', { params: { candidate_id: user.employeeId } })
    ]).then(([s, c, te]) => {
      setStats(s.data);
      setCandidate(c.data);
      setRecentEntries((Array.isArray(te.data) ? te.data : []).slice(0, 5));
    }).finally(() => setLoading(false));
  }, [user]);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div></div>;

  const paidTotal = Number(stats?.invoiceStats?.find(i => i.status === 'paid')?.total || 0);
  const pendingTotal = Number(stats?.invoiceStats?.find(i => i.status === 'sent')?.total || 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Welcome back, {user?.name?.split(' ')[0]}! 👋</h1>
        <p className="text-gray-500 mt-1">
          {candidate?.role} · {candidate?.client_name ? `Placed at ${candidate.client_name}` : 'No client assigned'} · ${candidate?.hourly_rate}/hr
        </p>
      </div>

      <ClockMiniWidget />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon="⏱️" label="Hours This Month" value={Number(stats?.monthlyHours || 0).toFixed(1)} color="blue" />
        <StatCard icon="📅" label="Hours This Year" value={Number(stats?.yearlyHours || 0).toFixed(1)} color="purple" />
        <StatCard icon="⏳" label="Pending Approvals" value={stats?.pendingEntries || 0} color="yellow" />
        <StatCard icon="💰" label="Total Earned" value={`$${paidTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} color="green" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Recent Time Entries */}
        <div className="card lg:col-span-2">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Recent Time Entries</h2>
            <Link to="/log-hours" className="text-sm text-emerald-600 hover:underline">Log hours →</Link>
          </div>
          {recentEntries.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <div className="text-3xl mb-2">⏱️</div>
              <p>No time entries yet</p>
              <Link to="/log-hours" className="mt-2 inline-block text-emerald-600 text-sm hover:underline">Log your first hours</Link>
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
              <Link to="/log-hours" className="flex items-center gap-3 p-3 rounded-lg hover:bg-emerald-50 transition-colors group">
                <span className="text-xl">⏱️</span>
                <div>
                  <p className="text-sm font-medium text-gray-900 group-hover:text-emerald-700">Log Today's Hours</p>
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
