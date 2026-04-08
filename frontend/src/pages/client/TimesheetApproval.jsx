/**
 * Client Timesheet Approval
 * Clients can review timesheets that have been admin-approved
 * and give their own approval or rejection with a note.
 */
import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';

const STATUS_COLORS = {
  approved:  'bg-green-100 text-green-700',
  rejected:  'bg-red-100 text-red-700',
  pending:   'bg-amber-100 text-amber-700',
};

function RejectModal({ entry, onClose, onRejected }) {
  const [note, setNote]   = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!note.trim()) { setError('A reason is required when rejecting.'); return; }
    setSaving(true);
    try {
      await api.post(`/api/time-entries/${entry.id}/client-reject`, { note: note.trim() });
      onRejected();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to reject entry');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900">Reject Timesheet</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          <div className="bg-gray-50 rounded-lg p-3 text-sm">
            <p className="font-medium text-gray-800">{entry.candidate_name}</p>
            <p className="text-gray-500">{entry.date} · {entry.hours} hrs</p>
            {entry.description && <p className="text-gray-400 text-xs mt-1">{entry.description}</p>}
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
          <div>
            <label className="text-sm text-gray-700 font-medium block mb-1">Reason for rejection *</label>
            <textarea
              rows={3}
              className="input w-full text-sm"
              placeholder="Please explain why this timesheet is being rejected…"
              value={note}
              onChange={e => setNote(e.target.value)}
              required
            />
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2 px-4 rounded-lg transition-colors disabled:opacity-50">
              {saving ? 'Rejecting…' : '✕ Reject'}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ClientTimesheetApproval() {
  const [entries, setEntries]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [rejectTarget, setRejectTarget] = useState(null);
  const [approving, setApproving] = useState(null);
  const [filter, setFilter]       = useState('pending');
  const [search, setSearch]       = useState('');

  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 });

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.get('/api/time-entries/client-pending')
      .then(r => {
        const all = Array.isArray(r.data) ? r.data : [];
        setEntries(all);
        setStats({
          total:    all.length,
          pending:  all.filter(e => !e.client_approval_status || e.client_approval_status === 'pending').length,
          approved: all.filter(e => e.client_approval_status === 'approved').length,
          rejected: all.filter(e => e.client_approval_status === 'rejected').length,
        });
      })
      .catch(() => setError('Failed to load timesheets'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const approve = async (entry) => {
    setApproving(entry.id);
    try {
      await api.post(`/api/time-entries/${entry.id}/client-approve`, { note: '' });
      load();
    } catch { /* ignore */ } finally {
      setApproving(null);
    }
  };

  const fmtHours = h => `${Number(h).toFixed(1)}h`;

  const filtered = entries.filter(e => {
    const statusMatch = filter === 'all'
      ? true
      : filter === 'pending'
        ? (!e.client_approval_status || e.client_approval_status === 'pending')
        : e.client_approval_status === filter;
    const searchMatch = !search || e.candidate_name.toLowerCase().includes(search.toLowerCase());
    return statusMatch && searchMatch;
  });

  // Group by candidate for a cleaner UI
  const grouped = filtered.reduce((acc, e) => {
    (acc[e.candidate_name] = acc[e.candidate_name] || []).push(e);
    return acc;
  }, {});

  const approvalStatus = (e) => {
    if (!e.client_approval_status || e.client_approval_status === 'pending') return 'pending';
    return e.client_approval_status;
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Timesheet Approvals</h1>
          <p className="text-sm text-gray-500 mt-0.5">Review and approve timesheets submitted by your team</p>
        </div>
        <button onClick={load} className="btn-secondary text-sm py-2">↻ Refresh</button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Entries',    value: stats.total,    color: 'text-gray-800', icon: '📋' },
          { label: 'Awaiting Review',  value: stats.pending,  color: 'text-amber-600', icon: '⏳' },
          { label: 'Approved',         value: stats.approved, color: 'text-green-600', icon: '✅' },
          { label: 'Rejected',         value: stats.rejected, color: 'text-red-600',   icon: '✕' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{k.label}</p>
                <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
              </div>
              <span className="text-xl">{k.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

      {/* Filters */}
      <div className="flex gap-3 mb-5 flex-wrap items-center">
        <input
          type="text"
          className="input w-52 text-sm"
          placeholder="Search candidate…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {['pending', 'approved', 'rejected', 'all'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm border capitalize transition-colors ${
              filter === f ? 'bg-green-600 text-white border-green-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'
            }`}
          >
            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600" />
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-20 text-center text-gray-400">
          <p className="text-4xl mb-3">✅</p>
          <p className="font-medium text-gray-600">No timesheets to review</p>
          <p className="text-sm mt-1">
            {filter === 'pending' ? 'All caught up — no pending timesheets.' : 'No timesheets match this filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([candidateName, candEntries]) => {
            const totalHours = candEntries.reduce((s, e) => s + Number(e.hours), 0);
            return (
              <div key={candidateName} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Candidate header */}
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center font-bold text-green-700 text-sm">
                      {candidateName[0]}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-800 text-sm">{candidateName}</p>
                      <p className="text-xs text-gray-400">{candEntries.length} entries · {totalHours.toFixed(1)}h total</p>
                    </div>
                  </div>
                  {/* Bulk approve all pending for this candidate */}
                  {candEntries.some(e => approvalStatus(e) === 'pending') && (
                    <button
                      onClick={async () => {
                        const pending = candEntries.filter(e => approvalStatus(e) === 'pending');
                        for (const e of pending) await approve(e);
                      }}
                      className="text-xs text-green-600 border border-green-200 hover:bg-green-50 px-3 py-1 rounded-lg font-medium transition-colors"
                    >
                      ✅ Approve All
                    </button>
                  )}
                </div>

                {/* Entries */}
                <div className="divide-y divide-gray-50">
                  {candEntries.map(entry => {
                    const st = approvalStatus(entry);
                    return (
                      <div key={entry.id} className="px-4 py-3 flex items-center gap-4 hover:bg-gray-50 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3">
                            <p className="text-sm font-medium text-gray-800">{entry.date}</p>
                            <span className="text-sm font-bold text-emerald-700">{fmtHours(entry.hours)}</span>
                            {entry.project && (
                              <span className="text-xs bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">{entry.project}</span>
                            )}
                          </div>
                          {entry.description && (
                            <p className="text-xs text-gray-400 mt-0.5 truncate">{entry.description}</p>
                          )}
                          {entry.client_approval_note && (
                            <p className="text-xs text-red-500 mt-0.5 italic">Note: {entry.client_approval_note}</p>
                          )}
                        </div>

                        {/* Status badge */}
                        <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_COLORS[st] || STATUS_COLORS.pending}`}>
                          {st === 'pending' ? '⏳ Pending' : st === 'approved' ? '✅ Approved' : '✕ Rejected'}
                        </span>

                        {/* Actions — only for pending */}
                        {st === 'pending' && (
                          <div className="flex gap-2 shrink-0">
                            <button
                              onClick={() => approve(entry)}
                              disabled={approving === entry.id}
                              className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
                            >
                              {approving === entry.id ? '…' : '✅ Approve'}
                            </button>
                            <button
                              onClick={() => setRejectTarget(entry)}
                              className="text-xs bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-1.5 rounded-lg font-medium transition-colors"
                            >
                              ✕ Reject
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reject modal */}
      {rejectTarget && (
        <RejectModal
          entry={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onRejected={load}
        />
      )}
    </div>
  );
}
