import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900 text-lg">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

const EMPTY_FORM = { name: '', email: '', phone: '', role: '', hourly_rate: '', client_id: '', start_date: '', end_date: '', status: 'active', contract_type: 'contractor', password: 'candidate123' };

export default function AdminCandidates() {
  const [candidates, setCandidates] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  const load = () => {
    Promise.all([api.get('/api/candidates'), api.get('/api/clients')])
      .then(([c, cl]) => { setCandidates(c.data); setClients(cl.data); })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setError(''); setShowModal(true); };
  const openEdit = (c) => { setEditing(c); setForm({ ...c, password: '' }); setError(''); setShowModal(true); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (editing) {
        await api.put(`/api/candidates/${editing.id}`, form);
      } else {
        await api.post('/api/candidates', form);
      }
      setShowModal(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this candidate? This cannot be undone.')) return;
    try {
      await api.delete(`/api/candidates/${id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed');
    }
  };

  const filtered = candidates.filter(c => {
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.email.toLowerCase().includes(search.toLowerCase()) || c.role.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'all' || c.status === filterStatus;
    return matchSearch && matchStatus;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
          <p className="text-gray-500 mt-1">{candidates.length} total employees</p>
        </div>
        <button onClick={openCreate} className="btn-primary">+ Add Employee</button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input className="input max-w-xs" placeholder="Search name, email, role..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input max-w-[160px]" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="pending">Pending</option>
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-2">👥</div>
            <p>No employees found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Employee</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Role</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Client</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Rate</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Type</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Start Date</th>
                <th className="text-right px-4 py-3 text-gray-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-emerald-700 font-semibold text-sm">{c.name[0]}</div>
                      <div>
                        <Link to={`/employees/${c.id}`} className="font-medium text-gray-900 hover:text-green-700 hover:underline">{c.name}</Link>
                        <p className="text-xs text-gray-400">{c.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{c.role}</td>
                  <td className="px-4 py-3 text-gray-500">{c.client_name || '—'}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">${c.hourly_rate}/hr</td>
                  <td className="px-4 py-3 text-gray-500 capitalize">{c.contract_type}</td>
                  <td className="px-4 py-3"><span className={`badge-${c.status}`}>{c.status}</span></td>
                  <td className="px-4 py-3 text-gray-500">{c.start_date || '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link to={`/employees/${c.id}`} className="text-green-600 hover:underline text-xs font-medium">Profile</Link>
                      <button onClick={() => openEdit(c)} className="text-emerald-600 hover:underline text-xs">Edit</button>
                      <button onClick={() => handleDelete(c.id)} className="text-red-500 hover:underline text-xs">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <Modal title={editing ? 'Edit Employee' : 'Add Employee'} onClose={() => setShowModal(false)}>
          {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="label">Full Name *</label>
                <input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />
              </div>
              <div>
                <label className="label">Email *</label>
                <input type="email" className="input" value={form.email} onChange={e => setForm({...form, email: e.target.value})} required disabled={!!editing} />
              </div>
              <div>
                <label className="label">Phone</label>
                <input className="input" value={form.phone || ''} onChange={e => setForm({...form, phone: e.target.value})} />
              </div>
              <div>
                <label className="label">Role / Title *</label>
                <input className="input" placeholder="e.g. Senior Developer" value={form.role} onChange={e => setForm({...form, role: e.target.value})} required />
              </div>
              <div>
                <label className="label">Hourly Rate (USD) *</label>
                <input type="number" min="0" step="0.01" className="input" value={form.hourly_rate} onChange={e => setForm({...form, hourly_rate: e.target.value})} required />
              </div>
              <div>
                <label className="label">Client</label>
                <select className="input" value={form.client_id || ''} onChange={e => setForm({...form, client_id: e.target.value})}>
                  <option value="">No client assigned</option>
                  {clients.map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Contract Type</label>
                <select className="input" value={form.contract_type} onChange={e => setForm({...form, contract_type: e.target.value})}>
                  <option value="contractor">Contractor</option>
                  <option value="employee">Employee</option>
                  <option value="part-time">Part-time</option>
                </select>
              </div>
              <div>
                <label className="label">Start Date</label>
                <input type="date" className="input" value={form.start_date || ''} onChange={e => setForm({...form, start_date: e.target.value})} />
              </div>
              <div>
                <label className="label">End Date</label>
                <input type="date" className="input" value={form.end_date || ''} onChange={e => setForm({...form, end_date: e.target.value})} />
              </div>
              <div>
                <label className="label">Status</label>
                <select className="input" value={form.status} onChange={e => setForm({...form, status: e.target.value})}>
                  <option value="active">Active</option>
                  <option value="pending">Pending</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              {!editing && (
                <div className="col-span-2">
                  <label className="label">Initial Password</label>
                  <input type="password" className="input" value={form.password} onChange={e => setForm({...form, password: e.target.value})} placeholder="Default: candidate123" />
                </div>
              )}
            </div>
            <div className="flex gap-3 pt-2">
              <button type="submit" className="btn-primary flex-1">{editing ? 'Save Changes' : 'Add Employee'}</button>
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
