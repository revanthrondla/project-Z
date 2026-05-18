import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell,
} from 'recharts';
import api from '../../api';

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
const fmt   = (n, dec = 1) => Number(n || 0).toFixed(dec);
const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct   = (part, total) => total ? `${((Number(part) / Number(total)) * 100).toFixed(0)}%` : '0%';

/* ─── DeltaBadge ──────────────────────────────────────────────────────────── */
function DeltaBadge({ pct_change }) {
  if (pct_change === undefined || pct_change === null) return null;
  const n = Number(pct_change);
  const pos = n >= 0;
  return (
    <span className={`ml-1 text-xs font-semibold px-1.5 py-0.5 rounded ${pos ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
      {pos ? '↑' : '↓'}{Math.abs(n).toFixed(1)}%
    </span>
  );
}

/* ─── KpiCard ─────────────────────────────────────────────────────────────── */
function KpiCard({ icon, label, value, sub, color = 'blue', delta }) {
  const colours = {
    blue:   'bg-emerald-50 text-emerald-600',
    green:  'bg-green-50 text-green-600',
    yellow: 'bg-yellow-50 text-yellow-600',
    purple: 'bg-purple-50 text-purple-600',
    red:    'bg-red-50 text-red-600',
  };
  return (
    <div className="card p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0 ${colours[color]}`}>{icon}</div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <div className="flex items-center flex-wrap gap-1">
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {delta !== undefined && <DeltaBadge pct_change={delta} />}
        </div>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

/* ─── StatusBar ───────────────────────────────────────────────────────────── */
function StatusBar({ approved, pending, rejected, total }) {
  if (!total) return <div className="h-2 rounded-full bg-gray-100 w-full" />;
  return (
    <div className="h-2 rounded-full bg-gray-100 flex overflow-hidden w-full">
      <div style={{ width: pct(approved, total) }} className="bg-green-400 transition-all" />
      <div style={{ width: pct(pending,  total) }} className="bg-yellow-400 transition-all" />
      <div style={{ width: pct(rejected, total) }} className="bg-red-400 transition-all" />
    </div>
  );
}

/* ─── Custom Recharts Tooltip ─────────────────────────────────────────────── */
function ChartTip({ active, payload, label, fmt: fmtFn }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: {fmtFn ? fmtFn(p.value) : p.value}
        </p>
      ))}
    </div>
  );
}

/* ─── Schedule Modal ──────────────────────────────────────────────────────── */
const EMPTY_SCHED = {
  name: '', report_type: 'hours', frequency: 'weekly',
  day_of_week: 1, day_of_month: 1,
  recipients: '', format: 'csv',
  period: 'last_period', is_active: true,
};

