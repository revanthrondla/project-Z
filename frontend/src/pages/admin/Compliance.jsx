/**
 * Compliance Center
 * Retention dashboard, missing records alerts, overtime risk, classification issues.
 * Supports FLSA, EEOC, IRS, CCPA/CPRA, I-9, and DOL 2024 contractor rule.
 */
import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';

const RETENTION_SCHEDULE = [
  { category: 'Time Records & Schedules',     years: 2,  authority: 'FLSA / DOL',  note: 'Time cards, work schedules, basis for pay' },
  { category: 'Payroll Records',              years: 3,  authority: 'FLSA / DOL',  note: 'Name, address, occupation, hours, wages paid' },
  { category: 'Employment Tax Records',       years: 4,  authority: 'IRS',         note: 'Amounts and dates of wage payments, W-2s, 941s' },
  { category: 'Personnel Records',            years: 1,  authority: 'EEOC',        note: 'From date of record or personnel action, whichever is later' },
  { category: 'I-9 / Employment Eligibility', years: 3,  authority: 'USCIS / DHS', note: '3 yrs from hire OR 1 yr after termination, whichever is later' },
  { category: 'Business Tax Records',         years: 7,  authority: 'IRS',         note: 'Invoices, receipts, contracts to support tax return' },
  { category: 'Invoices & Contracts',         years: 7,  authority: 'IRS / GAAP',  note: 'Keep long enough to prove income and deductions' },
  { category: 'Discrimination Charge Files',  years: 99, authority: 'EEOC',        note: 'Retain until final disposition of the charge' },
];

function SeverityBadge({ count, label, level }) {
  const colors = { red: 'bg-red-100 text-red-700', amber: 'bg-amber-100 text-amber-700', green: 'bg-green-100 text-green-700' };
  return (
    <div className={`rounded-lg p-4 ${colors[level] || 'bg-gray-100 text-gray-700'}`}>
      <p className="text-2xl font-bold">{count}</p>
      <p className="text-xs mt-1">{label}</p>
    </div>
  );
}

