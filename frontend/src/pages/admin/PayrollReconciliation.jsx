/**
 * Payroll Reconciliation
 *
 * Two views:
 *   📊 Payroll vs Payments  — expected pay (hours × rate) vs actual invoice payments
 *   📋 Timesheet Check      — candidate hours vs admin-approved vs client-approved
 *                             (pre-publish discrepancy detection)
 */
import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';

// ── Shared helpers ────────────────────────────────────────────────────────────
const fmtCurrency = n => `$${Number(n || 0).toFixed(2)}`;
const fmtHours    = n => `${Number(n || 0).toFixed(1)}h`;
const fmtVariance = n => {
  const v = Number(n || 0);
  if (Math.abs(v) < 0.01) return '—';
  return (v > 0 ? '+' : '') + fmtCurrency(v);
};

function KpiCard({ label, value, icon, color = 'text-gray-800', sub, highlight }) {
  return (
    <div className={`rounded-xl border p-5 ${highlight ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
          <p className={`text-2xl font-bold ${color}`}>{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        </div>
        <span className="text-xl">{icon}</span>
      </div>
    </div>
  );
}

// ── Date / filters bar ────────────────────────────────────────────────────────
function FiltersBar({ filters, setFilters, period }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5 flex flex-wrap items-end gap-3">
      <div>
        <label className="label">From</label>
        <input type="date" className="input w-40" value={filters.from}
          onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
      </div>
      <div>
        <label className="label">To</label>
        <input type="date" className="input w-40" value={filters.to}
          onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
      </div>
      {(filters.from || filters.to) && (
        <button onClick={() => setFilters({ from: '', to: '' })}
          className="text-sm text-gray-400 hover:text-red-500 self-end pb-1">✕ Clear</button>
      )}
      {period?.from && (
        <p className="text-xs text-gray-400 self-end pb-1.5 ml-auto">
          Period: {period.from} → {period.to || 'Now'}
        </p>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// VIEW A: Payroll vs Payments
// ────────────────────────────────────────────────────────────────────────────
const PAYROLL_STATUS = {
  reconciled: { label: 'Reconciled',  color: 'bg-green-100 text-green-700',  icon: '✅' },
  underpaid:  { label: 'Underpaid',   color: 'bg-red-100 text-red-700',      icon: '⚠️' },
  overpaid:   { label: 'Overpaid',    color: 'bg-amber-100 text-amber-700',  icon: '💰' },
  no_hours:   { label: 'No Hours',    color: 'bg-gray-100 text-gray-500',    icon: '—'  },
};

function PayrollPaymentView({ data, loading }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');

  const rows = (data?.rows || []).filter(r => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (search && !r.candidate_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const s = data?.summary || {};

  return (
    <>
      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <KpiCard label="Total Employees" value={s.total_candidates} icon="👥" />
          <KpiCard label="Expected Pay"     value={fmtCurrency(s.total_expected)} icon="📋" color="text-emerald-600" />
          <KpiCard label="Total Paid"       value={fmtCurrency(s.total_paid)}     icon="💳" color="text-green-600" />
          <KpiCard
            label="Net Variance"
            value={fmtVariance(s.net_variance)}
            icon={s.net_variance < -0.01 ? '⚠️' : s.net_variance > 0.01 ? '💰' : '✅'}
            color={s.net_variance < -0.01 ? 'text-red-600' : s.net_variance > 0.01 ? 'text-amber-600' : 'text-green-600'}
          />
          <KpiCard label="Reconciled" value={`${s.reconciled}/${s.total_candidates}`} icon="✅" color="text-green-600"
            sub={`${s.underpaid} underpaid · ${s.overpaid} overpaid`} />
        </div>
      )}

      <div className="flex gap-3 mb-4 flex-wrap">
        <input type="text" className="input w-52 text-sm" placeholder="Search candidate…"
          value={search} onChange={e => setSearch(e.target.value)} />
        {['all', 'underpaid', 'overpaid', 'reconciled', 'no_hours'].map(f => (
          <button key={f} onClick={() => setStatusFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm border capitalize transition-colors ${
              statusFilter === f ? 'bg-green-600 text-white border-green-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'
            }`}>
            {f === 'no_hours' ? 'No Hours' : f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"/></div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-gray-400"><p className="text-3xl mb-2">💰</p><p>No payroll data found</p></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Employee</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Rate</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Hours</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Expected</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Paid</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Variance</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(r => {
                const cfg = PAYROLL_STATUS[r.status] || PAYROLL_STATUS.no_hours;
                const varColor = r.variance < -0.01 ? 'text-red-600 font-semibold' : r.variance > 0.01 ? 'text-amber-600 font-semibold' : 'text-gray-400';
                return (
                  <tr key={r.candidate_id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{r.candidate_name}</p>
                      <p className="text-xs text-gray-400">{r.entry_count} entries</p>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">{fmtCurrency(r.hourly_rate)}/hr</td>
                    <td className="px-4 py-3 text-right text-gray-700">{fmtHours(r.total_hours)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-700">{fmtCurrency(r.expected_pay)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-green-700">{fmtCurrency(r.total_paid)}</td>
                    <td className={`px-4 py-3 text-right ${varColor}`}>{fmtVariance(r.variance)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
                        {cfg.icon} {cfg.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-gray-50 border-t border-gray-200">
              <tr>
                <td className="px-4 py-3 font-semibold text-gray-700" colSpan={3}>Totals</td>
                <td className="px-4 py-3 text-right font-bold text-emerald-700">{fmtCurrency(s.total_expected)}</td>
                <td className="px-4 py-3 text-right font-bold text-green-700">{fmtCurrency(s.total_paid)}</td>
                <td className={`px-4 py-3 text-right font-bold ${s.net_variance < -0.01 ? 'text-red-600' : s.net_variance > 0.01 ? 'text-amber-600' : 'text-gray-400'}`}>
                  {fmtVariance(s.net_variance)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// VIEW B: Timesheet Discrepancy (pre-publish check)
// ────────────────────────────────────────────────────────────────────────────
const PUBLISH_STATUS = {
  ready:          { label: 'Ready to Invoice', color: 'bg-green-100 text-green-700',  icon: '🟢', badgeColor: 'border-green-200 text-green-600' },
  pending_client: { label: 'Pending Client',   color: 'bg-amber-100 text-amber-700', icon: '⏳', badgeColor: 'border-amber-200 text-amber-600' },
  has_rejections: { label: 'Has Rejections',   color: 'bg-red-100 text-red-700',     icon: '🔴', badgeColor: 'border-red-200 text-red-600' },
  no_hours:       { label: 'No Hours',         color: 'bg-gray-100 text-gray-500',   icon: '—',  badgeColor: 'border-gray-200 text-gray-400' },
  discrepancy:    { label: 'Discrepancy',      color: 'bg-orange-100 text-orange-700',icon: '⚠️', badgeColor: 'border-orange-200 text-orange-600' },
};

// Drilldown modal for a candidate
function CandidateDetailModal({ candidateId, candidateName, period, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (period?.from) params.set('from', period.from);
    if (period?.to)   params.set('to', period.to);
    api.get(`/api/payroll/timesheet-detail/${candidateId}?${params}`)
      .then(r => setDetail(r.data))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [candidateId, period]);

  const adminStatusColor = s =>
    s === 'approved' ? 'bg-green-100 text-green-700' :
    s === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700';

  const clientStatusColor = s =>
    s === 'approved' ? 'bg-green-100 text-green-700' :
    s === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <h3 className="font-semibold text-gray-900">Timesheet Detail — {candidateName}</h3>
            <p className="text-xs text-gray-400 mt-0.5">All entries with admin & client approval status</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="overflow-y-auto flex-1 p-6">
          {loading ? (
            <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"/></div>
          ) : !detail ? (
            <p className="text-center text-gray-400">Could not load details</p>
          ) : (
            <>
              {/* Legend */}
              <div className="flex gap-4 text-xs mb-4 flex-wrap">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block"/>Client Approved</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block"/>Pending Client</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block"/>Client Rejected</span>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-3 py-2.5 font-medium text-gray-600">Date</th>
                      <th className="text-right px-3 py-2.5 font-medium text-gray-600">Hours</th>
                      <th className="text-right px-3 py-2.5 font-medium text-gray-600">Amount</th>
                      <th className="text-left px-3 py-2.5 font-medium text-gray-600">Description</th>
                      <th className="text-center px-3 py-2.5 font-medium text-gray-600">Admin</th>
                      <th className="text-center px-3 py-2.5 font-medium text-gray-600">Client</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {detail.entries.map(e => (
                      <tr key={e.id} className={`hover:bg-gray-50 ${
                        e.client_approval_status === 'rejected' ? 'bg-red-50/40' :
                        !e.client_approval_status || e.client_approval_status === 'pending' ? 'bg-amber-50/30' : ''
                      }`}>
                        <td className="px-3 py-2.5 font-medium text-gray-800">{e.date}</td>
                        <td className="px-3 py-2.5 text-right text-emerald-700 font-medium">{fmtHours(e.hours)}</td>
                        <td className="px-3 py-2.5 text-right text-green-700 font-medium">{fmtCurrency(e.amount)}</td>
                        <td className="px-3 py-2.5 text-gray-500 text-xs max-w-[200px] truncate">{e.description || e.project || '—'}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${adminStatusColor(e.admin_status)}`}>
                            {e.admin_status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <div>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${clientStatusColor(e.client_approval_status)}`}>
                              {e.client_approval_status || 'pending'}
                            </span>
                            {e.client_approval_note && (
                              <p className="text-xs text-red-500 mt-0.5 italic">{e.client_approval_note}</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t border-gray-200">
                    <tr>
                      <td className="px-3 py-2.5 font-semibold text-gray-700">{detail.entries.length} entries</td>
                      <td className="px-3 py-2.5 text-right font-bold text-emerald-700">
                        {fmtHours(detail.entries.reduce((s, e) => s + Number(e.hours), 0))}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-green-700">
                        {fmtCurrency(detail.entries.reduce((s, e) => s + Number(e.amount), 0))}
                      </td>
                      <td colSpan={3}/>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TimesheetDiscrepancyView({ data, loading }) {
  const [publishFilter, setPublishFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [drilldown, setDrilldown] = useState(null);

  const rows = (data?.rows || []).filter(r => {
    if (publishFilter !== 'all' && r.publish_status !== publishFilter) return false;
    if (search && !r.candidate_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const s = data?.summary || {};

  return (
    <>
      {/* Pre-publish alert banner */}
      {s.total_pending_client > 0 && (
        <div className="mb-5 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
          <span className="text-xl mt-0.5">⚠️</span>
          <div>
            <p className="font-semibold text-amber-800">Timesheets Pending Client Approval</p>
            <p className="text-sm text-amber-600 mt-0.5">
              {fmtHours(s.total_pending_client)} across {s.pending_client} candidate(s) are still awaiting client review.
              Generating invoices now may include disputed hours.
            </p>
          </div>
        </div>
      )}
      {s.total_rejected_client > 0 && (
        <div className="mb-5 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
          <span className="text-xl mt-0.5">🔴</span>
          <div>
            <p className="font-semibold text-red-800">Client-Rejected Hours Detected</p>
            <p className="text-sm text-red-600 mt-0.5">
              {fmtHours(s.total_rejected_client)} ({fmtCurrency(s.total_rejected_client * (s.total_invoiceable / Math.max(s.total_client_approved, 1)))})
              have been rejected by clients and should NOT be invoiced. Review and resolve before publishing.
            </p>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard label="Admin Approved" value={fmtHours(s.total_admin_approved)} icon="✅" color="text-emerald-600"
            sub={`${fmtCurrency(s.total_admin_approved * (s.total_invoiceable / Math.max(s.total_client_approved || s.total_admin_approved, 1)))} expected`} />
          <KpiCard label="Client Approved" value={fmtHours(s.total_client_approved)} icon="🟢" color="text-green-600"
            sub={`${fmtCurrency(s.total_invoiceable)} invoiceable`} highlight />
          <KpiCard label="Pending Client" value={fmtHours(s.total_pending_client)} icon="⏳"
            color={s.total_pending_client > 0 ? 'text-amber-600' : 'text-gray-400'}
            sub={`${s.pending_client} candidate(s)`} />
          <KpiCard label="Discrepancy" value={fmtHours(s.total_discrepancy_hours)} icon="⚠️"
            color={s.total_discrepancy_hours > 0.01 ? 'text-red-600' : 'text-green-600'}
            sub={s.total_discrepancy_hours < 0.01 ? 'All clear!' : 'Resolve before invoicing'} />
        </div>
      )}

      {/* Publish-readiness summary strip */}
      {data && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
          <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-3">Publish Readiness</p>
          <div className="flex gap-4 flex-wrap text-sm">
            {[
              { key: 'ready',          label: '🟢 Ready to Invoice', count: s.ready },
              { key: 'pending_client', label: '⏳ Pending Client',   count: s.pending_client },
              { key: 'has_rejections', label: '🔴 Has Rejections',   count: s.has_rejections },
              { key: 'no_hours',       label: '—  No Hours',        count: s.no_hours },
            ].map(({ key, label, count }) => (
              <div key={key} className="flex items-center gap-2">
                <span className="font-bold text-lg text-gray-800">{count}</span>
                <span className="text-gray-500 text-xs">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <input type="text" className="input w-52 text-sm" placeholder="Search candidate…"
          value={search} onChange={e => setSearch(e.target.value)} />
        {['all', 'ready', 'pending_client', 'has_rejections', 'no_hours'].map(f => {
          const cfg = PUBLISH_STATUS[f];
          return (
            <button key={f} onClick={() => setPublishFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                publishFilter === f ? 'bg-green-600 text-white border-green-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}>
              {f === 'all' ? 'All' : cfg?.label || f}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"/></div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-gray-400"><p className="text-3xl mb-2">📋</p><p>No timesheet data for this period</p></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Employee</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Submitted</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Admin ✓</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Client ✓</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600 text-amber-600">Pending</th>
                <th className="text-right px-4 py-3 font-semibold text-red-500">Rejected</th>
                <th className="text-right px-4 py-3 font-semibold text-green-600">Invoiceable</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
                <th className="px-4 py-3"/>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(r => {
                const cfg = PUBLISH_STATUS[r.publish_status] || PUBLISH_STATUS.no_hours;
                const hasProblem = r.publish_status === 'pending_client' || r.publish_status === 'has_rejections' || r.publish_status === 'discrepancy';
                return (
                  <tr key={r.candidate_id} className={`hover:bg-gray-50 transition-colors ${hasProblem ? 'bg-amber-50/20' : ''}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{r.candidate_name}</p>
                      <p className="text-xs text-gray-400">{r.submitted_entries} entries · {fmtCurrency(r.hourly_rate)}/hr</p>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">{fmtHours(r.submitted_hours)}</td>
                    <td className="px-4 py-3 text-right text-emerald-700 font-medium">{fmtHours(r.admin_approved_hours)}</td>
                    <td className="px-4 py-3 text-right text-green-700 font-medium">{fmtHours(r.client_approved_hours)}</td>
                    <td className={`px-4 py-3 text-right font-medium ${r.pending_client_hours > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
                      {r.pending_client_hours > 0 ? fmtHours(r.pending_client_hours) : '—'}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${r.client_rejected_hours > 0 ? 'text-red-600' : 'text-gray-300'}`}>
                      {r.client_rejected_hours > 0 ? fmtHours(r.client_rejected_hours) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-green-700">{fmtCurrency(r.invoiceable_amount)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
                        {cfg.icon} {cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setDrilldown({ id: r.candidate_id, name: r.candidate_name })}
                        className="text-xs text-emerald-600 hover:underline"
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-gray-50 border-t border-gray-200">
              <tr>
                <td className="px-4 py-3 font-semibold text-gray-700">Totals</td>
                <td className="px-4 py-3 text-right text-gray-600">{fmtHours(s.total_submitted_hours)}</td>
                <td className="px-4 py-3 text-right font-bold text-emerald-700">{fmtHours(s.total_admin_approved)}</td>
                <td className="px-4 py-3 text-right font-bold text-green-700">{fmtHours(s.total_client_approved)}</td>
                <td className={`px-4 py-3 text-right font-bold ${s.total_pending_client > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                  {s.total_pending_client > 0 ? fmtHours(s.total_pending_client) : '—'}
                </td>
                <td className={`px-4 py-3 text-right font-bold ${s.total_rejected_client > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                  {s.total_rejected_client > 0 ? fmtHours(s.total_rejected_client) : '—'}
                </td>
                <td className="px-4 py-3 text-right font-bold text-green-700">{fmtCurrency(s.total_invoiceable)}</td>
                <td colSpan={2}/>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {drilldown && (
        <CandidateDetailModal
          candidateId={drilldown.id}
          candidateName={drilldown.name}
          period={data?.period}
          onClose={() => setDrilldown(null)}
        />
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────────────────────
const VIEWS = [
  { id: 'timesheet', label: '📋 Timesheet Check', sub: 'Pre-publish discrepancy' },
  { id: 'payroll',   label: '💰 Payroll vs Payments', sub: 'Payment reconciliation' },
];

export default function PayrollReconciliation() {
  const [activeView, setActiveView] = useState('timesheet');
  const [data, setData]             = useState(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [filters, setFilters]       = useState({ from: '', to: '' });

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ view: activeView });
    if (filters.from) params.set('from', filters.from);
    if (filters.to)   params.set('to', filters.to);
    api.get(`/api/payroll/reconciliation?${params}`)
      .then(r => setData(r.data))
      .catch(() => setError('Failed to load reconciliation data'))
      .finally(() => setLoading(false));
  }, [filters, activeView]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payroll Reconciliation</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Validate timesheets and payments before publishing invoices
          </p>
        </div>
        <button onClick={load} className="btn-secondary text-sm py-2">↻ Refresh</button>
      </div>

      {/* View switcher */}
      <div className="flex gap-3 mb-5">
        {VIEWS.map(v => (
          <button
            key={v.id}
            onClick={() => { setActiveView(v.id); setData(null); }}
            className={`px-5 py-3 rounded-xl border text-sm font-medium transition-all text-left ${
              activeView === v.id
                ? 'bg-green-600 text-white border-green-600 shadow-sm'
                : 'bg-white text-gray-700 border-gray-200 hover:border-green-300'
            }`}
          >
            <span>{v.label}</span>
            <p className={`text-xs mt-0.5 font-normal ${activeView === v.id ? 'text-green-100' : 'text-gray-400'}`}>{v.sub}</p>
          </button>
        ))}
      </div>

      {/* Date filters */}
      <FiltersBar filters={filters} setFilters={setFilters} period={data?.period} />

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

      {/* Active view */}
      {activeView === 'payroll' ? (
        <PayrollPaymentView data={data} loading={loading} />
      ) : (
        <TimesheetDiscrepancyView data={data} loading={loading} />
      )}
    </div>
  );
}
