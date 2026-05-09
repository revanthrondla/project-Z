import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api';

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

export default function LogHours() {
  const { user } = useAuth();
  const [entries,     setEntries]     = useState([]);
  const [projects,    setProjects]    = useState([]);
  const [tasks,       setTasks]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showModal,   setShowModal]   = useState(false);
  const [editing,     setEditing]     = useState(null);
  const [form, setForm] = useState({
    date:          new Date().toISOString().slice(0, 10),
    hours:         '',
    description:   '',
    project_id:    '',
    task_id:       '',
    is_billable:   true,
    billing_notes: '',
  });
  const [error,       setError]       = useState('');
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));

  // Load projects once
  useEffect(() => {
    api.get('/api/projects')
      .then(r => {
        const list = Array.isArray(r.data?.projects) ? r.data.projects : (Array.isArray(r.data) ? r.data : []);
        setProjects(list);
      })
      .catch(() => {});
  }, []);

  // Load tasks when selected project changes
  useEffect(() => {
    setForm(f => ({ ...f, task_id: '' }));
    if (form.project_id) {
      api.get(`/api/projects/${form.project_id}/tasks`)
        .then(r => setTasks(Array.isArray(r.data) ? r.data : []))
        .catch(() => setTasks([]));
    } else {
      setTasks([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.project_id]);

  const load = useCallback(() => {
    const params = { candidate_id: user.candidateId };
    if (filterMonth) params.month = filterMonth;
    return api.get('/api/time-entries', { params })
      .then(r => setEntries(Array.isArray(r.data) ? r.data : []))
      .finally(() => setLoading(false));
  }, [filterMonth, user.candidateId]);

  useEffect(() => { load(); }, [load]);

  const blankForm = () => ({
    date:          new Date().toISOString().slice(0, 10),
    hours:         '',
    description:   '',
    project_id:    '',
    task_id:       '',
    is_billable:   true,
    billing_notes: '',
  });

  const openCreate = () => {
    setEditing(null);
    setForm(blankForm());
    setError('');
    setShowModal(true);
  };

  const openEdit = (e) => {
    if (e.status !== 'pending') return;
    setEditing(e);
    setForm({
      date:          e.date,
      hours:         e.hours,
      description:   e.description   || '',
      project_id:    e.project_id    || '',
      task_id:       e.task_id       || '',
      is_billable:   e.is_billable   !== false,
      billing_notes: e.billing_notes || '',
    });
    setError('');
    setShowModal(true);
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    setError('');
    try {
      const payload = {
        ...form,
        hours:      Number(form.hours),
        project_id: form.project_id || null,
        task_id:    form.task_id    || null,
      };
      if (editing) await api.put(`/api/time-entries/${editing.id}`, payload);
      else         await api.post('/api/time-entries', payload);
      setShowModal(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this time entry?')) return;
    try { await api.delete(`/api/time-entries/${id}`); load(); }
    catch (err) { alert(err.response?.data?.error || 'Delete failed'); }
  };

  const totalHours    = entries.reduce((s, e) => s + Number(e.hours || 0), 0);
  const approvedHours = entries.filter(e => e.status === 'approved').reduce((s, e) => s + Number(e.hours || 0), 0);
  const pendingHours  = entries.filter(e => e.status === 'pending').reduce((s, e) => s + Number(e.hours || 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Log Hours</h1>
          <p className="text-gray-500 mt-1">{totalHours.toFixed(1)}h total · {approvedHours.toFixed(1)}h approved this period</p>
        </div>
        <button onClick={openCreate} className="btn-primary">+ Log Hours</button>
      </div>

      {/* Month filter */}
      <div className="flex gap-3 mb-4">
        <input type="month" className="input max-w-[200px]" value={filterMonth}
          onChange={e => setFilterMonth(e.target.value)} />
        <button onClick={() => setFilterMonth(new Date().toISOString().slice(0, 7))}
          className="btn-secondary text-sm">This Month</button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{totalHours.toFixed(1)}</p>
          <p className="text-xs text-gray-500 mt-1">Total Hours</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{approvedHours.toFixed(1)}</p>
          <p className="text-xs text-gray-500 mt-1">Approved</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-yellow-600">{pendingHours.toFixed(1)}</p>
          <p className="text-xs text-gray-500 mt-1">Pending</p>
        </div>
      </div>

      {/* Entries table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-2">⏱️</div>
            <p>No time entries this period</p>
            <button onClick={openCreate} className="mt-3 btn-primary text-sm">Log your first hours</button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Date</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Project / Task</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Description</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Hours</th>
                <th className="text-center px-4 py-3 text-gray-500 font-medium">Billable</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
                <th className="text-right px-4 py-3 text-gray-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {entries.map(e => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-700 font-medium">{e.date}</td>
                  <td className="px-4 py-3">
                    {e.project_name
                      ? <><p className="text-gray-800 font-medium">{e.project_name}</p>
                          {e.task_name && <p className="text-xs text-gray-400">{e.task_name}</p>}</>
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 max-w-[220px] truncate">{e.description || '—'}</td>
                  <td className="px-4 py-3 font-bold text-gray-900">{e.hours}h</td>
                  <td className="px-4 py-3 text-center">
                    {e.is_billable !== false
                      ? <span className="text-emerald-600 text-xs font-semibold">✓</span>
                      : <span className="text-gray-400 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge-${e.status}`}>{e.status}</span>
                    {e.rejected_reason && (
                      <p className="text-xs text-red-400 mt-0.5" title={e.rejected_reason}>
                        {e.rejected_reason}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {e.status === 'pending' ? (
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEdit(e)} className="text-emerald-600 hover:underline text-xs">Edit</button>
                        <button onClick={() => handleDelete(e.id)} className="text-red-500 hover:underline text-xs">Delete</button>
                      </div>
                    ) : <span className="text-xs text-gray-300">Locked</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <Modal title={editing ? 'Edit Time Entry' : 'Log Hours'} onClose={() => setShowModal(false)}>
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Date *</label>
              <input type="date" className="input" value={form.date}
                onChange={e => setForm({...form, date: e.target.value})}
                required max={new Date().toISOString().slice(0, 10)} />
            </div>
            <div>
              <label className="label">Hours Worked *</label>
              <input type="number" step="0.25" min="0.25" max="24" className="input"
                placeholder="e.g. 8 or 7.5" value={form.hours}
                onChange={e => setForm({...form, hours: e.target.value})} required />
            </div>
            <div>
              <label className="label">Project</label>
              <select className="input" value={form.project_id}
                onChange={e => setForm({...form, project_id: e.target.value})}>
                <option value="">No project</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {form.project_id && tasks.length > 0 && (
              <div>
                <label className="label">Task</label>
                <select className="input" value={form.task_id}
                  onChange={e => setForm({...form, task_id: e.target.value})}>
                  <option value="">No specific task</option>
                  {tasks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="label">Description</label>
              <textarea className="input" rows={3} placeholder="What did you work on today?"
                value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={form.is_billable}
                onChange={e => setForm({...form, is_billable: e.target.checked})}
                className="rounded text-emerald-600 h-4 w-4" />
              <span className="text-sm font-medium text-gray-700">Billable time</span>
            </label>
            {form.is_billable && (
              <div>
                <label className="label">Billing Notes</label>
                <input type="text" className="input" placeholder="Optional note for invoice"
                  value={form.billing_notes} onChange={e => setForm({...form, billing_notes: e.target.value})} />
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button type="submit" className="btn-primary flex-1">
                {editing ? 'Save Changes' : 'Log Hours'}
              </button>
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
