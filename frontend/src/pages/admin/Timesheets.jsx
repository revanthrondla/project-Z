import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';

function StatusBadge({ status }) {
  return <span className={`badge-${status}`}>{status}</span>;
}

// ─── Entry Modal (Admin can add/edit entries) ────────────────────────────────
function EntryModal({ entry, employees = [], projects = [], onClose, onSaved }) {
  const isEdit = !!entry?.id;
  const [form, setForm] = useState({
    candidate_id: entry?.candidate_id || '',
    date:         entry?.date         || new Date().toISOString().slice(0, 10),
    hours:        entry?.hours        || '',
    project_id:   entry?.project_id   || '',
    task_id:      entry?.task_id      || '',
    is_billable:  entry?.is_billable  !== false,
    description:  entry?.description  || '',
    billing_notes: entry?.billing_notes || '',
  });
  const [tasks, setTasks] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr]   = useState('');

  // Load tasks when project changes
  useEffect(() => {
    setForm(f => ({ ...f, task_id: '' }));
    if (form.project_id) {
      api.get(`/api/projects/${form.project_id}/tasks`)
        .then(r => setTasks(Array.isArray(r.data) ? r.data : []))
        .catch(() => setTasks([]));
    } else {
      setTasks([]);
    }
  }, [form.project_id]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.candidate_id || !form.date || !form.hours) {
      setErr('Employee, date and hours are required.'); return;
    }
    setSaving(true); setErr('');
    try {
      const payload = {
        ...form,
        hours:      Number(form.hours),
        project_id: form.project_id || null,
        task_id:    form.task_id    || null,
      };
      if (isEdit) await api.put(`/api/time-entries/${entry.id}`, payload);
      else        await api.post('/api/time-entries', payload);
      onSaved();
    } catch (e) {
      setErr(e.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">{isEdit ? 'Edit Entry' : 'Add Time Entry'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {err && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{err}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Employee *</label>
              <select className="input" value={form.candidate_id} onChange={e => set('candidate_id', e.target.value)} required>
                <option value="">Select employee…</option>
                {employees.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Date *</label>
              <input type="date" className="input" value={form.date} onChange={e => set('date', e.target.value)} required />
            </div>
            <div>
              <label className="label">Hours *</label>
              <input type="number" step="0.25" min="0.25" max="24" className="input" value={form.hours}
                onChange={e => set('hours', e.target.value)} placeholder="e.g. 8" required />
            </div>
            <div>
              <label className="label">Project</label>
              <select className="input" value={form.project_id} onChange={e => set('project_id', e.target.value)}>
                <option value="">No project</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Task</label>
              <select className="input" value={form.task_id} onChange={e => set('task_id', e.target.value)}
                disabled={!form.project_id || tasks.length === 0}>
                <option value="">No task</option>
                {tasks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Description</label>
            <textarea className="input" rows={2} value={form.description}
              onChange={e => set('description', e.target.value)} placeholder="What was worked on?" />
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={form.is_billable} onChange={e => set('is_billable', e.target.checked)}
                className="rounded text-emerald-600 h-4 w-4" />
              <span className="text-sm font-medium text-gray-700">Billable</span>
            </label>
          </div>

          {form.is_billable && (
            <div>
              <label className="label">Billing Notes</label>
              <input type="text" className="input" value={form.billing_notes}
                onChange={e => set('billing_notes', e.target.value)} placeholder="Optional billing note for invoice" />
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Reject Reason Modal ─────────────────────────────────────────────────────
function RejectModal({ entryId, onClose, onRejected }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put(`/api/time-entries/${entryId}`, { status: 'rejected', rejected_reason: reason });
      onRejected();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Reject Entry</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="label">Reason (optional)</label>
            <textarea className="input" rows={3} value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Explain why this entry is being rejected…" />
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-danger">
              {saving ? 'Rejecting…' : 'Reject Entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function AdminTimesheets() {
  const [entries,    setEntries]    = useState([]);
  const [employees, setEmployees] = useState([]);
  const [projects,   setProjects]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [filters,    setFilters]    = useState({ candidate_id: '', project_id: '', status: '', month: '' });
  const [error,      setError]      = useState('');
  const [selected,   setSelected]   = useState([]);
  const [processing, setProcessing] = useState(false);
  const [modal,      setModal]      = useState(null); // null | { type: 'entry', entry } | { type: 'reject', id }

  const load = useCallback(() => {
    setError('');
    const params = {};
    if (filters.candidate_id) params.candidate_id = filters.candidate_id;
    if (filters.project_id)   params.project_id   = filters.project_id;
    if (filters.status)       params.status        = filters.status;
    if (filters.month)        params.month         = filters.month;
    return api.get('/api/time-entries', { params })
      .then(r => setEntries(Array.isArray(r.data) ? r.data : []))
      .catch(() => setError('Failed to load timesheets. Is the server running?'))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => {
    Promise.all([
      api.get('/api/employees').then(r => setEmployees(Array.isArray(r.data) ? r.data : [])),
      api.get('/api/projects').then(r => setProjects(Array.isArray(r.data?.projects ?? r.data) ? (r.data?.projects ?? r.data) : [])),
    ]);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (id) => {
    await api.put(`/api/time-entries/${id}`, { status: 'approved' });
    load();
  };

  const handleBulkAction = async (status) => {
    if (!selected.length) return;
    setProcessing(true);
    try {
      await api.post('/api/time-entries/bulk-approve', { ids: selected, status });
      setSelected([]);
      load();
    } finally {
      setProcessing(false);
    }
  };

  const toggleSelect = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleAll = () => {
    const pendingIds = entries.filter(e => e.status === 'pending').map(e => e.id);
    setSelected(prev => prev.length === pendingIds.length ? [] : pendingIds);
  };

  const totalHours   = entries.reduce((s, e) => s + Number(e.hours || 0), 0);
  const totalAmount  = entries.reduce((s, e) => s + Number(e.hours || 0) * Number(e.hourly_rate || 0), 0);
  const billableHrs  = entries.filter(e => e.is_billable !== false).reduce((s, e) => s + Number(e.hours || 0), 0);
  const pendingCount = entries.filter(e => e.status === 'pending').length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Timesheets</h1>
          <p className="text-gray-500 mt-1">
            {entries.length} entries · {totalHours.toFixed(1)}h total · {billableHrs.toFixed(1)}h billable
            {pendingCount > 0 && <span className="ml-2 text-amber-600 font-medium">· {pendingCount} pending review</span>}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {selected.length > 0 && (
            <>
              <span className="text-sm text-gray-500">{selected.length} selected</span>
              <button onClick={() => handleBulkAction('approved')} disabled={processing} className="btn-success text-sm py-1.5">Approve All</button>
              <button onClick={() => handleBulkAction('rejected')} disabled={processing} className="btn-danger text-sm py-1.5">Reject All</button>
            </>
          )}
          <button onClick={() => setModal({ type: 'entry', entry: null })} className="btn-primary text-sm">
            + Add Entry
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Hours',    value: `${totalHours.toFixed(1)}h`,  sub: 'all entries',            icon: '⏱️' },
          { label: 'Billable Hours', value: `${billableHrs.toFixed(1)}h`, sub: `${totalHours > 0 ? Math.round(billableHrs/totalHours*100) : 0}% of total`, icon: '💰' },
          { label: 'Total Value',    value: `$${totalAmount.toLocaleString('en-US', {minimumFractionDigits:2})}`, sub: 'at employee rates', icon: '💵' },
          { label: 'Pending Review', value: pendingCount,                 sub: 'need approval',           icon: '🔔' },
        ].map(k => (
          <div key={k.label} className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">{k.icon}</span>
              <span className="text-xs text-gray-500">{k.label}</span>
            </div>
            <p className="text-xl font-bold text-gray-900">{k.value}</p>
            <p className="text-xs text-gray-400">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select className="input max-w-[200px]" value={filters.candidate_id}
          onChange={e => setFilters({...filters, candidate_id: e.target.value})}>
          <option value="">All Employees</option>
          {employees.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input max-w-[200px]" value={filters.project_id}
          onChange={e => setFilters({...filters, project_id: e.target.value})}>
          <option value="">All Projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="input max-w-[160px]" value={filters.status}
          onChange={e => setFilters({...filters, status: e.target.value})}>
          <option value="">All Status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <input type="month" className="input max-w-[180px]" value={filters.month}
          onChange={e => setFilters({...filters, month: e.target.value})} />
        <button onClick={() => setFilters({ candidate_id: '', project_id: '', status: '', month: '' })}
          className="btn-secondary text-sm">Reset</button>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {error ? (
          <div className="text-center py-16 text-red-500">
            <div className="text-4xl mb-2">⚠️</div>
            <p>{error}</p>
            <button onClick={load} className="mt-3 btn-primary text-sm">Retry</button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-2">⏱️</div>
            <p>No time entries found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3">
                  <input type="checkbox" onChange={toggleAll}
                    checked={selected.length > 0 && selected.length === entries.filter(e => e.status === 'pending').length}
                    className="rounded" />
                </th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Employee</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Date</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Hours</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Project / Task</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Description</th>
                <th className="text-center px-4 py-3 text-gray-500 font-medium">Billable</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Amount</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
                <th className="text-right px-4 py-3 text-gray-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {entries.map(e => (
                <tr key={e.id} className={`hover:bg-gray-50 ${selected.includes(e.id) ? 'bg-emerald-50' : ''}`}>
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.includes(e.id)}
                      onChange={() => toggleSelect(e.id)} disabled={e.status !== 'pending'} className="rounded" />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{e.candidate_name}</p>
                    <p className="text-xs text-gray-400">${e.hourly_rate}/hr</p>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{e.date}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{e.hours}h</td>
                  <td className="px-4 py-3">
                    {e.project_name
                      ? <><p className="text-gray-800 font-medium">{e.project_name}</p>
                          {e.task_name && <p className="text-xs text-gray-400">{e.task_name}</p>}</>
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 max-w-[180px]">
                    <p className="truncate">{e.description || '—'}</p>
                    {e.billing_notes && <p className="text-xs text-blue-500 truncate">{e.billing_notes}</p>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {e.is_billable !== false
                      ? <span className="text-emerald-600 text-xs font-semibold">✓ Bill</span>
                      : <span className="text-gray-400 text-xs">Non-bill</span>}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    ${(Number(e.hours || 0) * Number(e.hourly_rate || 0)).toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={e.status} />
                    {e.rejected_reason && (
                      <p className="text-xs text-red-400 mt-0.5 truncate max-w-[100px]" title={e.rejected_reason}>
                        {e.rejected_reason}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {e.status === 'pending' ? (
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => handleApprove(e.id)}
                          className="text-green-600 hover:underline text-xs font-medium">Approve</button>
                        <button onClick={() => setModal({ type: 'reject', id: e.id })}
                          className="text-red-500 hover:underline text-xs">Reject</button>
                        <button onClick={() => setModal({ type: 'entry', entry: e })}
                          className="text-blue-500 hover:underline text-xs">Edit</button>
                      </div>
                    ) : (
                      <button onClick={() => setModal({ type: 'entry', entry: e })}
                        className="text-blue-400 hover:underline text-xs">Edit</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t border-gray-100">
              <tr>
                <td colSpan={3} className="px-4 py-3 text-sm font-medium text-gray-700">Totals</td>
                <td className="px-4 py-3 font-bold text-gray-900">{totalHours.toFixed(1)}h</td>
                <td colSpan={2} />
                <td className="px-4 py-3 font-bold text-emerald-700 text-center">{billableHrs.toFixed(1)}h</td>
                <td className="px-4 py-3 font-bold text-gray-900">
                  ${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Modals */}
      {modal?.type === 'entry' && (
        <EntryModal
          entry={modal.entry}
          employees={employees}
          projects={projects}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
      {modal?.type === 'reject' && (
        <RejectModal
          entryId={modal.id}
          onClose={() => setModal(null)}
          onRejected={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}
