import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';

/* ─── tiny helpers ─────────────────────────────────── */
const fmt   = (n, dec = 1) => (n ?? 0).toFixed(dec);
const money = (n) => `$${(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct   = (part, total) => total ? `${((part / total) * 100).toFixed(0)}%` : '0%';

function KpiCard({ icon, label, value, sub, color = 'blue' }) {
  const colours = {
    blue:   'bg-emerald-50   text-emerald-600',
    green:  'bg-green-50  text-green-600',
    yellow: 'bg-yellow-50 text-yellow-600',
    purple: 'bg-purple-50 text-purple-600',
    red:    'bg-red-50    text-red-600',
  };
  return (
    <div className="card p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0 ${colours[color]}`}>{icon}</div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

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

const TABS = ['Hours', 'Absences', 'Revenue'];

export default function Reports() {
  const today     = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 7) + '-01';

  const [filters, setFilters] = useState({
    start_date:   firstOfMonth,
    end_date:     today,
    candidate_id: '',
    client_id:    '',
  });
  const [tab,        setTab]        = useState('Hours');
  const [candidates, setCandidates] = useState([]);
  const [clients,    setClients]    = useState([]);

  const [hoursData,   setHoursData]   = useState(null);
  const [absData,     setAbsData]     = useState(null);
  const [revData,     setRevData]     = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');

  // Load candidates + clients once
  useEffect(() => {
    api.get('/api/candidates').then(r => setCandidates(r.data));
    api.get('/api/clients').then(r => setClients(r.data));
  }, []);

  // When client filter changes, clear candidate filter (to avoid hidden conflicts)
  const setClientFilter = (client_id) => {
    setFilters(f => ({ ...f, client_id, candidate_id: '' }));
  };

  // Candidates visible in the employee dropdown — filtered by selected client
  const filteredCandidates = filters.client_id
    ? candidates.filter(c => String(c.client_id) === String(filters.client_id))
    : candidates;

  const fetchAll = useCallback(() => {
    const p = {};
    if (filters.start_date)   p.start_date   = filters.start_date;
    if (filters.end_date)     p.end_date     = filters.end_date;
    if (filters.candidate_id) p.candidate_id = filters.candidate_id;
    if (filters.client_id)    p.client_id    = filters.client_id;

    setLoading(true); setError('');
    Promise.all([
      api.get('/api/reports/hours',    { params: p }),
      api.get('/api/reports/absences', { params: p }),
      api.get('/api/reports/revenue',  { params: p }),
    ])
      .then(([h, a, r]) => {
        setHoursData(h.data);
        setAbsData(a.data);
        setRevData(r.data);
      })
      .catch(() => setError('Failed to load report data. Is the server running?'))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const exportCSV = () => {
    if (tab === 'Hours' && hoursData?.summary?.length) {
      const rows = [
        ['Employee', 'Client', 'Rate', 'Total Hrs', 'Approved Hrs', 'Pending Hrs', 'Approved Amount', 'Total Amount'],
        ...hoursData.summary.map(r => [
          r.candidate_name, r.client_name || '', `$${r.hourly_rate}/hr`,
          r.total_hours, r.approved_hours, r.pending_hours,
          r.approved_amount, r.total_amount,
        ]),
      ];
      downloadCSV(rows, `hours_report_${filters.start_date}_${filters.end_date}.csv`);
    } else if (tab === 'Absences' && absData?.summary?.length) {
      const rows = [
        ['Employee', 'Client', 'Total Absences', 'Total Days', 'Vacation', 'Sick', 'Personal', 'Approved', 'Pending'],
        ...absData.summary.map(r => [
          r.candidate_name, r.client_name || '',
          r.absence_count, r.total_days,
          r.vacation_days, r.sick_days, r.personal_days,
          r.approved_days, r.pending_days,
        ]),
      ];
      downloadCSV(rows, `absences_report_${filters.start_date}_${filters.end_date}.csv`);
    } else if (tab === 'Revenue' && revData?.invoices?.length) {
      const rows = [
        ['Employee', 'Invoice #', 'Issue Date', 'Due Date', 'Hours Billed', 'Amount', 'Status'],
        ...revData.invoices.map(r => [
          r.candidate_name, r.invoice_number, r.issue_date,
          r.due_date, r.hours_billed, r.total_amount, r.status,
        ]),
      ];
      downloadCSV(rows, `revenue_report_${filters.start_date}_${filters.end_date}.csv`);
    }
  };

  const downloadCSV = (rows, filename) => {
    const csv  = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a'); a.href = url; a.download = filename; a.click();
  };

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-500 mt-1">Analyse hours, absences and revenue across your workforce</p>
        </div>
        <button onClick={exportCSV} className="btn-secondary flex items-center gap-2 text-sm">
          ⬇️ Export CSV
        </button>
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
        {/* Quick ranges */}
        <div className="flex gap-2 items-end pb-px">
          {[
            { label: 'This month',  start: today.slice(0,7)+'-01', end: today },
            { label: 'Last month',  start: (() => { const d = new Date(today); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,7)+'-01'; })(),
              end: (() => { const d = new Date(today); d.setDate(0); return d.toISOString().slice(0,10); })() },
            { label: 'This year',   start: today.slice(0,4)+'-01-01', end: today },
            { label: 'All time',    start: '2020-01-01',               end: today },
          ].map(r => (
            <button key={r.label}
              onClick={() => setFilters(f => ({ ...f, start_date: r.start, end_date: r.end }))}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 transition-colors">
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="card p-6 text-center text-red-500 mb-6">
          <div className="text-3xl mb-2">⚠️</div>
          <p>{error}</p>
          <button onClick={fetchAll} className="mt-3 btn-primary text-sm">Retry</button>
        </div>
      )}

      {/* ── KPI summary row ── */}
      {!loading && !error && hoursData && absData && revData && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <KpiCard icon="⏱️" label="Total Hours"     value={`${fmt(hoursData.totals?.total_hours)}h`}    sub={`${fmt(hoursData.totals?.approved_hours)}h approved`} color="blue" />
          <KpiCard icon="✅" label="Approved Revenue" value={money(hoursData.totals?.approved_amount)}   sub={`${fmt(hoursData.totals?.approved_hours)}h billed`}   color="green" />
          <KpiCard icon="⏳" label="Pending Hours"    value={`${fmt(hoursData.totals?.pending_hours)}h`} sub="awaiting approval"                                     color="yellow" />
          <KpiCard icon="🏖️" label="Absence Days"     value={absData.totals?.total_days ?? 0}           sub={`${absData.totals?.approved_days ?? 0} approved`}      color="purple" />
          <KpiCard icon="💰" label="Total Billable"   value={money(hoursData.totals?.total_amount)}      sub="all statuses"                                          color="blue" />
        </div>
      )}

      {/* ── Tab bar ── */}
      <div className="flex gap-1 mb-4 border-b border-gray-100">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
              tab === t ? 'bg-white border border-b-white border-gray-100 text-emerald-600 -mb-px' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {t === 'Hours'    && '⏱️ '}
            {t === 'Absences' && '🏖️ '}
            {t === 'Revenue'  && '💰 '}
            {t}
          </button>
        ))}
      </div>

      {loading && (
        <div className="card flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
        </div>
      )}

      {/* ══════════════════════════════════════════════
          TAB: HOURS
      ══════════════════════════════════════════════ */}
      {!loading && tab === 'Hours' && hoursData && (
        <div className="space-y-4">
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
                    <th className="text-left px-4 py-3 text-gray-500 font-medium w-32">Breakdown</th>
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
                      <td className="px-4 py-3 w-32">
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

          {/* Daily breakdown mini-table */}
          {hoursData.daily?.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900 text-sm">Daily Breakdown</h3>
                <span className="text-xs text-gray-400">{hoursData.daily.length} days with entries</span>
              </div>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2 text-gray-500 font-medium">Date</th>
                      <th className="text-right px-4 py-2 text-gray-500 font-medium">Entries</th>
                      <th className="text-right px-4 py-2 text-gray-500 font-medium">Hours</th>
                      <th className="text-right px-4 py-2 text-gray-500 font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {hoursData.daily.map(d => (
                      <tr key={d.date} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-700">{d.date}</td>
                        <td className="px-4 py-2 text-right text-gray-500">{d.entries}</td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900">{d.hours}h</td>
                        <td className="px-4 py-2 text-right text-gray-700">{money(d.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════
          TAB: ABSENCES
      ══════════════════════════════════════════════ */}
      {!loading && tab === 'Absences' && absData && (
        <div className="space-y-4">
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
                    <td colSpan={2} />
                    <td />
                    <td className="px-4 py-3 text-right font-bold text-green-600">{absData.totals?.approved_days}d</td>
                    <td className="px-4 py-3 text-right font-bold text-yellow-600">{absData.totals?.pending_days}d</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Absence detail list */}
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

      {/* ══════════════════════════════════════════════
          TAB: REVENUE
      ══════════════════════════════════════════════ */}
      {!loading && tab === 'Revenue' && revData && (
        <div className="space-y-4">
          {/* Invoice KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon="💳" label="Paid"         value={money(revData.invTotals?.paid)}        color="green" />
            <KpiCard icon="📤" label="Outstanding"  value={money(revData.invTotals?.outstanding)}  color="yellow" />
            <KpiCard icon="📝" label="Draft"         value={money(revData.invTotals?.draft)}        color="purple" />
            <KpiCard icon="📊" label="Total Invoiced" value={money(revData.invTotals?.total)}      sub={`${revData.invTotals?.invoice_count || 0} invoices`} color="blue" />
          </div>

          {/* Billable hours per candidate */}
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

          {/* Invoices detail */}
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
    </div>
  );
}
