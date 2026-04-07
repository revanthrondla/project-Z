import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api';

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
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
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), hours: '', description: '', project: '' });
  const [error, setError] = useState('');
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));

  const load = () => {
    const params = { candidate_id: user.candidateId };
    if (filterMonth) params.month = filterMonth;
    return api.get('/api/time-entries', { params })
      .then(r => setEntries(r.data))
      .finally(() => setLoading(false));
  };

  useEffect(load, [filterMonth]);

  const openCreate = () => {
    setEditing(null);
    setForm({ date: new Date().toISOString().slice(0, 10), hours: '', description: '', project: '' });
    setError('');
    setShowModal(true);
  };

  const openEdit = (e) => {
    if (e.status !== 'pending') return;
    setEditing(e);
    setForm({ date: e.date, hours: e.hours, description: e.description || '', project: e.project || '' });
    setError('');
    setShowModal(true);
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    setError('');
    try {
      if (editing) {
        await api.put(`/api/time-entries/${editing.id}`, form);
      } else {
        await api.post('/api/time-entries', form);
      }
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

  const totalHours = entries.reduce((s, e) => s + e.hours, 0);
  const approvedHours = entries.filter(e => e.status === 'approved').reduce((s, e) => s + e.hours, 0);

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
        <input type="month" className="input max-w-[200px]" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} />
        <button onClick={() => setFilterMonth(new Date().toISOString().slice(0, 7))} className="btn-secondary text-sm">This Month</button>
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
          <p className="text-2xl font-bold text-yellow-600">{entries.filter(e => e.status === 'pending').reduce((s, e) => s + e.hours, 0).toFixed(1)}</p>
          <p className="text-xs text-gray-500 mt-1">Pending</p>
        </div>
      </div>

      {/* Entries */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>
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
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Project</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Description</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Hours</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
                <th className="text-right px-4 py-3 text-gray-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {entries.map(e => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-700 font-medium">{e.date}</td>
                  <td className="px-4 py-3 text-gray-600">{e.project || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 max-w-[250px] truncate">{e.description || '—'}</td>
                  <td className="px-4 py-3 font-bold text-gray-900">{e.hours}h</td>
                  <td className="px-4 py-3"><span className={`badge-${e.status}`}>{e.status}</span></td>
                  <td className="px-4 py-3 text-right">
                    {e.status === 'pending' ? (
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEdit(e)} className="text-blue-600 hover:underline text-xs">Edit</button>
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
          {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Date *</label>
              <input type="date" className="input" value={form.date} onChange={e => setForm({...form, date: e.target.value})} required max={new Date().toISOString().slice(0, 10)} />
            </div>
            <div>
              <label className="label">Hours Worked *</label>
              <input type="number" step="0.5" min="0.5" max="24" className="input" placeholder="e.g. 8 or 7.5" value={form.hours} onChange={e => setForm({...form, hours: e.target.value})} required />
            </div>
            <div>
              <label className="label">Project</label>
              <input className="input" placeholder="e.g. Backend API, Website Redesign" value={form.project} onChange={e => setForm({...form, project: e.target.value})} />
            </div>
            <div>
              <label className="label">Description</label>
              <textarea className="input" rows={3} placeholder="What did you work on today?" value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="submit" className="btn-primary flex-1">{editing ? 'Save Changes' : 'Log Hours'}</button>
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
