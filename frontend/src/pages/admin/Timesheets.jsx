import React, { useState, useEffect } from 'react';
import api from '../../api';

function StatusBadge({ status }) {
  return <span className={`badge-${status}`}>{status}</span>;
}

export default function AdminTimesheets() {
  const [entries, setEntries] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ candidate_id: '', status: '', month: '' });
  const [error, setError] = useState('');
  const [selected, setSelected] = useState([]);
  const [processing, setProcessing] = useState(false);

  const currentMonth = new Date().toISOString().slice(0, 7);

  const load = () => {
    setError('');
    const params = {};
    if (filters.candidate_id) params.candidate_id = filters.candidate_id;
    if (filters.status) params.status = filters.status;
    if (filters.month) params.month = filters.month;
    return api.get('/api/time-entries', { params })
      .then(r => setEntries(r.data))
      .catch(() => setError('Failed to load timesheets. Is the server running?'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    api.get('/api/candidates').then(r => setCandidates(r.data));
  }, []);

  useEffect(() => { load(); }, [filters]);

  const handleApprove = async (id) => {
    await api.put(`/api/time-entries/${id}`, { status: 'approved' });
    load();
  };

  const handleReject = async (id) => {
    await api.put(`/api/time-entries/${id}`, { status: 'rejected' });
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

  const totalHours = entries.reduce((s, e) => s + e.hours, 0);
  const totalAmount = entries.reduce((s, e) => s + e.hours * (e.hourly_rate || 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Timesheets</h1>
          <p className="text-gray-500 mt-1">{entries.length} entries · {totalHours.toFixed(1)}h · ${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
        </div>
        {selected.length > 0 && (
          <div className="flex gap-2 items-center">
            <span className="text-sm text-gray-500">{selected.length} selected</span>
            <button onClick={() => handleBulkAction('approved')} disabled={processing} className="btn-success text-sm py-1.5">Approve All</button>
            <button onClick={() => handleBulkAction('rejected')} disabled={processing} className="btn-danger text-sm py-1.5">Reject All</button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select className="input max-w-[200px]" value={filters.candidate_id} onChange={e => setFilters({...filters, candidate_id: e.target.value})}>
          <option value="">All Employees</option>
          {candidates.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input max-w-[160px]" value={filters.status} onChange={e => setFilters({...filters, status: e.target.value})}>
          <option value="">All Status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <input type="month" className="input max-w-[180px]" value={filters.month} onChange={e => setFilters({...filters, month: e.target.value})} placeholder="Filter by month" />
        <button onClick={() => setFilters({ candidate_id: '', status: '', month: '' })} className="btn-secondary text-sm">Reset</button>
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
          <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>
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
                  <input type="checkbox" onChange={toggleAll} checked={selected.length > 0 && selected.length === entries.filter(e => e.status === 'pending').length} className="rounded" />
                </th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Employee</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Date</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Hours</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Project</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Description</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Amount</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
                <th className="text-right px-4 py-3 text-gray-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {entries.map(e => (
                <tr key={e.id} className={`hover:bg-gray-50 ${selected.includes(e.id) ? 'bg-blue-50' : ''}`}>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.includes(e.id)}
                      onChange={() => toggleSelect(e.id)}
                      disabled={e.status !== 'pending'}
                      className="rounded"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{e.candidate_name}</p>
                    <p className="text-xs text-gray-400">${e.hourly_rate}/hr</p>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{e.date}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{e.hours}h</td>
                  <td className="px-4 py-3 text-gray-600">{e.project || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">{e.description || '—'}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">${(e.hours * (e.hourly_rate || 0)).toFixed(2)}</td>
                  <td className="px-4 py-3"><StatusBadge status={e.status} /></td>
                  <td className="px-4 py-3 text-right">
                    {e.status === 'pending' && (
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => handleApprove(e.id)} className="text-green-600 hover:underline text-xs font-medium">Approve</button>
                        <button onClick={() => handleReject(e.id)} className="text-red-500 hover:underline text-xs">Reject</button>
                      </div>
                    )}
                    {e.status !== 'pending' && <span className="text-xs text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t border-gray-100">
              <tr>
                <td colSpan={3} className="px-4 py-3 text-sm font-medium text-gray-700">Totals</td>
                <td className="px-4 py-3 font-bold text-gray-900">{totalHours.toFixed(1)}h</td>
                <td colSpan={2} />
                <td className="px-4 py-3 font-bold text-gray-900">${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
