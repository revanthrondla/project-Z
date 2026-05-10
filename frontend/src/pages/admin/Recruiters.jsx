import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';

const MARKET_LABELS = {
  employed:               { label: 'Employed',           color: 'bg-gray-100 text-gray-600' },
  in_market:              { label: 'In Market',          color: 'bg-green-100 text-green-700' },
  about_to_be_in_market:  { label: 'Available Soon',     color: 'bg-amber-100 text-amber-700' },
};

function MarketBadge({ status }) {
  const cfg = MARKET_LABELS[status] || MARKET_LABELS.employed;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function Banner({ type, message, onClose }) {
  if (!message) return null;
  const styles = { error: 'bg-red-50 text-red-700 border-red-200', success: 'bg-green-50 text-green-700 border-green-200' };
  return (
    <div className={`flex items-center gap-2 p-3 rounded-lg border text-sm mb-4 ${styles[type]}`}>
      <span className="flex-1">{message}</span>
      {onClose && <button onClick={onClose} className="shrink-0 text-gray-400 hover:text-gray-600">✕</button>}
    </div>
  );
}

export default function Recruiters() {
  const [recruiters, setRecruiters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Add recruiter modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', email: '', password: '' });
  const [addLoading, setAddLoading] = useState(false);

  // Assignments panel state
  const [selectedRecruiter, setSelectedRecruiter] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [availableCandidates, setAvailableCandidates] = useState([]);
  const [assignCandidateId, setAssignCandidateId] = useState('');
  const [assignNotes, setAssignNotes] = useState('');
  const [assignLoading, setAssignLoading] = useState(false);

  const fetchRecruiters = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/api/recruiters');
      setRecruiters(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load recruiters');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRecruiters(); }, [fetchRecruiters]);

  const handleAddRecruiter = async (e) => {
    e.preventDefault();
    setAddLoading(true);
    setError('');
    try {
      await api.post('/api/recruiters', addForm);
      setSuccess('Recruiter created successfully');
      setShowAddModal(false);
      setAddForm({ name: '', email: '', password: '' });
      fetchRecruiters();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create recruiter');
    } finally {
      setAddLoading(false);
    }
  };

  const openAssignments = async (recruiter) => {
    setSelectedRecruiter(recruiter);
    setAssignCandidateId('');
    setAssignNotes('');
    try {
      const [assignRes, candRes] = await Promise.all([
        api.get(`/api/recruiters/${recruiter.id}/assignments`),
        api.get('/api/employees'),
      ]);
      setAssignments(assignRes.data);
      // Only show candidates who are in market or about to be (and not already assigned)
      const assignedIds = new Set(assignRes.data.map(a => a.id));
      setAvailableCandidates(
        candRes.data.filter(c =>
          ['in_market', 'about_to_be_in_market'].includes(c.market_status) &&
          !assignedIds.has(c.id)
        )
      );
    } catch (err) {
      setError('Failed to load assignments');
    }
  };

  const handleAssign = async () => {
    if (!assignCandidateId) return;
    setAssignLoading(true);
    try {
      await api.post(`/api/recruiters/${selectedRecruiter.id}/assignments`, {
        employeeId: parseInt(assignCandidateId),
        notes: assignNotes,
      });
      setSuccess('Candidate assigned');
      setTimeout(() => setSuccess(''), 2000);
      openAssignments(selectedRecruiter); // refresh
      setAssignCandidateId('');
      setAssignNotes('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to assign candidate');
    } finally {
      setAssignLoading(false);
    }
  };

  const handleUnassign = async (employeeId) => {
    try {
      await api.delete(`/api/recruiters/${selectedRecruiter.id}/assignments/${employeeId}`);
      openAssignments(selectedRecruiter);
    } catch (err) {
      setError('Failed to remove assignment');
    }
  };

  const handleDelete = async (recruiter) => {
    if (!window.confirm(`Remove recruiter ${recruiter.name}? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/recruiters/${recruiter.id}`);
      setSuccess('Recruiter removed');
      if (selectedRecruiter?.id === recruiter.id) setSelectedRecruiter(null);
      fetchRecruiters();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove recruiter');
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Recruiters</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage your recruiting team and their candidate assignments</p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="btn-primary">
          + Add Recruiter
        </button>
      </div>

      <Banner type="error" message={error} onClose={() => setError('')} />
      <Banner type="success" message={success} />

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
        </div>
      ) : recruiters.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">🕵️</div>
          <p className="text-sm">No recruiters yet. Add your first recruiter to get started.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Assignments</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recruiters.map(rec => (
                <tr key={rec.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{rec.name}</td>
                  <td className="px-4 py-3 text-gray-600">{rec.user_email}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                      {rec.assignment_count} candidates
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openAssignments(rec)}
                        className="btn-secondary text-xs py-1.5 px-3"
                      >
                        Manage Assignments
                      </button>
                      <button
                        onClick={() => handleDelete(rec)}
                        className="text-red-500 hover:text-red-700 text-xs py-1.5 px-3 rounded-lg hover:bg-red-50 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Recruiter Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Add Recruiter</h2>
            <form onSubmit={handleAddRecruiter} className="space-y-4">
              <div>
                <label className="label">Full Name</label>
                <input
                  className="input"
                  placeholder="Jane Smith"
                  value={addForm.name}
                  onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="label">Email</label>
                <input
                  type="email"
                  className="input"
                  placeholder="jane@yourcompany.com"
                  value={addForm.email}
                  onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="label">Temporary Password</label>
                <input
                  type="password"
                  className="input"
                  placeholder="Min 8 characters"
                  value={addForm.password}
                  onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))}
                  required
                  minLength={8}
                />
                <p className="text-xs text-gray-500 mt-1">The recruiter will be prompted to change this on first login.</p>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 btn-secondary">Cancel</button>
                <button type="submit" disabled={addLoading} className="flex-1 btn-primary">
                  {addLoading ? 'Creating…' : 'Create Recruiter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assignments Panel (slide-over) */}
      {selectedRecruiter && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={() => setSelectedRecruiter(null)} />
          <div className="w-full max-w-lg bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Assignments</h2>
                <p className="text-sm text-gray-500">{selectedRecruiter.name}</p>
              </div>
              <button onClick={() => setSelectedRecruiter(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Assign new candidate */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-800 mb-3">Assign a Candidate</h3>
                {availableCandidates.length === 0 ? (
                  <p className="text-xs text-gray-500">No unassigned in-market candidates available.</p>
                ) : (
                  <div className="space-y-2">
                    <select
                      className="input text-sm"
                      value={assignCandidateId}
                      onChange={e => setAssignCandidateId(e.target.value)}
                    >
                      <option value="">Select a candidate…</option>
                      {availableCandidates.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name} — {c.market_status === 'in_market' ? 'In Market' : 'Available Soon'}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input text-sm"
                      placeholder="Notes (optional)"
                      value={assignNotes}
                      onChange={e => setAssignNotes(e.target.value)}
                    />
                    <button
                      onClick={handleAssign}
                      disabled={!assignCandidateId || assignLoading}
                      className="btn-primary text-sm py-2 w-full"
                    >
                      {assignLoading ? 'Assigning…' : 'Assign Candidate'}
                    </button>
                  </div>
                )}
              </div>

              {/* Current assignments */}
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-3">
                  Current Assignments ({assignments.length})
                </h3>
                {assignments.length === 0 ? (
                  <p className="text-xs text-gray-500">No employees assigned yet.</p>
                ) : (
                  <div className="space-y-2">
                    {assignments.map(cand => (
                      <div key={cand.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{cand.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-gray-500">{cand.role || cand.job_title}</span>
                            <MarketBadge status={cand.market_status} />
                          </div>
                        </div>
                        <button
                          onClick={() => handleUnassign(cand.id)}
                          className="text-red-500 hover:text-red-700 text-xs px-2 py-1 rounded hover:bg-red-50"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
