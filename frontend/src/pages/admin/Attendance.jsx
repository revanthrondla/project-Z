import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';

const STATUS_CONFIG = {
  clocked_in:  { label: 'Clocked In',  bg: 'bg-green-100',  text: 'text-green-700',  dot: 'bg-green-500',  icon: '🟢' },
  on_break:    { label: 'On Break',    bg: 'bg-yellow-100', text: 'text-yellow-700', dot: 'bg-yellow-500', icon: '☕' },
  clocked_out: { label: 'Clocked Out', bg: 'bg-gray-100',   text: 'text-gray-500',   dot: 'bg-gray-400',   icon: '⚪' },
  on_leave:    { label: 'On Leave',    bg: 'bg-blue-100',   text: 'text-blue-700',   dot: 'bg-blue-500',   icon: '🏖️' },
  not_started: { label: 'Not Started', bg: 'bg-gray-50',    text: 'text-gray-400',   dot: 'bg-gray-300',   icon: '—' },
};

function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function fmtMins(mins) {
  if (!mins && mins !== 0) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Summary Stat Card ─────────────────────────────────────────────────────────
function StatCard({ label, value, icon, color = 'text-gray-900' }) {
  return (
    <div className="card p-4 text-center">
      <div className="text-2xl mb-1">{icon}</div>
      <div className={`text-3xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

// ── Daily Summary Tab ─────────────────────────────────────────────────────────
function DailySummaryTab() {
  const [records, setRecords]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [date,    setDate]      = useState(new Date().toISOString().slice(0, 10));
  const [empId,   setEmpId]     = useState('');
  const [employees, setEmployees] = useState([]);

  useEffect(() => {
    api.get('/api/employees').then(r => setEmployees(r.data || [])).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ date });
    if (empId) params.append('employee_id', empId);
    api.get(`/api/attendance/daily-summary?${params}`)
      .then(r => setRecords(r.data || []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [date, empId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <label className="label text-xs">Date</label>
          <input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div>
          <label className="label text-xs">Employee</label>
          <select className="input" value={empId} onChange={e => setEmpId(e.target.value)}>
            <option value="">All employees</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <button onClick={load} className="btn-primary text-sm">Refresh</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" /></div>
      ) : records.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">No attendance records for this date</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Employee', 'Status', 'Clock In', 'Clock Out', 'Total', 'Break', 'Net'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {records.map(r => {
                const cfg = STATUS_CONFIG[r.status] || STATUS_CONFIG.not_started;
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{r.employee_name}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />{cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{fmtTime(r.clock_in_time)}</td>
                    <td className="px-4 py-3 text-gray-600">{fmtTime(r.clock_out_time)}</td>
                    <td className="px-4 py-3 text-gray-600">{fmtMins(r.total_minutes)}</td>
                    <td className="px-4 py-3 text-gray-600">{fmtMins(r.break_minutes)}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{fmtMins(r.net_minutes)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── History Tab ───────────────────────────────────────────────────────────────
function HistoryTab() {
  const [events,    setEvents]    = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [from,      setFrom]      = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [to,        setTo]        = useState(new Date().toISOString().slice(0, 10));
  const [empId,     setEmpId]     = useState('');
  const [employees, setEmployees] = useState([]);

  useEffect(() => {
    api.get('/api/employees').then(r => setEmployees(r.data || [])).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ from, to, limit: 200 });
    if (empId) params.append('employee_id', empId);
    api.get(`/api/attendance/history?${params}`)
      .then(r => setEvents(r.data || []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [from, to, empId]);

  useEffect(() => { load(); }, [load]);

  const EVENT_ICONS = {
    clock_in:    { icon: '▶', color: 'text-green-600', label: 'Clock In' },
    clock_out:   { icon: '■', color: 'text-gray-500',  label: 'Clock Out' },
    break_start: { icon: '☕', color: 'text-yellow-600', label: 'Break Start' },
    break_end:   { icon: '↩', color: 'text-blue-600',  label: 'Break End' },
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <label className="label text-xs">From</label>
          <input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label text-xs">To</label>
          <input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <div>
          <label className="label text-xs">Employee</label>
          <select className="input" value={empId} onChange={e => setEmpId(e.target.value)}>
            <option value="">All</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <button onClick={load} className="btn-primary text-sm">Search</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" /></div>
      ) : events.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">No clock events found</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Employee', 'Event', 'Time', 'Location', 'Notes'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {events.map(ev => {
                const cfg = EVENT_ICONS[ev.event_type] || { icon: '?', color: 'text-gray-400', label: ev.event_type };
                return (
                  <tr key={ev.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{ev.employee_name}</td>
                    <td className="px-4 py-3">
                      <span className={`font-medium ${cfg.color}`}>{cfg.icon} {cfg.label}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {new Date(ev.event_time).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {ev.location_name || (ev.latitude ? `${parseFloat(ev.latitude).toFixed(4)}, ${parseFloat(ev.longitude).toFixed(4)}` : '—')}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{ev.notes || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function Attendance() {
  const [liveData,    setLiveData]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [tab,         setTab]         = useState('live');
  const [filter,      setFilter]      = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const loadLive = useCallback(() => {
    api.get('/api/attendance/live')
      .then(r => setLiveData(Array.isArray(r.data) ? r.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadLive();
    if (!autoRefresh) return;
    const id = setInterval(loadLive, 30_000); // poll every 30s
    return () => clearInterval(id);
  }, [loadLive, autoRefresh]);

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  // Summary counts
  const counts = liveData.reduce((acc, e) => {
    acc[e.live_status] = (acc[e.live_status] || 0) + 1;
    return acc;
  }, {});

  const filtered = liveData.filter(e =>
    !filter || e.name?.toLowerCase().includes(filter.toLowerCase())
  );

  const TABS = [
    { id: 'live',    label: '🟢 Live' },
    { id: 'daily',   label: '📋 Daily Summary' },
    { id: 'history', label: '📜 History' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Attendance</h1>
          <p className="text-gray-500 mt-1">{today}</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)}
              className="rounded accent-emerald-600 w-4 h-4" />
            Auto-refresh
          </label>
          <button onClick={loadLive} className="btn-secondary text-sm">↺ Refresh</button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Clocked In"  value={counts.clocked_in  || 0} icon="🟢" color="text-green-600" />
        <StatCard label="On Break"    value={counts.on_break    || 0} icon="☕" color="text-yellow-600" />
        <StatCard label="Clocked Out" value={counts.clocked_out || 0} icon="⚪" color="text-gray-500" />
        <StatCard label="On Leave"    value={counts.on_leave    || 0} icon="🏖️" color="text-blue-600" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'live' && (
        <div className="space-y-4">
          <input className="input max-w-xs" placeholder="Filter by name..."
            value={filter} onChange={e => setFilter(e.target.value)} />

          {loading ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="card text-center py-12 text-gray-400">No employees found</div>
          ) : (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['Employee', 'Status', 'Clocked In', 'Time Worked', 'Breaks', 'Net'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map(e => {
                    const cfg = STATUS_CONFIG[e.live_status] || STATUS_CONFIG.not_started;
                    return (
                      <tr key={e.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-xs font-bold text-emerald-700">
                              {e.name?.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">{e.name}</p>
                              <p className="text-xs text-gray-400">{e.role}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot} ${e.live_status === 'clocked_in' ? 'animate-pulse' : ''}`} />
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{fmtTime(e.clock_in_time)}</td>
                        <td className="px-4 py-3 text-gray-600">{fmtMins(e.total_minutes)}</td>
                        <td className="px-4 py-3 text-gray-600">{fmtMins(e.break_minutes)}</td>
                        <td className="px-4 py-3 font-medium text-gray-900">{fmtMins(e.net_minutes)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'daily'   && <DailySummaryTab />}
      {tab === 'history' && <HistoryTab />}
    </div>
  );
}
