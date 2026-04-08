import React, { useState, useEffect } from 'react';
import api from '../../api';

const ABSENCE_TYPES = { vacation: '🌴 Vacation', sick: '🤒 Sick', personal: '👤 Personal', public_holiday: '🎉 Public Holiday', other: '📌 Other' };

function daysBetween(start, end) {
  const a = new Date(start), b = new Date(end);
  return Math.round((b - a) / (1000 * 60 * 60 * 24)) + 1;
}

export default function AdminAbsences() {
  const [absences, setAbsences] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ candidate_id: '', status: '', year: '' });

  const [error, setError] = useState('');

  const load = () => {
    setError('');
    const params = {};
    if (filters.candidate_id) params.candidate_id = filters.candidate_id;
    if (filters.status) params.status = filters.status;
    if (filters.year) params.year = filters.year;
    return api.get('/api/absences', { params })
      .then(r => setAbsences(r.data))
      .catch(() => setError('Failed to load absences. Is the server running?'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { api.get('/api/candidates').then(r => setCandidates(r.data)); }, []);
  useEffect(() => { load(); }, [filters]);

  const approve = async (id) => { await api.put(`/api/absences/${id}`, { status: 'approved' }); load(); };
  const reject = async (id) => { await api.put(`/api/absences/${id}`, { status: 'rejected' }); load(); };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Absence Management</h1>
        <p className="text-gray-500 mt-1">{absences.length} records found</p>
      </div>

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
        <input type="number" placeholder="Year (e.g. 2026)" className="input max-w-[160px]" value={filters.year} onChange={e => setFilters({...filters, year: e.target.value})} />
        <button onClick={() => setFilters({ candidate_id: '', status: '', year: '' })} className="btn-secondary text-sm">Reset</button>
      </div>

      <div className="card overflow-hidden">
        {error ? (
          <div className="text-center py-16 text-red-500">
            <div className="text-4xl mb-2">⚠️</div>
            <p>{error}</p>
            <button onClick={load} className="mt-3 btn-primary text-sm">Retry</button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div></div>
        ) : absences.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-2">🏖️</div>
            <p>No absences found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Employee</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Type</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Period</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Days</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Notes</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
                <th className="text-right px-4 py-3 text-gray-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {absences.map(a => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center text-emerald-700 font-semibold text-xs">{a.candidate_name[0]}</div>
                      <span className="font-medium text-gray-900">{a.candidate_name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{ABSENCE_TYPES[a.type] || a.type}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {a.start_date === a.end_date ? a.start_date : `${a.start_date} → ${a.end_date}`}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">{daysBetween(a.start_date, a.end_date)}d</td>
                  <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">{a.notes || '—'}</td>
                  <td className="px-4 py-3"><span className={`badge-${a.status}`}>{a.status}</span></td>
                  <td className="px-4 py-3 text-right">
                    {a.status === 'pending' ? (
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => approve(a.id)} className="text-green-600 hover:underline text-xs font-medium">Approve</button>
                        <button onClick={() => reject(a.id)} className="text-red-500 hover:underline text-xs">Reject</button>
                      </div>
                    ) : <span className="text-xs text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
