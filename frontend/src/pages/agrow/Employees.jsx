import React, { useState, useEffect } from 'react';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900 text-lg">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

const EMPTY = {
  employee_name:'', employee_number:'', crew_name:'', entity_name:'',
  ranch:'', badge_number:'', email:'', gender:'', start_date:'', end_date:'',
};

export default function Employees() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [editing, setEditing]     = useState(null);
  const [form, setForm]           = useState(EMPTY);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  const load = () => {
    setLoading(true);
    const params = search ? `?search=${encodeURIComponent(search)}` : '';
    api.get(`/api/agrow/employees${params}`)
      .then(r => setEmployees(r.data))
      .catch(() => setError('Failed to load employees'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [search]);

  const openNew  = () => { setEditing('new'); setForm(EMPTY); setError(''); };
  const openEdit = (emp) => {
    setEditing(emp.id);
    setForm({
      employee_name:   emp.employee_name   || '',
      employee_number: emp.employee_number || '',
      crew_name:       emp.crew_name       || '',
      entity_name:     emp.entity_name     || '',
      ranch:           emp.ranch           || '',
      badge_number:    emp.badge_number    || '',
      email:           emp.email           || '',
      gender:          emp.gender          || '',
      start_date:      emp.start_date      || '',
      end_date:        emp.end_date        || '',
    });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editing === 'new') {
        await api.post('/api/agrow/employees', form);
      } else {
        await api.put(`/api/agrow/employees/${editing}`, form);
      }
      setEditing(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this employee?')) return;
    await api.delete(`/api/agrow/employees/${id}`);
    load();
  };

  const field = (k, v) => setForm(f => ({...f, [k]: v}));
  const crews = [...new Set(employees.map(e => e.crew_name).filter(Boolean))];

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600"/></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
          <p className="text-gray-500 mt-1">Field workers and crew members</p>
        </div>
        {user?.role === 'admin' && (
          <button onClick={openNew} className="btn-primary">+ Add Employee</button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Employees', value: employees.length },
          { label: 'Crews',           value: crews.length },
          { label: 'Active',          value: employees.filter(e => !e.end_date || new Date(e.end_date) >= new Date()).length },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{k.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          className="input w-72"
          placeholder="Search name or employee number…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Number</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Crew</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Ranch</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Email</th>
              <th className="px-4 py-3"/>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {employees.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-10 text-gray-400">No employees found</td></tr>
            ) : employees.map(emp => (
              <tr key={emp.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{emp.employee_name}</td>
                <td className="px-4 py-3 font-mono text-gray-500">{emp.employee_number}</td>
                <td className="px-4 py-3 text-gray-500">{emp.crew_name || '—'}</td>
                <td className="px-4 py-3 text-gray-500">{emp.ranch || '—'}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">{emp.email || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2 justify-end">
                    {user?.role === 'admin' && (
                      <>
                        <button onClick={() => openEdit(emp)} className="text-xs text-blue-500 hover:text-emerald-700">Edit</button>
                        <button onClick={() => handleDelete(emp.id)} className="text-xs text-red-400 hover:text-red-600">Remove</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing !== null && (
        <Modal
          title={editing === 'new' ? 'Add Employee' : 'Edit Employee'}
          onClose={() => setEditing(null)}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Name *</label>
                <input type="text" className="input" required value={form.employee_name} onChange={e => field('employee_name', e.target.value)} />
              </div>
              <div>
                <label className="label">Employee # *</label>
                <input type="text" className="input" required value={form.employee_number} onChange={e => field('employee_number', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Crew</label>
                <input type="text" className="input" value={form.crew_name} onChange={e => field('crew_name', e.target.value)} />
              </div>
              <div>
                <label className="label">Entity</label>
                <input type="text" className="input" value={form.entity_name} onChange={e => field('entity_name', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Ranch</label>
                <input type="text" className="input" value={form.ranch} onChange={e => field('ranch', e.target.value)} />
              </div>
              <div>
                <label className="label">Badge #</label>
                <input type="text" className="input" value={form.badge_number} onChange={e => field('badge_number', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Email</label>
                <input type="email" className="input" value={form.email} onChange={e => field('email', e.target.value)} />
              </div>
              <div>
                <label className="label">Gender</label>
                <select className="input" value={form.gender} onChange={e => field('gender', e.target.value)}>
                  <option value="">Not specified</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Start Date</label>
                <input type="date" className="input" value={form.start_date} onChange={e => field('start_date', e.target.value)} />
              </div>
              <div>
                <label className="label">End Date</label>
                <input type="date" className="input" value={form.end_date} onChange={e => field('end_date', e.target.value)} />
              </div>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