function ScheduleModal({ onClose }) {
  const [form, setForm]     = useState(EMPTY_SCHED);
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim())       { setErr('Name is required'); return; }
    if (!form.recipients.trim()) { setErr('At least one recipient email required'); return; }
    setSaving(true); setErr('');
    try {
      const payload = {
        ...form,
        recipients:    form.recipients.split(',').map(e => e.trim()).filter(Boolean),
        day_of_week:   form.frequency === 'weekly'  ? Number(form.day_of_week)  : null,
        day_of_month:  form.frequency === 'monthly' ? Number(form.day_of_month) : null,
      };
      await api.post('/api/scheduled-reports', payload);
      onClose();
    } catch (e) {
      setErr(e.response?.data?.error || 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">📅 Schedule Report Delivery</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {err && <div className="bg-red-50 text-red-600 text-sm px-3 py-2 rounded-lg">{err}</div>}

          <div>
            <label className="label">Schedule Name</label>
            <input className="input" placeholder="e.g. Weekly Hours Summary"
              value={form.name} onChange={e => set('name', e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Report Type</label>
              <select className="input" value={form.report_type} onChange={e => set('report_type', e.target.value)}>
                <option value="hours">⏱️ Hours</option>
                <option value="absences">🏖️ Absences</option>
                <option value="revenue">💰 Revenue</option>
                <option value="utilization">📊 Utilization</option>
                <option value="labor_cost">🏭 Labor Cost</option>
                <option value="payroll">💼 Payroll</option>
              </select>
            </div>
            <div>
              <label className="label">Format</label>
              <select className="input" value={form.format} onChange={e => set('format', e.target.value)}>
                <option value="csv">CSV</option>
                <option value="pdf">PDF</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Frequency</label>
              <select className="input" value={form.frequency} onChange={e => set('frequency', e.target.value)}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            {form.frequency === 'weekly' && (
              <div>
                <label className="label">Day of Week</label>
                <select className="input" value={form.day_of_week} onChange={e => set('day_of_week', e.target.value)}>
                  {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d, i) => (
                    <option key={i} value={i}>{d}</option>
                  ))}
                </select>
              </div>
            )}
            {form.frequency === 'monthly' && (
              <div>
                <label className="label">Day of Month</label>
                <select className="input" value={form.day_of_month} onChange={e => set('day_of_month', e.target.value)}>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="label">Data Period</label>
            <select className="input" value={form.period} onChange={e => set('period', e.target.value)}>
              <option value="last_period">Last Period (auto)</option>
              <option value="last_week">Last Week</option>
              <option value="last_month">Last Month</option>
              <option value="last_quarter">Last Quarter</option>
              <option value="last_year">Last Year</option>
            </select>
          </div>

          <div>
            <label className="label">Recipients (comma-separated emails)</label>
            <input className="input" placeholder="admin@company.com, hr@company.com"
              value={form.recipients} onChange={e => set('recipients', e.target.value)} />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_active}
              onChange={e => set('is_active', e.target.checked)} className="rounded" />
            <span className="text-sm text-gray-700">Active — enable delivery immediately</span>
          </label>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : '📅 Schedule Report'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── TABS ────────────────────────────────────────────────────────────────── */
const TABS = ['Hours', 'Absences', 'Revenue', 'Utilization', 'Labor Cost'];

/* ─── Main Component ──────────────────────────────────────────────────────── */
export default function Reports() {
  const today        = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 7) + '-01';

  const [filters, setFilters] = useState({
    start_date:   firstOfMonth,
    end_date:     today,
    candidate_id: '',
    client_id:    '',
  });
  const [tab,          setTab]          = useState('Hours');
  const [compareMode,  setCompareMode]  = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [employees,    setEmployees]    = useState([]);
  const [clients,      setClients]      = useState([]);

  const [hoursData,  setHoursData]  = useState(null);
  const [absData,    setAbsData]    = useState(null);
  const [revData,    setRevData]    = useState(null);
  const [utilData,   setUtilData]   = useState(null);
  const [laborData,  setLaborData]  = useState(null);
  const [cmpData,    setCmpData]    = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');

  useEffect(() => {
    api.get('/api/employees').then(r => setEmployees(Array.isArray(r.data) ? r.data : []));
    api.get('/api/clients').then(r => setClients(Array.isArray(r.data) ? r.data : []));
  }, []);

  const setClientFilter = (client_id) => setFilters(f => ({ ...f, client_id, candidate_id: '' }));

  const filteredCandidates = filters.client_id
    ? employees.filter(c => String(c.client_id) === String(filters.client_id))
    : employees;

  const fetchAll = useCallback(() => {
    const p = {};
    if (filters.start_date)   p.start_date   = filters.start_date;
    if (filters.end_date)     p.end_date     = filters.end_date;
    if (filters.candidate_id) p.candidate_id = filters.candidate_id;
    if (filters.client_id)    p.client_id    = filters.client_id;

    setLoading(true); setError('');

    const reqs = [
      api.get('/api/reports/hours',       { params: p }),
      api.get('/api/reports/absences',    { params: p }),
      api.get('/api/reports/revenue',     { params: p }),
      api.get('/api/reports/utilization', { params: p }),
      api.get('/api/reports/labor-cost',  { params: p }),
    ];
    if (compareMode) reqs.push(api.get('/api/reports/comparison', { params: p }));

    Promise.all(reqs)
      .then(([h, a, r, u, l, cmp]) => {
        setHoursData(h.data);
        setAbsData(a.data);
        setRevData(r.data);
        setUtilData(u.data);
        setLaborData(l.data);
        setCmpData(cmp?.data || null);
      })
      .catch(() => setError('Failed to load report data. Is the server running?'))
      .finally(() => setLoading(false));
  }, [filters, compareMode]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /* ── CSV Export ── */
  const downloadCSV = (rows, filename) => {
    const csv  = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a'); a.href = url; a.download = filename; a.click();
  };

  const exportCSV = () => {
    if (tab === 'Hours' && hoursData?.summary?.length) {
      downloadCSV([
        ['Employee','Client','Rate','Total Hrs','Approved Hrs','Pending Hrs','Approved Amount','Total Amount'],
        ...hoursData.summary.map(r => [r.candidate_name, r.client_name || '', `$${r.hourly_rate}/hr`, r.total_hours, r.approved_hours, r.pending_hours, r.approved_amount, r.total_amount]),
      ], `hours_report_${filters.start_date}_${filters.end_date}.csv`);
    } else if (tab === 'Absences' && absData?.summary?.length) {
      downloadCSV([
        ['Employee','Client','Requests','Total Days','Vacation','Sick','Personal','Approved','Pending'],
        ...absData.summary.map(r => [r.candidate_name, r.client_name || '', r.absence_count, r.total_days, r.vacation_days, r.sick_days, r.personal_days, r.approved_days, r.pending_days]),
      ], `absences_report_${filters.start_date}_${filters.end_date}.csv`);
    } else if (tab === 'Revenue' && revData?.invoices?.length) {
      downloadCSV([
        ['Employee','Invoice #','Issue Date','Due Date','Hours Billed','Amount','Status'],
        ...revData.invoices.map(r => [r.candidate_name, r.invoice_number, r.issue_date, r.due_date, r.hours_billed, r.total_amount, r.status]),
      ], `revenue_report_${filters.start_date}_${filters.end_date}.csv`);
    } else if (tab === 'Labor Cost' && laborData?.byProject?.length) {
      downloadCSV([
        ['Project','Client','Hours','Labor Cost','Invoiced Revenue','Gross Profit','Margin %'],
        ...laborData.byProject.map(r => [r.project_name, r.client_name || '', r.total_hours, r.labor_cost, r.invoiced_revenue, r.gross_profit, `${r.margin_pct}%`]),
      ], `labor_cost_report_${filters.start_date}_${filters.end_date}.csv`);
    }
  };

  const deltas = cmpData?.deltas;

  /* ── QUICK RANGES ── */
  const RANGES = [
    { label: 'This month', start: today.slice(0,7)+'-01', end: today },
    { label: 'Last month',
      start: (() => { const d = new Date(today); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,7)+'-01'; })(),
      end:   (() => { const d = new Date(today); d.setDate(0); return d.toISOString().slice(0,10); })(),
    },
    { label: 'This year',  start: today.slice(0,4)+'-01-01', end: today },
    { label: 'All time',   start: '2020-01-01',              end: today },
  ];

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-500 mt-1">Analyse hours, absences and revenue across your workforce</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setCompareMode(m => !m)}
            className={`text-sm px-4 py-2 rounded-lg border transition-colors ${
              compareMode
                ? 'bg-indigo-50 border-indigo-300 text-indigo-700 font-medium'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            📊 {compareMode ? 'Comparing Periods' : 'Compare Periods'}
          </button>
          <button onClick={() => setShowSchedule(true)} className="btn-secondary flex items-center gap-2 text-sm">
            📅 Schedule
          </button>
          <button onClick={exportCSV} className="btn-secondary flex items-center gap-2 text-sm">
            ⬇️ Export CSV
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="card p-4 mb-6 flex flex-wrap gap-3 items-end">
        <div>
          <label className="label text-xs">Start Date</label>
          <input type="date" className="input max-w-[160px]" value={filters.start_date}
            onChange={e => setFilters(f => ({ ...f, start_date: e.target.value }))} />
        </div>
        <div>
          <label className="label text-xs">End Date</label>
          <input type="date" className="input max-w-[160px]" value={filters.end_date}
            onChange={e => setFilters(f => ({ ...f, end_date: e.target.value }))} />
        </div>
        <div>
          <label className="label text-xs">Client</label>
          <select className="input max-w-[180px]" value={filters.client_id}
            onChange={e => setClientFilter(e.target.value)}>
            <option value="">All Clients</option>
            {clients.map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label text-xs">Employee</label>
          <select className="input max-w-[200px]" value={filters.candidate_id}
            onChange={e => setFilters(f => ({ ...f, candidate_id: e.target.value }))}>
            <option value="">All Employees{filters.client_id ? ' (filtered)' : ''}</option>
            {filteredCandidates.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex gap-2 items-end pb-px">
          {RANGES.map(r => (
            <button key={r.label}
              onClick={() => setFilters(f => ({ ...f, start_date: r.start, end_date: r.end }))}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 transition-colors whitespace-nowrap">
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Compare banner ── */}
      {compareMode && cmpData && (
        <div className="card p-3 mb-4 bg-indigo-50 border border-indigo-200 text-sm text-indigo-700 flex items-center gap-2">
          <span>📊</span>
          <span>
            Comparing <strong>{filters.start_date} → {filters.end_date}</strong> vs the prior equivalent period.
            Coloured badges show % change vs prior period.
          </span>
        </div>
      )}

      {error && (
        <div className="card p-6 text-center text-red-500 mb-6">
          <div className="text-3xl mb-2">⚠️</div>
          <p>{error}</p>
          <button onClick={fetchAll} className="mt-3 btn-primary text-sm">Retry</button>
        </div>
      )}

      {/* ── Global KPI row ── */}
      {!loading && !error && hoursData && absData && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <KpiCard icon="⏱️" label="Total Hours"
            value={`${fmt(hoursData.totals?.total_hours)}h`}
            sub={`${fmt(hoursData.totals?.approved_hours)}h approved`}
            color="blue"
            delta={compareMode ? deltas?.total_hours?.pct_change : undefined} />
          <KpiCard icon="✅" label="Approved Revenue"
            value={money(hoursData.totals?.approved_amount)}
            sub={`${fmt(hoursData.totals?.approved_hours)}h billed`}
            color="green"
            delta={compareMode ? deltas?.approved_revenue?.pct_change : undefined} />
          <KpiCard icon="⏳" label="Pending Hours"
            value={`${fmt(hoursData.totals?.pending_hours)}h`}
            sub="awaiting approval"
            color="yellow" />
          <KpiCard icon="🏖️" label="Absence Days"
            value={absData.totals?.total_days ?? 0}
            sub={`${absData.totals?.approved_days ?? 0} approved`}
            color="purple"
            delta={compareMode ? deltas?.absence_days?.pct_change : undefined} />
          <KpiCard icon="💰" label="Total Billable"
            value={money(hoursData.totals?.total_amount)}
            sub="all statuses"
            color="blue" />
        </div>
      )}

      {/* ── Tab bar ── */}
      <div className="flex gap-1 mb-4 border-b border-gray-100 overflow-x-auto">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap ${
              tab === t
                ? 'bg-white border border-b-white border-gray-100 text-emerald-600 -mb-px'
                : 'text-gray-500 hover:text-gray-700'
            }`}>
            {t === 'Hours'       && '⏱️ '}
            {t === 'Absences'    && '🏖️ '}
            {t === 'Revenue'     && '💰 '}
            {t === 'Utilization' && '📊 '}
            {t === 'Labor Cost'  && '🏭 '}
            {t}
          </button>
        ))}
      </div>

      {loading && (
        <div className="card flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
        </div>
      )}

      {/* ════════════════════════════════════════
          TAB: HOURS
      ════════════════════════════════════════ */}
      {!loading && tab === 'Hours' && hoursData && (
        <div className="space-y-4">
          {/* Daily hours bar chart */}
          {hoursData.daily?.length > 0 && (
            <div className="card p-4">
              <h3 className="font-semibold text-gray-700 text-sm mb-3">📈 Daily Hours</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={hoursData.daily} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={v => v.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip content={<ChartTip fmt={v => `${v}h`} />} />
                  <Bar dataKey="hours" name="Hours" fill="#10b981" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {hoursData.summary.length === 0 ? (
            <div className="card text-center py-16 text-gray-400">
              <div className="text-4xl mb-2">⏱️</div>
              <p>No time entries in this period</p>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Employee</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Client</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Rate</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Total Hrs</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Approved</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Pending</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Rejected</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium w-28">Breakdown</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Approved $</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Total $</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {hoursData.summary.map(r => (
                    <tr key={r.candidate_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{r.candidate_name}</p>
                        <p className="text-xs text-gray-400">{r.role}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{r.client_name || '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-600 text-xs">${r.hourly_rate}/hr</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900">{fmt(r.total_hours)}h</td>
                      <td className="px-4 py-3 text-right text-green-600 font-medium">{fmt(r.approved_hours)}h</td>
                      <td className="px-4 py-3 text-right text-yellow-600">{fmt(r.pending_hours)}h</td>
                      <td className="px-4 py-3 text-right text-red-500">{fmt(r.rejected_hours)}h</td>
                      <td className="px-4 py-3 w-28">
                        <StatusBar approved={r.approved_hours} pending={r.pending_hours} rejected={r.rejected_hours} total={r.total_hours} />
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-green-700">{money(r.approved_amount)}</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900">{money(r.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t border-gray-200">
                  <tr>
                    <td colSpan={3} className="px-4 py-3 font-semibold text-gray-700">Totals ({hoursData.totals?.entry_count} entries)</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900">{fmt(hoursData.totals?.total_hours)}h</td>
                    <td className="px-4 py-3 text-right font-bold text-green-600">{fmt(hoursData.totals?.approved_hours)}h</td>
                    <td className="px-4 py-3 text-right font-bold text-yellow-600">{fmt(hoursData.totals?.pending_hours)}h</td>
                    <td className="px-4 py-3 text-right font-bold text-red-500">{fmt(hoursData.totals?.rejected_hours)}h</td>
                    <td className="px-4 py-3">
                      <StatusBar approved={hoursData.totals?.approved_hours} pending={hoursData.totals?.pending_hours} rejected={hoursData.totals?.rejected_hours} total={hoursData.totals?.total_hours} />
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-green-700">{money(hoursData.totals?.approved_amount)}</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900">{money(hoursData.totals?.total_amount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════
          TAB: ABSENCES
      ════════════════════════════════════════ */}
      {!loading && tab === 'Absences' && absData && (
        <div className="space-y-4">
          {/* Monthly absence trend chart */}
          {absData.monthly?.length > 0 && (
            <div className="card p-4">
              <h3 className="font-semibold text-gray-700 text-sm mb-3">📈 Monthly Absence Trends</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={absData.monthly} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip content={<ChartTip fmt={v => `${v}d`} />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="total_days"    name="Total Days" stroke="#6366f1" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="vacation_days" name="Vacation"   stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="sick_days"     name="Sick"       stroke="#ef4444" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {absData.summary.length === 0 ? (
            <div className="card text-center py-16 text-gray-400">
              <div className="text-4xl mb-2">🏖️</div>
              <p>No absences in this period</p>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Employee</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Client</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Requests</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Total Days</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">🌴 Vacation</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">🤒 Sick</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">👤 Personal</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">✅ Approved</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">⏳ Pending</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {absData.summary.map(r => (
                    <tr key={r.candidate_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{r.candidate_name}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{r.client_name || '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{r.absence_count}</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900">{r.total_days}d</td>
                      <td className="px-4 py-3 text-right text-emerald-600">{r.vacation_days}d</td>
                      <td className="px-4 py-3 text-right text-orange-500">{r.sick_days}d</td>
                      <td className="px-4 py-3 text-right text-purple-500">{r.personal_days}d</td>
                      <td className="px-4 py-3 text-right font-medium text-green-600">{r.approved_days}d</td>
                      <td className="px-4 py-3 text-right text-yellow-600">{r.pending_days}d</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t border-gray-200">
                  <tr>
                    <td colSpan={2} className="px-4 py-3 font-semibold text-gray-700">Totals</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900">{absData.totals?.absence_count}</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900">{absData.totals?.total_days}d</td>
                    <td /><td /><td />
                    <td className="px-4 py-3 text-right font-bold text-green-600">{absData.totals?.approved_days}d</td>
                    <td className="px-4 py-3 text-right font-bold text-yellow-600">{absData.totals?.pending_days}d</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {absData.detail?.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900 text-sm">Absence Detail</h3>
              </div>
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2 text-gray-500 font-medium">Employee</th>
                      <th className="text-left px-4 py-2 text-gray-500 font-medium">Type</th>
                      <th className="text-left px-4 py-2 text-gray-500 font-medium">Start</th>
                      <th className="text-left px-4 py-2 text-gray-500 font-medium">End</th>
                      <th className="text-right px-4 py-2 text-gray-500 font-medium">Days</th>
                      <th className="text-left px-4 py-2 text-gray-500 font-medium">Status</th>
                      <th className="text-left px-4 py-2 text-gray-500 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {absData.detail.map(d => (
                      <tr key={d.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium text-gray-900">{d.candidate_name}</td>
                        <td className="px-4 py-2 text-gray-600 capitalize">{d.type.replace('_', ' ')}</td>
                        <td className="px-4 py-2 text-gray-700">{d.start_date}</td>
                        <td className="px-4 py-2 text-gray-700">{d.end_date}</td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900">{d.days}d</td>
                        <td className="px-4 py-2"><span className={`badge-${d.status}`}>{d.status}</span></td>
                        <td className="px-4 py-2 text-gray-400 text-xs max-w-[180px] truncate">{d.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════
          TAB: REVENUE
      ════════════════════════════════════════ */}
      {!loading && tab === 'Revenue' && revData && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon="💳" label="Paid"          value={money(revData.invTotals?.paid)}       color="green" />
            <KpiCard icon="📤" label="Outstanding"   value={money(revData.invTotals?.outstanding)} color="yellow" />
            <KpiCard icon="📝" label="Draft"          value={money(revData.invTotals?.draft)}       color="purple" />
            <KpiCard icon="📊" label="Total Invoiced" value={money(revData.invTotals?.total)}
              sub={`${revData.invTotals?.invoice_count || 0} invoices`} color="blue"
              delta={compareMode ? deltas?.approved_revenue?.pct_change : undefined} />
          </div>

          {/* Revenue by client bar chart */}
          {revData.byClient?.length > 0 && (
            <div className="card p-4">
              <h3 className="font-semibold text-gray-700 text-sm mb-3">💰 Revenue by Client</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={revData.byClient} margin={{ top: 4, right: 8, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="client_name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip content={<ChartTip fmt={money} />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="total_invoiced" name="Invoiced" fill="#6366f1" radius={[3,3,0,0]} />
                  <Bar dataKey="total_billable" name="Billable" fill="#10b981" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Monthly revenue line chart */}
          {revData.monthly?.length > 0 && (
            <div className="card p-4">
              <h3 className="font-semibold text-gray-700 text-sm mb-3">📅 Monthly Revenue Trend</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={revData.monthly} margin={{ top: 4, right: 8, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip content={<ChartTip fmt={money} />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="total_invoiced" name="Invoiced" stroke="#6366f1" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="total_billable" name="Billable" stroke="#10b981" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {revData.billable?.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900 text-sm">Billable Hours Summary</h3>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Employee</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Client</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Rate</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Approved Hrs</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Approved $</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Pending $</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Total Billable</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {revData.billable.map(r => (
                    <tr key={r.candidate_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{r.candidate_name}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{r.client_name || '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-600 text-xs">${r.hourly_rate}/hr</td>
                      <td className="px-4 py-3 text-right font-medium text-green-600">{fmt(r.approved_hours)}h</td>
                      <td className="px-4 py-3 text-right font-medium text-green-700">{money(r.approved_amount)}</td>
                      <td className="px-4 py-3 text-right text-yellow-600">{money(r.pending_amount)}</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900">{money(r.total_billable)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {revData.invoices?.length > 0 ? (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900 text-sm">Invoices</h3>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Employee</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Invoice #</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Issue Date</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Due Date</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Hours</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Amount</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {revData.invoices.map((inv, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{inv.candidate_name}</td>
                      <td className="px-4 py-3 text-gray-700 font-mono text-xs">{inv.invoice_number}</td>
                      <td className="px-4 py-3 text-gray-600">{inv.issue_date}</td>
                      <td className="px-4 py-3 text-gray-600">{inv.due_date || '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{inv.hours_billed}h</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900">{money(inv.total_amount)}</td>
                      <td className="px-4 py-3"><span className={`badge-${inv.status}`}>{inv.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card text-center py-12 text-gray-400">
              <div className="text-4xl mb-2">📄</div>
              <p>No invoices in this period</p>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════
          TAB: UTILIZATION
      ════════════════════════════════════════ */}
      {!loading && tab === 'Utilization' && utilData && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon="📊" label="Avg Utilization"    value={`${utilData.totals?.avg_utilization_pct ?? 0}%`} sub="billable / total hrs"       color="blue"   />
            <KpiCard icon="⏱️" label="Total Billable Hrs" value={`${fmt(utilData.totals?.total_billable_hrs)}h`}  sub="approved, billable"         color="green"  />
            <KpiCard icon="💸" label="Unbilled Approved"  value={`${fmt(utilData.totals?.unbilled_hrs)}h`}        sub="approved, not yet invoiced" color="yellow" />
            <KpiCard icon="🏆" label="Realization Rate"   value={`${utilData.totals?.realization_pct ?? 0}%`}     sub="invoiced ÷ billable value"  color="purple" />
          </div>

          {/* Horizontal bar chart for team utilization */}
          {utilData.people?.length > 0 && (
            <div className="card p-4">
              <h3 className="font-semibold text-gray-700 text-sm mb-3">👥 Team Utilization %</h3>
              <ResponsiveContainer width="100%" height={Math.max(180, utilData.people.length * 36)}>
                <BarChart data={utilData.people} layout="vertical" margin={{ top: 4, right: 8, left: 80, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={80} />
                  <Tooltip content={<ChartTip fmt={v => `${v}%`} />} />
                  <Bar dataKey="utilization_pct" name="Utilization" radius={[0,3,3,0]}>
                    {utilData.people.map((p, i) => (
                      <Cell key={i} fill={
                        Number(p.utilization_pct) >= (p.target_utilization || 80)
                          ? '#10b981'
                          : Number(p.utilization_pct) >= 60 ? '#f59e0b' : '#ef4444'
                      } />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {utilData.projects?.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-700 text-sm">📁 Project Profitability</div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Project</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium hidden md:table-cell">Client</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium hidden lg:table-cell">Billing</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Approx Hrs</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Billable Hrs</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium hidden md:table-cell">Util %</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Invoiced</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Budget</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {utilData.projects.map((p, i) => {
                    const budgetPct  = p.budget_hours ? Math.min(100, Math.round((p.approved_hours / p.budget_hours) * 100)) : null;
                    const overBudget = budgetPct !== null && budgetPct >= 90;
                    return (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{p.project_name}</td>
                        <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{p.client_name}</td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">{p.billing_model}</span>
                        </td>
                        <td className="px-4 py-3 text-right">{fmt(p.approved_hours)}h</td>
                        <td className="px-4 py-3 text-right text-green-700 font-medium">{fmt(p.billable_hours)}h</td>
                        <td className="px-4 py-3 text-right hidden md:table-cell">
                          <span className={`font-semibold ${p.utilization_pct >= 80 ? 'text-green-600' : p.utilization_pct >= 60 ? 'text-yellow-600' : 'text-red-500'}`}>{p.utilization_pct}%</span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold">{money(p.invoiced_total)}</td>
                        <td className="px-4 py-3">
                          {budgetPct !== null ? (
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${overBudget ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${budgetPct}%` }} />
                              </div>
                              <span className={`text-xs ${overBudget ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>{budgetPct}%</span>
                            </div>
                          ) : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {utilData.people?.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-700 text-sm">👥 Team Utilization Detail</div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Name</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium hidden md:table-cell">Role</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Total Hrs</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Billable Hrs</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Utilization</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium hidden lg:table-cell">Target</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">vs Target</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {utilData.people.map((p, i) => {
                    const utilPct  = Number(p.utilization_pct) || 0;
                    const target   = Number(p.target_utilization) || 80;
                    const diff     = utilPct - target;
                    const barColor = utilPct >= target ? 'bg-green-500' : utilPct >= target * 0.75 ? 'bg-yellow-400' : 'bg-red-400';
                    return (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{p.name}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs hidden md:table-cell">{p.role || '—'}</td>
                        <td className="px-4 py-3 text-right">{fmt(p.total_hours)}h</td>
                        <td className="px-4 py-3 text-right text-green-700">{fmt(p.billable_hours)}h</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, utilPct)}%` }} />
                            </div>
                            <span className="font-semibold w-10 text-right">{utilPct}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-400 hidden lg:table-cell">{target}%</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-semibold ${diff >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {diff >= 0 ? `+${diff.toFixed(0)}` : diff.toFixed(0)}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {(!utilData.projects?.length && !utilData.people?.length) && (
            <div className="card text-center py-12 text-gray-400">
              <div className="text-4xl mb-2">📊</div>
              <p>No project time data in this period</p>
              <p className="text-sm mt-1">Log time against projects to see utilization metrics</p>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════
          TAB: LABOR COST
      ════════════════════════════════════════ */}
      {!loading && tab === 'Labor Cost' && laborData && (
        <div className="space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon="🏭" label="Total Labor Cost"   value={money(laborData.totals?.total_labor_cost)}    sub="hours × rate"          color="red"    />
            <KpiCard icon="💰" label="Total Revenue"      value={money(laborData.totals?.total_revenue)}       sub="invoiced in period"    color="green"  />
            <KpiCard icon="📉" label="Absence Cost"       value={money(laborData.totals?.total_absence_cost)}  sub="days × rate × 8h"     color="yellow" />
            <KpiCard icon="📊" label="Gross Margin"
              value={`${Number(laborData.totals?.margin_pct || 0).toFixed(1)}%`}
              sub={`${money(laborData.totals?.gross_margin)} profit`}
              color="purple" />
          </div>

          {/* Cost vs revenue by project chart */}
          {laborData.byProject?.length > 0 && (
            <div className="card p-4">
              <h3 className="font-semibold text-gray-700 text-sm mb-3">📁 Labor Cost vs Revenue by Project</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={laborData.byProject.slice(0, 12)} margin={{ top: 4, right: 8, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="project_name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip content={<ChartTip fmt={money} />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="labor_cost"       name="Labor Cost"       fill="#ef4444" radius={[3,3,0,0]} />
                  <Bar dataKey="invoiced_revenue" name="Invoiced Revenue" fill="#10b981" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Per-project table */}
          {laborData.byProject?.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-700 text-sm">📁 Cost per Project</div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Project</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Client</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Hours</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Labor Cost</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Invoiced</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Gross Profit</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {laborData.byProject.map((r, i) => {
                    const margin = Number(r.margin_pct || 0);
                    return (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{r.project_name}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{r.client_name || '—'}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{fmt(r.total_hours)}h</td>
                        <td className="px-4 py-3 text-right text-red-600 font-medium">{money(r.labor_cost)}</td>
                        <td className="px-4 py-3 text-right text-green-700 font-medium">{money(r.invoiced_revenue)}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`font-semibold ${Number(r.gross_profit) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                            {money(r.gross_profit)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${margin >= 20 ? 'bg-green-100 text-green-700' : margin >= 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-600'}`}>
                            {margin.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Per-client table */}
          {laborData.byClient?.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-700 text-sm">🏢 Cost per Client</div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Client</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Hours</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Labor Cost</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Invoiced</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Gross Profit</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {laborData.byClient.map((r, i) => {
                    const margin = Number(r.margin_pct || 0);
                    return (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{r.client_name || 'Unassigned'}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{fmt(r.total_hours)}h</td>
                        <td className="px-4 py-3 text-right text-red-600 font-medium">{money(r.labor_cost)}</td>
                        <td className="px-4 py-3 text-right text-green-700 font-medium">{money(r.invoiced_revenue)}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`font-semibold ${Number(r.gross_profit) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                            {money(r.gross_profit)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${margin >= 20 ? 'bg-green-100 text-green-700' : margin >= 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-600'}`}>
                            {margin.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Absence cost per employee */}
          {laborData.byEmployee?.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-700 text-sm">🏖️ Absence Cost per Employee</div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Employee</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Absence Days</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Hourly Rate</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Absence Cost</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Labor Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {laborData.byEmployee.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{r.candidate_name}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{r.absence_days}d</td>
                      <td className="px-4 py-3 text-right text-gray-500">${r.hourly_rate}/hr</td>
                      <td className="px-4 py-3 text-right text-yellow-600 font-medium">{money(r.absence_cost)}</td>
                      <td className="px-4 py-3 text-right text-red-600 font-medium">{money(r.labor_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!laborData.byProject?.length && !laborData.byClient?.length && (
            <div className="card text-center py-12 text-gray-400">
              <div className="text-4xl mb-2">🏭</div>
              <p>No labor cost data in this period</p>
              <p className="text-sm mt-1">Approve time entries to see cost and profitability analysis</p>
            </div>
          )}
        </div>
      )}

      {/* ── Schedule Modal ── */}
      {showSchedule && <ScheduleModal onClose={() => setShowSchedule(false)} />}
    </div>
  );
}