export default function Compliance() {
  const [data,         setData]         = useState(null);
  const [otData,       setOtData]       = useState(null);
  const [missingAppr,  setMissingAppr]  = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [activeTab,    setActiveTab]    = useState('overview');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [comp, ot, miss] = await Promise.all([
        api.get('/api/reports/compliance'),
        api.get('/api/reports/overtime-risk'),
        api.get('/api/reports/missing-approvals', { params: { days_pending: 5 } }),
      ]);
      setData(comp.data);
      setOtData(ot.data);
      setMissingAppr(miss.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totalIssues = data ? Object.values(data.summary).reduce((s, v) => s + v, 0) : 0;

  const TABS = [
    { key: 'overview',    label: '📋 Overview' },
    { key: 'retention',   label: '📁 Retention Schedule' },
    { key: 'overtime',    label: '⏱️ Overtime Risk' },
    { key: 'approvals',   label: '⏳ Pending Approvals' },
    { key: 'contractors', label: '👷 Contractor Issues' },
    { key: 'data',        label: '🗂️ Documents' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600"/>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compliance Center</h1>
          <p className="text-gray-500 mt-1">FLSA · EEOC · IRS · CCPA · DOL 2024 Contractor Rule</p>
        </div>
        <button onClick={load} className="btn-secondary text-sm">↻ Refresh</button>
      </div>

      {/* Top-level alert */}
      {totalIssues > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5 flex items-start gap-3">
          <span className="text-2xl">⚠️</span>
          <div>
            <p className="font-semibold text-amber-900">{totalIssues} compliance item{totalIssues !== 1 ? 's' : ''} require attention</p>
            <p className="text-sm text-amber-700 mt-1">Review the categories below. This is informational — consult qualified legal counsel for advice specific to your situation.</p>
          </div>
        </div>
      )}

      {/* Summary KPIs */}
      {data && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-6">
          <SeverityBadge count={data.summary.missing_w9}             label="Missing W-9"           level={data.summary.missing_w9 > 0 ? 'amber' : 'green'} />
          <SeverityBadge count={data.summary.pending_classification} label="Classification Review"  level={data.summary.pending_classification > 0 ? 'amber' : 'green'} />
          <SeverityBadge count={data.summary.stale_pending_entries}  label="Stale Pending Entries"  level={data.summary.stale_pending_entries > 5 ? 'red' : data.summary.stale_pending_entries > 0 ? 'amber' : 'green'} />
          <SeverityBadge count={data.summary.terminated_still_active}label="Terminated but Active"  level={data.summary.terminated_still_active > 0 ? 'red' : 'green'} />
          <SeverityBadge count={data.summary.overdue_data_requests}  label="Overdue Data Requests"  level={data.summary.overdue_data_requests > 0 ? 'red' : 'green'} />
          <SeverityBadge count={data.summary.expiring_documents}     label="Expiring Documents"     level={data.summary.expiring_documents > 0 ? 'amber' : 'green'} />
        </div>
      )}

      {/* Tab nav */}
      <div className="flex gap-1 mb-5 border-b border-gray-100 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === t.key ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>{t.label}</button>
        ))}
      </div>

      {/* ── Overview ── */}
      {activeTab === 'overview' && data && (
        <div className="space-y-4">
          {/* Missing W-9 */}
          {data.missing_w9.length > 0 && (
            <div className="card p-4">
              <h3 className="font-semibold text-gray-900 mb-3">⚠️ Contractors Missing W-9 ({data.missing_w9.length})</h3>
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">Name</th>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">Email</th>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">Start Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.missing_w9.map(r => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900">{r.name}</td>
                      <td className="px-3 py-2 text-gray-600">{r.email}</td>
                      <td className="px-3 py-2 text-gray-600">{r.start_date || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pending classification */}
          {data.pending_classification.length > 0 && (
            <div className="card p-4">
              <h3 className="font-semibold text-gray-900 mb-3">🔍 Pending Classification Review ({data.pending_classification.length})</h3>
              <p className="text-xs text-gray-500 mb-2">DOL 2024 final rule (effective March 11, 2024) — use 6-factor economic reality test. Consult counsel before final classification.</p>
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">Name</th>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">Start Date</th>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.pending_classification.map(r => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900">{r.name}</td>
                      <td className="px-3 py-2 text-gray-600">{r.start_date || '—'}</td>
                      <td className="px-3 py-2 text-gray-500 max-w-[200px] truncate">{r.classification_notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Terminated still active */}
          {data.terminated_still_active.length > 0 && (
            <div className="card p-4 border-l-4 border-red-400">
              <h3 className="font-semibold text-red-700 mb-3">🚨 Past End Date but Still Active ({data.terminated_still_active.length})</h3>
              <p className="text-xs text-gray-500 mb-2">These employees have passed their end date but are still marked active. Update their status to avoid payroll and records compliance issues.</p>
              <table className="w-full text-sm">
                <thead className="bg-red-50">
                  <tr>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">Name</th>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">End Date</th>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">Current Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-red-50">
                  {data.terminated_still_active.map(r => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 font-medium text-gray-900">{r.name}</td>
                      <td className="px-3 py-2 text-red-600 font-semibold">{r.end_date}</td>
                      <td className="px-3 py-2"><span className="badge-active">{r.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalIssues === 0 && (
            <div className="text-center py-16 text-gray-400">
              <div className="text-5xl mb-3">✅</div>
              <p className="font-medium text-gray-600">No compliance issues detected</p>
              <p className="text-sm mt-1">Refresh regularly to stay on top of changes</p>
            </div>
          )}
        </div>
      )}

      {/* ── Retention Schedule ── */}
      {activeTab === 'retention' && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <p className="text-sm text-gray-600">
              These are general retention guidelines. Requirements vary by jurisdiction, industry, and situation.
              <strong className="text-gray-800"> Consult qualified legal counsel</strong> to confirm what applies to your organization.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Record Category</th>
                <th className="text-center px-4 py-3 text-gray-500 font-medium">Min. Years</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Authority</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {RETENTION_SCHEDULE.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{r.category}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">
                      {r.years === 99 ? 'Indefinite' : `${r.years} yr${r.years > 1 ? 's' : ''}`}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{r.authority}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Overtime Risk ── */}
      {activeTab === 'overtime' && otData && (
        <div>
          <div className="grid grid-cols-3 gap-4 mb-5">
            <div className="card p-4">
              <p className="text-xs text-gray-500">Week</p>
              <p className="font-semibold text-gray-800">{otData.week.start} → {otData.week.end}</p>
            </div>
            <div className="card p-4 border-l-4 border-red-400">
              <p className="text-xs text-gray-500">Over OT threshold</p>
              <p className="text-2xl font-bold text-red-600">{otData.summary.over_ot}</p>
            </div>
            <div className="card p-4 border-l-4 border-amber-400">
              <p className="text-xs text-gray-500">Approaching OT (80%+)</p>
              <p className="text-2xl font-bold text-amber-600">{otData.summary.at_risk}</p>
            </div>
          </div>

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Employee</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Pay Rule</th>
                  <th className="text-center px-4 py-3 text-gray-500 font-medium">Hours This Week</th>
                  <th className="text-center px-4 py-3 text-gray-500 font-medium">OT Threshold</th>
                  <th className="text-center px-4 py-3 text-gray-500 font-medium">Risk</th>
                  <th className="text-right px-4 py-3 text-gray-500 font-medium">OT Exposure</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {otData.employees.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{e.name}</p>
                      <p className="text-xs text-gray-400">{e.role}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{e.pay_rule_name || 'Default'}</td>
                    <td className="px-4 py-3 text-center">
                      <div>
                        <span className="font-bold text-gray-900">{Number(e.hours_this_week).toFixed(1)}h</span>
                        <div className="mt-1 bg-gray-200 rounded-full h-1.5 w-20 mx-auto">
                          <div
                            className={`h-1.5 rounded-full ${e.risk_level === 'over' ? 'bg-red-500' : e.risk_level === 'at_risk' ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${Math.min(100, (Number(e.hours_this_week) / Number(e.ot_threshold)) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">{e.ot_threshold}h</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        e.risk_level === 'over' ? 'bg-red-100 text-red-700' :
                        e.risk_level === 'at_risk' ? 'bg-amber-100 text-amber-700' :
                        'bg-green-100 text-green-700'}`}>
                        {e.risk_level === 'over' ? '🚨 Over' : e.risk_level === 'at_risk' ? '⚠️ At Risk' : '✓ Safe'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {Number(e.ot_exposure_hrs) > 0
                        ? <span className="text-red-600">+{Number(e.ot_exposure_hrs).toFixed(1)}h OT</span>
                        : <span className="text-gray-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Missing Approvals ── */}
      {activeTab === 'approvals' && missingAppr && (
        <div>
          <div className="card p-4 mb-4 bg-amber-50 border border-amber-200">
            <p className="text-sm text-amber-800">
              <strong>{missingAppr.count}</strong> time entries have been pending approval for more than <strong>{missingAppr.threshold_days} days</strong>.
              Late approvals create payroll deadline risk and FLSA record-keeping gaps.
            </p>
          </div>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Date</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Employee</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Client / Project</th>
                  <th className="text-center px-4 py-3 text-gray-500 font-medium">Hours</th>
                  <th className="text-center px-4 py-3 text-gray-500 font-medium">Days Pending</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {missingAppr.entries.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">{e.date}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{e.candidate_name}</p>
                      <p className="text-xs text-gray-400">{e.candidate_email}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      <p>{e.client_name || '—'}</p>
                      {e.project_name && <p className="text-xs text-gray-400">{e.project_name}</p>}
                    </td>
                    <td className="px-4 py-3 text-center font-medium text-gray-900">{e.hours}h</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        Number(e.days_old) > 14 ? 'bg-red-100 text-red-700' :
                        Number(e.days_old) > 7  ? 'bg-amber-100 text-amber-700' :
                        'bg-yellow-100 text-yellow-700'}`}>
                        {e.days_old}d
                      </span>
                    </td>
                  </tr>
                ))}
                {missingAppr.entries.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-10 text-gray-400">No pending approval issues</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Contractor Issues ── */}
      {activeTab === 'contractors' && data && (
        <div className="space-y-4">
          {data.missing_w9.length === 0 && data.pending_classification.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <div className="text-5xl mb-3">✅</div>
              <p>No contractor compliance issues</p>
            </div>
          ) : (
            <>
              {data.missing_w9.length > 0 && (
                <div className="card p-4">
                  <h3 className="font-semibold text-amber-700 mb-3">Missing W-9 / W-8BEN ({data.missing_w9.length})</h3>
                  <p className="text-xs text-gray-500 mb-3">IRS requires W-9 from U.S. contractors paid $600+ for reporting on Form 1099-NEC. Consult a tax professional for international contractors.</p>
                  {data.missing_w9.map(r => (
                    <div key={r.id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div>
                        <p className="font-medium text-gray-900">{r.name}</p>
                        <p className="text-xs text-gray-400">{r.email}</p>
                      </div>
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">W-9 missing</span>
                    </div>
                  ))}
                </div>
              )}
              {data.pending_classification.length > 0 && (
                <div className="card p-4">
                  <h3 className="font-semibold text-amber-700 mb-2">Pending Classification ({data.pending_classification.length})</h3>
                  <p className="text-xs text-gray-500 mb-3">DOL 2024 rule — evaluate using the 6-factor economic reality test. Misclassification creates significant FLSA liability. Consult employment counsel.</p>
                  {data.pending_classification.map(r => (
                    <div key={r.id} className="py-2 border-b last:border-0">
                      <p className="font-medium text-gray-900">{r.name}</p>
                      <p className="text-xs text-gray-400">{r.classification_notes || 'No notes'}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Expiring Documents ── */}
      {activeTab === 'data' && data && (
        <div>
          {data.expiring_documents.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <div className="text-5xl mb-3">📂</div>
              <p>No documents expiring in the next 60 days</p>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="p-4 border-b border-gray-100 bg-amber-50">
                <p className="text-sm text-amber-800">
                  <strong>{data.expiring_documents.length}</strong> document(s) expire within 60 days. Review and renew as appropriate.
                </p>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Document</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Employee</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Type</th>
                    <th className="text-center px-4 py-3 text-gray-500 font-medium">Expires</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.expiring_documents.map(d => (
                    <tr key={d.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{d.title}</td>
                      <td className="px-4 py-3 text-gray-600">{d.candidate_name || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{d.document_type || '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          new Date(d.expires_at) < new Date(Date.now() + 7*86400000) ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                        }`}>{d.expires_at?.slice(0, 10)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
