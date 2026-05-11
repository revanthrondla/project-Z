/**
 * Privacy Center — CCPA/CPRA Data Subject Rights Management
 *
 * Tabs:
 *   1. Requests Queue  — view / approve / reject incoming data requests
 *   2. Data Export     — download full personal data JSON for any employee
 *   3. Right to Erase  — anonymise & soft-delete an employee record
 *   4. Data Correction — patch specific PII fields with audit trail
 */
import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';

const STATUS_BADGE = {
  pending:    { label: 'Pending',    cls: 'bg-yellow-100 text-yellow-800' },
  in_review:  { label: 'In Review',  cls: 'bg-blue-100   text-blue-800'   },
  completed:  { label: 'Completed',  cls: 'bg-green-100  text-green-800'  },
  rejected:   { label: 'Rejected',   cls: 'bg-red-100    text-red-800'    },
};

const REQUEST_TYPE_LABELS = {
  access:      'Right to Access / Know',
  portability: 'Data Portability',
  correction:  'Right to Correct',
  erasure:     'Right to Erase',
  opt_out:     'Opt-Out of Sale',
};

function Badge({ status }) {
  const m = STATUS_BADGE[status] || { label: status, cls: 'bg-gray-100 text-gray-700' };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${m.cls}`}>{m.label}</span>;
}

// ── Tab 1: Requests Queue ────────────────────────────────────────────────────

function RequestsTab() {
  const [requests, setRequests]   = useState([]);
  const [filter,   setFilter]     = useState('pending');
  const [loading,  setLoading]    = useState(true);
  const [selected, setSelected]   = useState(null);
  const [notes,    setNotes]      = useState('');
  const [saving,   setSaving]     = useState(false);
  const [err,      setErr]        = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/privacy/requests', { params: filter !== 'all' ? { status: filter } : {} });
      setRequests(Array.isArray(r.data) ? r.data : []);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id, status) => {
    setSaving(true); setErr(null);
    try {
      await api.put(`/privacy/requests/${id}`, { status, response_notes: notes });
      setSelected(null); setNotes('');
      await load();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  const downloadExport = async (employeeId) => {
    try {
      const token = localStorage.getItem('flow_token');
      const r = await fetch(`/api/privacy/export/${employeeId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `personal-data-${employeeId}.json`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr('Export failed');
    }
  };

  return (
    <div className="space-y-4">
      {err && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{err}</div>}

      <div className="flex items-center gap-2 flex-wrap">
        {['pending','in_review','completed','rejected','all'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${
              filter === s ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}>{s === 'all' ? 'All' : STATUS_BADGE[s]?.label || s}</button>
        ))}
        <span className="text-xs text-gray-400 ml-auto">{requests.length} request(s)</span>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm py-8 text-center">Loading…</p>
      ) : requests.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8 text-center text-gray-400 text-sm">
          No {filter !== 'all' ? filter : ''} requests found.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Employee</th>
                <th className="px-4 py-2 text-left">Request Type</th>
                <th className="px-4 py-2 text-left">Submitted</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {requests.map(r => (
                <React.Fragment key={r.id}>
                  <tr className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{r.employee_name}</p>
                      <p className="text-xs text-gray-400">{r.employee_email}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{REQUEST_TYPE_LABELS[r.request_type] || r.request_type}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{new Date(r.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3"><Badge status={r.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {(r.request_type === 'access' || r.request_type === 'portability') && (
                          <button onClick={() => downloadExport(r.candidate_id)}
                            className="text-blue-600 hover:text-blue-800 text-xs font-medium">⬇ Export</button>
                        )}
                        {r.status === 'pending' && (
                          <button onClick={() => { setSelected(r); setNotes(''); }}
                            className="text-green-600 hover:text-green-800 text-xs font-medium">Process →</button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {selected?.id === r.id && (
                    <tr className="bg-blue-50 border-t border-blue-100">
                      <td colSpan={5} className="px-4 py-4">
                        <p className="text-sm font-medium text-gray-800 mb-2">Process Request — {REQUEST_TYPE_LABELS[r.request_type]}</p>
                        {r.request_notes && <p className="text-xs text-gray-600 mb-3 bg-white border border-gray-200 rounded-lg px-3 py-2">"{r.request_notes}"</p>}
                        <textarea
                          rows={2} value={notes} onChange={e => setNotes(e.target.value)}
                          placeholder="Response notes (visible in audit trail)…"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 mb-3"
                        />
                        <div className="flex gap-2">
                          <button onClick={() => updateStatus(r.id, 'completed')} disabled={saving}
                            className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-medium px-4 py-1.5 rounded-lg">
                            {saving ? '…' : '✓ Mark Complete'}
                          </button>
                          <button onClick={() => updateStatus(r.id, 'in_review')} disabled={saving}
                            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium px-4 py-1.5 rounded-lg">
                            In Review
                          </button>
                          <button onClick={() => updateStatus(r.id, 'rejected')} disabled={saving}
                            className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium px-4 py-1.5 rounded-lg">
                            Reject
                          </button>
                          <button onClick={() => setSelected(null)} className="border border-gray-300 text-gray-600 text-xs font-medium px-4 py-1.5 rounded-lg hover:bg-gray-100">
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Tab 2: Data Export ───────────────────────────────────────────────────────

function ExportTab({ employees }) {
  const [search,     setSearch]     = useState('');
  const [exporting,  setExporting]  = useState(null);
  const [err,        setErr]        = useState(null);

  const filtered = employees.filter(e =>
    !search || e.name.toLowerCase().includes(search.toLowerCase()) || e.email.toLowerCase().includes(search.toLowerCase())
  );

  const doExport = async (emp) => {
    setExporting(emp.id); setErr(null);
    try {
      const token = localStorage.getItem('flow_token');
      const r = await fetch(`/api/privacy/export/${emp.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!r.ok) throw new Error(await r.text());
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `personal-data-${emp.name.replace(/\s+/g,'-')}.json`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr('Export failed: ' + e.message);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
        ℹ️ Export generates a signed JSON file containing all personal data for the employee — compliant with CCPA Right to Know / GDPR Data Portability. The file is downloaded to your browser.
      </div>
      {err && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{err}</div>}
      <input
        className="w-full max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        placeholder="Search employee…" value={search} onChange={e => setSearch(e.target.value)}
      />
      <div className="bg-white border border-gray-200 rounded-2xl divide-y divide-gray-100">
        {filtered.length === 0 ? (
          <p className="px-5 py-8 text-center text-gray-400 text-sm">No employees found.</p>
        ) : filtered.map(emp => (
          <div key={emp.id} className="flex items-center justify-between px-5 py-3">
            <div>
              <p className="font-medium text-gray-800 text-sm">{emp.name}</p>
              <p className="text-xs text-gray-400">{emp.email} · {emp.role}</p>
            </div>
            <button onClick={() => doExport(emp)} disabled={exporting === emp.id}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1.5">
              {exporting === emp.id ? '⏳ Exporting…' : '⬇ Export JSON'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tab 3: Right to Erasure ──────────────────────────────────────────────────

function ErasureTab({ employees, onRefresh }) {
  const [search,    setSearch]    = useState('');
  const [selected,  setSelected]  = useState(null);
  const [reason,    setReason]    = useState('');
  const [confirm,   setConfirm]   = useState('');
  const [deleting,  setDeleting]  = useState(false);
  const [msg,       setMsg]       = useState(null);
  const [err,       setErr]       = useState(null);

  const filtered = employees.filter(e =>
    !search || e.name.toLowerCase().includes(search.toLowerCase()) || e.email.toLowerCase().includes(search.toLowerCase())
  );

  const doErase = async () => {
    if (confirm !== selected.name) return setErr('Type the employee name exactly to confirm.');
    setDeleting(true); setErr(null); setMsg(null);
    try {
      await api.delete(`/privacy/delete/${selected.id}`, { data: { legal_basis: reason || 'CCPA Right to Erasure' } });
      setMsg(`✓ ${selected.name} has been anonymised. Financial records retained per FLSA/IRS.`);
      setSelected(null); setConfirm(''); setReason('');
      onRefresh();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
        ⚠️ Erasure anonymises PII (name, email, phone) and soft-deletes the employee record. Time entries, invoices and financial records are <strong>retained</strong> per FLSA / IRS requirements. This action is irreversible.
      </div>
      {msg && <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">{msg}</div>}
      {err && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{err}</div>}

      <input className="w-full max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        placeholder="Search employee…" value={search} onChange={e => setSearch(e.target.value)} />

      <div className="bg-white border border-gray-200 rounded-2xl divide-y divide-gray-100">
        {filtered.length === 0 ? (
          <p className="px-5 py-8 text-center text-gray-400 text-sm">No employees found.</p>
        ) : filtered.map(emp => (
          <div key={emp.id} className="px-5 py-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-800 text-sm">{emp.name}</p>
                <p className="text-xs text-gray-400">{emp.email} · {emp.role}</p>
              </div>
              {selected?.id === emp.id ? (
                <button onClick={() => { setSelected(null); setConfirm(''); setErr(null); }}
                  className="text-gray-400 hover:text-gray-600 text-xs">Cancel</button>
              ) : (
                <button onClick={() => { setSelected(emp); setConfirm(''); setErr(null); }}
                  className="bg-red-600 hover:bg-red-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg">
                  Erase →
                </button>
              )}
            </div>
            {selected?.id === emp.id && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                <p className="text-sm font-semibold text-red-800">Confirm erasure of <em>{emp.name}</em></p>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Legal basis / reason</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                    placeholder="e.g. CCPA Right to Erasure request received 2026-05-01"
                    value={reason} onChange={e => setReason(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Type <strong>{emp.name}</strong> to confirm</label>
                  <input className="w-full border border-red-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                    placeholder={emp.name} value={confirm} onChange={e => setConfirm(e.target.value)} />
                </div>
                <button onClick={doErase} disabled={deleting || confirm !== emp.name}
                  className="bg-red-700 hover:bg-red-800 disabled:opacity-40 text-white text-xs font-bold px-5 py-2 rounded-lg w-full transition-colors">
                  {deleting ? 'Processing…' : '⚠️ Permanently Anonymise Record'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tab 4: Data Correction ───────────────────────────────────────────────────

function CorrectionTab({ employees, onRefresh }) {
  const [search,   setSearch]   = useState('');
  const [selected, setSelected] = useState(null);
  const [form,     setForm]     = useState({});
  const [saving,   setSaving]   = useState(false);
  const [msg,      setMsg]      = useState(null);
  const [err,      setErr]      = useState(null);

  const filtered = employees.filter(e =>
    !search || e.name.toLowerCase().includes(search.toLowerCase()) || e.email.toLowerCase().includes(search.toLowerCase())
  );

  const openEdit = (emp) => {
    setSelected(emp);
    setForm({ name: emp.name || '', email: emp.email || '', phone: emp.phone || '' });
    setMsg(null); setErr(null);
  };

  const save = async () => {
    setSaving(true); setErr(null); setMsg(null);
    try {
      await api.put(`/privacy/correct/${selected.id}`, form);
      setMsg(`✓ Record corrected for ${form.name || selected.name}.`);
      setSelected(null);
      onRefresh();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
        ℹ️ Use this to correct inaccurate personal information under CCPA Right to Correct or GDPR Article 16. All changes are logged to the audit trail.
      </div>
      {msg && <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">{msg}</div>}
      {err && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{err}</div>}

      <input className="w-full max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        placeholder="Search employee…" value={search} onChange={e => setSearch(e.target.value)} />

      <div className="bg-white border border-gray-200 rounded-2xl divide-y divide-gray-100">
        {filtered.length === 0 ? (
          <p className="px-5 py-8 text-center text-gray-400 text-sm">No employees found.</p>
        ) : filtered.map(emp => (
          <div key={emp.id} className="px-5 py-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-800 text-sm">{emp.name}</p>
                <p className="text-xs text-gray-400">{emp.email} · {emp.role}</p>
              </div>
              {selected?.id === emp.id ? (
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-xs">Cancel</button>
              ) : (
                <button onClick={() => openEdit(emp)}
                  className="border border-gray-300 text-gray-700 hover:bg-gray-50 text-xs font-medium px-3 py-1.5 rounded-lg">
                  Correct →
                </button>
              )}
            </div>
            {selected?.id === emp.id && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                {[['name','Full Name'],['email','Email'],['phone','Phone']].map(([k,l]) => (
                  <div key={k}>
                    <label className="block text-xs text-gray-500 mb-1">{l}</label>
                    <input className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      value={form[k] || ''} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
                  </div>
                ))}
                <div className="md:col-span-3 flex gap-2 mt-1">
                  <button onClick={save} disabled={saving}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium px-5 py-2 rounded-lg">
                    {saving ? 'Saving…' : 'Save Correction'}
                  </button>
                  <button onClick={() => setSelected(null)} className="border border-gray-300 text-gray-600 text-xs font-medium px-4 py-2 rounded-lg hover:bg-gray-100">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'requests',   label: '📬 Requests Queue' },
  { id: 'export',     label: '⬇ Data Export' },
  { id: 'erasure',    label: '🗑 Right to Erase' },
  { id: 'correction', label: '✏️ Data Correction' },
];

export default function Privacy() {
  const [activeTab, setActiveTab] = useState('requests');
  const [employees, setEmployees] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    api.get('/api/employees').then(r => setEmployees(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, [refreshKey]);

  const refresh = () => setRefreshKey(k => k + 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Privacy Center</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage data subject rights under CCPA/CPRA and GDPR — access requests, data exports, erasure, and corrections.
          All actions are logged to the audit trail.
        </p>
      </div>

      {/* Regulatory badges */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: 'CCPA / CPRA', bg: 'bg-blue-50 text-blue-700 border-blue-200' },
          { label: 'GDPR',        bg: 'bg-purple-50 text-purple-700 border-purple-200' },
          { label: 'Right to Know',   bg: 'bg-green-50 text-green-700 border-green-200' },
          { label: 'Right to Erase',  bg: 'bg-red-50 text-red-700 border-red-200' },
          { label: 'Right to Correct', bg: 'bg-amber-50 text-amber-700 border-amber-200' },
        ].map(b => (
          <span key={b.label} className={`text-xs font-medium px-3 py-1 rounded-full border ${b.bg}`}>{b.label}</span>
        ))}
      </div>

      {/* Tab bar */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <div className="flex border-b border-gray-200 min-w-max">
            {TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-700 bg-blue-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}>{tab.label}</button>
            ))}
          </div>
        </div>
        <div className="p-6">
          {activeTab === 'requests'   && <RequestsTab />}
          {activeTab === 'export'     && <ExportTab employees={employees} />}
          {activeTab === 'erasure'    && <ErasureTab employees={employees} onRefresh={refresh} />}
          {activeTab === 'correction' && <CorrectionTab employees={employees} onRefresh={refresh} />}
        </div>
      </div>
    </div>
  );
}
