import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../api';
import CustomFieldsPanel from '../../components/CustomFieldsPanel';

// ── Helpers ───────────────────────────────────────────────────────────────────
const ABSENCE_TYPES = {
  vacation:       '🌴 Vacation',
  sick:           '🤒 Sick',
  personal:       '👤 Personal',
  public_holiday: '🎉 Public Holiday',
  other:          '📌 Other',
};

const TYPE_COLORS = {
  vacation:       'bg-emerald-100 text-emerald-800',
  sick:           'bg-red-100 text-red-700',
  personal:       'bg-blue-100 text-blue-700',
  public_holiday: 'bg-purple-100 text-purple-800',
  other:          'bg-gray-100 text-gray-700',
};

function daysBetween(start, end) {
  const a = new Date(start), b = new Date(end);
  return Math.round((b - a) / (1000 * 60 * 60 * 24)) + 1;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ── Absence Custom Fields Modal ───────────────────────────────────────────────
function AbsenceCustomFieldsModal({ absence, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Custom Fields</h2>
            <p className="text-sm text-gray-500 mt-0.5">{absence.candidate_name} · {absence.start_date}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="p-5">
          <CustomFieldsPanel module="absences" recordId={absence.id} onSaved={onClose} />
        </div>
      </div>
    </div>
  );
}

// ── Reject reason modal ───────────────────────────────────────────────────────
function RejectModal({ absence, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
        <div className="px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900">Reject Absence</h3>
          <p className="text-xs text-gray-500 mt-0.5">{absence.candidate_name} · {fmtDate(absence.start_date)}</p>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="label">Reason (optional — visible to employee)</label>
            <textarea className="input" rows={3} value={reason} onChange={e => setReason(e.target.value)}
              placeholder="e.g. Insufficient cover, please rebook…" />
          </div>
          <div className="flex gap-3">
            <button
              className="flex-1 py-2 px-4 bg-red-500 text-white rounded-lg font-semibold hover:bg-red-600 transition-colors text-sm"
              disabled={loading}
              onClick={async () => { setLoading(true); await onConfirm(reason); }}
            >
              {loading ? 'Rejecting…' : 'Reject'}
            </button>
            <button className="btn-secondary text-sm" onClick={onClose} disabled={loading}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Monthly Calendar View ─────────────────────────────────────────────────────
function CalendarView({ absences }) {
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed

  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startDow = firstDay.getDay(); // 0=Sun

  // Filter absences that overlap this month
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthAbsences = absences.filter(a => {
    const start = a.start_date.slice(0, 7);
    const end   = a.end_date.slice(0, 7);
    return start <= monthStr && end >= monthStr;
  });

  // Build date → absence[] map
  const byDate = {};
  monthAbsences.forEach(a => {
    for (let d = new Date(a.start_date + 'T00:00:00'); d <= new Date(a.end_date + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
      if (d.getFullYear() === year && d.getMonth() === month) {
        const key = d.toISOString().slice(0, 10);
        if (!byDate[key]) byDate[key] = [];
        byDate[key].push(a);
      }
    }
  });

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const cells = [];
  // Leading blank cells
  const sunStart = (startDow === 0 ? 0 : startDow); // Sunday-first grid
  for (let i = 0; i < sunStart; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div>
      {/* Month nav */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="btn-secondary text-sm px-3">‹ Prev</button>
        <h3 className="font-bold text-gray-900">{MONTH_NAMES[month]} {year}</h3>
        <button onClick={nextMonth} className="btn-secondary text-sm px-3">Next ›</button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-4 text-xs">
        {Object.entries(TYPE_COLORS).map(([t, cls]) => (
          <span key={t} className={`px-2 py-1 rounded-full ${cls}`}>{ABSENCE_TYPES[t]}</span>
        ))}
      </div>

      {/* Grid header */}
      <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-t-lg overflow-hidden">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} className="bg-gray-50 text-center py-2 text-xs font-semibold text-gray-500">{d}</div>
        ))}
      </div>

      {/* Grid cells */}
      <div className="grid grid-cols-7 gap-px bg-gray-200 border-b border-l border-r border-gray-200 rounded-b-lg overflow-hidden">
        {cells.map((day, i) => {
          if (!day) return <div key={`blank-${i}`} className="bg-white min-h-[80px]" />;
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const cellAbsences = byDate[dateStr] || [];
          const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
          return (
            <div key={day} className={`bg-white min-h-[80px] p-1.5 ${isToday ? 'ring-2 ring-inset ring-emerald-400' : ''}`}>
              <p className={`text-xs font-semibold mb-1 ${isToday ? 'text-emerald-600' : 'text-gray-600'}`}>{day}</p>
              <div className="space-y-0.5">
                {cellAbsences.slice(0, 3).map((a, j) => (
                  <div key={j} className={`text-[10px] px-1 py-0.5 rounded truncate ${TYPE_COLORS[a.type] || 'bg-gray-100 text-gray-700'}`}
                    title={`${a.candidate_name} — ${ABSENCE_TYPES[a.type]}`}>
                    {a.candidate_name?.split(' ')[0]}
                  </div>
                ))}
                {cellAbsences.length > 3 && (
                  <div className="text-[10px] text-gray-400">+{cellAbsences.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Count */}
      <p className="text-xs text-gray-400 mt-3">{monthAbsences.length} absence(s) in {MONTH_NAMES[month]}</p>
    </div>
  );
}

// ── Pattern Analytics ─────────────────────────────────────────────────────────
function AnalyticsView({ absences }) {
  const approved = absences.filter(a => a.status === 'approved');

  // Per-employee totals
  const byEmployee = useMemo(() => {
    const map = {};
    approved.forEach(a => {
      const name = a.candidate_name;
      if (!map[name]) map[name] = { name, total: 0, sick: 0, types: {} };
      const d = a.is_partial_day ? (parseFloat(a.partial_hours) / 8) : daysBetween(a.start_date, a.end_date);
      map[name].total += d;
      if (a.type === 'sick') map[name].sick += d;
      map[name].types[a.type] = (map[name].types[a.type] || 0) + d;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [approved]);

  // Type breakdown
  const byType = useMemo(() => {
    const map = {};
    approved.forEach(a => {
      const d = a.is_partial_day ? (parseFloat(a.partial_hours) / 8) : daysBetween(a.start_date, a.end_date);
      map[a.type] = (map[a.type] || 0) + d;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [approved]);

  // Monthly trend (count of absence-days per month)
  const monthlyTrend = useMemo(() => {
    const map = {};
    approved.forEach(a => {
      const month = a.start_date.slice(0, 7);
      const d = a.is_partial_day ? (parseFloat(a.partial_hours) / 8) : daysBetween(a.start_date, a.end_date);
      map[month] = (map[month] || 0) + d;
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
  }, [approved]);

  const maxMonthDays = Math.max(...monthlyTrend.map(([, d]) => d), 1);
  const maxEmpDays   = Math.max(...byEmployee.map(e => e.total), 1);

  // High sick-leave flag: > 5 days sick in a year
  const highSickAbsentees = byEmployee.filter(e => e.sick >= 5);

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4 text-center">
          <p className="text-3xl font-bold text-emerald-600">{approved.length}</p>
          <p className="text-xs text-gray-500 mt-1">Approved Requests</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-3xl font-bold text-emerald-600">
            {approved.reduce((s, a) => s + (a.is_partial_day ? parseFloat(a.partial_hours) / 8 : daysBetween(a.start_date, a.end_date)), 0).toFixed(1)}
          </p>
          <p className="text-xs text-gray-500 mt-1">Total Days</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-3xl font-bold text-red-500">{highSickAbsentees.length}</p>
          <p className="text-xs text-gray-500 mt-1">High Sick-Leave Employees</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-3xl font-bold text-gray-700">{byEmployee.length}</p>
          <p className="text-xs text-gray-500 mt-1">Employees With Absences</p>
        </div>
      </div>

      {/* Monthly trend bar chart */}
      {monthlyTrend.length > 0 && (
        <div className="card p-5">
          <h3 className="font-semibold text-gray-800 mb-4">Monthly Absence Days (last 12 months)</h3>
          <div className="flex items-end gap-2 h-32">
            {monthlyTrend.map(([month, days]) => {
              const pct = Math.max(4, Math.round((days / maxMonthDays) * 100));
              const [y, m] = month.split('-');
              return (
                <div key={month} className="flex-1 flex flex-col items-center gap-1 group relative">
                  <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded
                                  opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10">
                    {days.toFixed(1)} days
                  </div>
                  <div
                    className="w-full bg-emerald-400 rounded-t transition-all"
                    style={{ height: `${pct}%` }}
                  />
                  <p className="text-[10px] text-gray-500 leading-none">{MONTH_NAMES[parseInt(m) - 1].slice(0, 3)}</p>
                  <p className="text-[10px] text-gray-400">{y.slice(2)}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Type breakdown */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h3 className="font-semibold text-gray-800 mb-4">By Type</h3>
          <div className="space-y-3">
            {byType.map(([type, days]) => {
              const pct = Math.round((days / byType.reduce((s, [, d]) => s + d, 0)) * 100);
              return (
                <div key={type}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-700">{ABSENCE_TYPES[type] || type}</span>
                    <span className="text-gray-500">{days.toFixed(1)}d ({pct}%)</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* High sick-leave flag */}
        {highSickAbsentees.length > 0 && (
          <div className="card p-5 border-l-4 border-red-400">
            <h3 className="font-semibold text-red-700 mb-3">⚠️ High Sick-Leave ({'>'}5 days)</h3>
            <div className="space-y-2">
              {highSickAbsentees.map(e => (
                <div key={e.name} className="flex items-center justify-between text-sm">
                  <span className="text-gray-800 font-medium">{e.name}</span>
                  <span className="text-red-500 font-semibold">{e.sick.toFixed(1)} sick days</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Top absentees */}
      {byEmployee.length > 0 && (
        <div className="card p-5">
          <h3 className="font-semibold text-gray-800 mb-4">Absence Days by Employee</h3>
          <div className="space-y-2">
            {byEmployee.slice(0, 10).map(e => (
              <div key={e.name}>
                <div className="flex justify-between text-sm mb-0.5">
                  <span className="text-gray-700">{e.name}</span>
                  <span className="text-gray-500">{e.total.toFixed(1)}d total · {e.sick.toFixed(1)}d sick</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all flex gap-px overflow-hidden">
                    {/* Proportional sick vs non-sick */}
                    <div className="h-full bg-red-400" style={{ width: `${Math.round((e.sick / maxEmpDays) * 100)}%` }} />
                    <div className="h-full bg-emerald-400" style={{ width: `${Math.round(((e.total - e.sick) / maxEmpDays) * 100)}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-3 text-xs text-gray-500">
            <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-full bg-red-400 inline-block" />Sick leave</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-full bg-emerald-400 inline-block" />Other absence</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AdminAbsences() {
  const [absences, setAbsences] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ candidate_id: '', status: '', year: String(new Date().getFullYear()) });
  const [cfAbsence, setCfAbsence] = useState(null);
  const [rejectAbsence, setRejectAbsence] = useState(null);
  const [tab, setTab] = useState('list'); // 'list' | 'calendar' | 'analytics'
  const [carryOverLoading, setCarryOverLoading] = useState(false);
  const [carryOverMsg, setCarryOverMsg] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    const params = {};
    if (filters.candidate_id) params.candidate_id = filters.candidate_id;
    if (filters.status) params.status = filters.status;
    if (filters.year) params.year = filters.year;
    return api.get('/api/absences', { params })
      .then(r => setAbsences(Array.isArray(r.data) ? r.data : []))
      .catch(() => setError('Failed to load absences. Is the server running?'))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => { api.get('/api/employees').then(r => setEmployees(Array.isArray(r.data) ? r.data : [])); }, []);
  useEffect(() => { load(); }, [load]);

  const approve = async (id) => {
    await api.put(`/api/absences/${id}`, { status: 'approved' });
    load();
  };

  const confirmReject = async (id, reason) => {
    await api.put(`/api/absences/${id}`, { status: 'rejected', rejection_reason: reason || undefined });
    setRejectAbsence(null);
    load();
  };

  const triggerCarryOver = async () => {
    if (!confirm('Run year-end carry-over for ALL leave policies now? This will move unused balances to carry-over.')) return;
    setCarryOverLoading(true);
    setCarryOverMsg('');
    try {
      const r = await api.post('/api/leave-balances/carry-over');
      setCarryOverMsg(`✅ ${r.data?.message || 'Carry-over completed successfully'}`);
    } catch (err) {
      setCarryOverMsg(`❌ ${err.response?.data?.error || 'Carry-over failed'}`);
    } finally {
      setCarryOverLoading(false);
    }
  };

  const TABS = [
    { key: 'list',      label: '📋 List' },
    { key: 'calendar',  label: '📅 Calendar' },
    { key: 'analytics', label: '📊 Analytics' },
  ];

  // Pending count badge
  const pendingCount = absences.filter(a => a.status === 'pending').length;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Absence Management</h1>
          <p className="text-gray-500 mt-1">
            {absences.length} records
            {pendingCount > 0 && <span className="ml-2 badge-pending">{pendingCount} pending</span>}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={triggerCarryOver}
            disabled={carryOverLoading}
            className="btn-secondary text-sm"
            title="Run year-end leave carry-over for all policies"
          >
            {carryOverLoading ? '⏳ Running…' : '🔄 Year-End Carry-Over'}
          </button>
        </div>
      </div>

      {carryOverMsg && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${carryOverMsg.startsWith('✅') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {carryOverMsg}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              tab === t.key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters (list + calendar) */}
      {tab !== 'analytics' && (
        <div className="flex flex-wrap gap-3 mb-5">
          <select className="input max-w-[200px]" value={filters.candidate_id} onChange={e => setFilters(f => ({...f, candidate_id: e.target.value}))}>
            <option value="">All Employees</option>
            {employees.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="input max-w-[160px]" value={filters.status} onChange={e => setFilters(f => ({...f, status: e.target.value}))}>
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <input type="number" placeholder="Year" className="input max-w-[120px]" value={filters.year}
            onChange={e => setFilters(f => ({...f, year: e.target.value}))} />
          <button onClick={() => setFilters({ candidate_id: '', status: '', year: String(new Date().getFullYear()) })}
            className="btn-secondary text-sm">Reset</button>
        </div>
      )}

      {/* ── Tab: List ── */}
      {tab === 'list' && (
        <div className="card overflow-hidden">
          {error ? (
            <div className="text-center py-16 text-red-500">
              <div className="text-4xl mb-2">⚠️</div>
              <p>{error}</p>
              <button onClick={load} className="mt-3 btn-primary text-sm">Retry</button>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
            </div>
          ) : absences.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <div className="text-4xl mb-2">🏖️</div>
              <p>No absences found</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Employee</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Type</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Period</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Days</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Notes</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
                  <th className="text-right px-4 py-3 text-gray-500 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {absences.map(a => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center text-emerald-700 font-semibold text-xs">
                          {a.candidate_name?.[0]}
                        </div>
                        <span className="font-medium text-gray-900">{a.candidate_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[a.type] || 'bg-gray-100 text-gray-700'}`}>
                        {ABSENCE_TYPES[a.type] || a.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {a.start_date === a.end_date
                        ? fmtDate(a.start_date)
                        : `${fmtDate(a.start_date)} → ${fmtDate(a.end_date)}`}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {a.is_partial_day ? `${a.partial_hours}h` : `${daysBetween(a.start_date, a.end_date)}d`}
                    </td>
                    <td className="px-4 py-3 text-gray-500 max-w-[160px] truncate">
                      {a.rejection_reason
                        ? <span className="text-red-500 text-xs">Reason: {a.rejection_reason}</span>
                        : (a.notes || '—')}
                    </td>
                    <td className="px-4 py-3"><span className={`badge-${a.status}`}>{a.status}</span></td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {a.status === 'pending' && (
                          <>
                            <button onClick={() => approve(a.id)} className="text-green-600 hover:underline text-xs font-medium">Approve</button>
                            <button onClick={() => setRejectAbsence(a)} className="text-red-500 hover:underline text-xs">Reject</button>
                          </>
                        )}
                        <button onClick={() => setCfAbsence(a)} className="text-gray-400 hover:text-emerald-600 text-xs" title="Custom Fields">⚙️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Tab: Calendar ── */}
      {tab === 'calendar' && (
        <div className="card p-6">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
            </div>
          ) : (
            <CalendarView absences={absences} />
          )}
        </div>
      )}

      {/* ── Tab: Analytics ── */}
      {tab === 'analytics' && (
        loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
          </div>
        ) : (
          <AnalyticsView absences={absences} />
        )
      )}

      {/* Modals */}
      {cfAbsence && (
        <AbsenceCustomFieldsModal absence={cfAbsence} onClose={() => setCfAbsence(null)} />
      )}
      {rejectAbsence && (
        <RejectModal
          absence={rejectAbsence}
          onConfirm={(reason) => confirmReject(rejectAbsence.id, reason)}
          onClose={() => setRejectAbsence(null)}
        />
      )}
    </div>
  );
}
