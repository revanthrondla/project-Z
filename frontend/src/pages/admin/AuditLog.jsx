/**
 * Audit Log Viewer — SOC 2 CC7.2
 * Admin-only view of the tamper-resistant master security_audit_logs.
 * Filterable by table, action, user, and date range. Paginates 50 per page.
 */
import { useState, useEffect, useCallback } from 'react';
import api from '../../api';

const ACTION_COLORS = {
  create: 'bg-green-100 text-green-700',
  update: 'bg-blue-100 text-blue-700',
  delete: 'bg-red-100 text-red-700',
  purge:  'bg-purple-100 text-purple-700',
  login:  'bg-indigo-100 text-indigo-700',
  logout: 'bg-gray-100 text-gray-600',
};

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function JsonModal({ title, data, onClose }) {
  if (!data) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <pre className="p-5 overflow-auto max-h-[60vh] text-xs text-gray-700 bg-gray-50 font-mono">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    </div>
  );
}

export default function AuditLog() {
  const [logs,    setLogs]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [modal,   setModal]   = useState(null); // { title, data }

  const [filters, setFilters] = useState({
    table_name: '', action: '', user_id: '', from: '', to: '',
  });
  const [page, setPage] = useState(0);
  const LIMIT = 50;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = { limit: LIMIT, offset: page * LIMIT };
      if (filters.table_name) params.table_name = filters.table_name;
      if (filters.action)     params.action     = filters.action;
      if (filters.user_id)    params.user_id    = filters.user_id;
      if (filters.from)       params.from       = filters.from;
      if (filters.to)         params.to         = filters.to;
      const r = await api.get('/audit-logs', { params });
      setLogs(r.data.logs || []);
      setTotal(r.data.total || 0);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  const applyFilter = e => {
    e.preventDefault();
    setPage(0);
    load();
  };

  const clearFilters = () => {
    setFilters({ table_name: '', action: '', user_id: '', from: '', to: '' });
    setPage(0);
  };

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {modal && <JsonModal title={modal.title} data={modal.data} onClose={() => setModal(null)} />}

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
        <p className="text-sm text-gray-500 mt-1">
          SOC 2 CC7.2 — Tamper-resistant activity log. {total.toLocaleString()} total events.
        </p>
      </div>

      {/* Filters */}
      <form onSubmit={applyFilter} className="bg-white rounded-xl border border-gray-200 p-4 mb-4 shadow-sm">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Table / Entity</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="e.g. employees"
              value={filters.table_name}
              onChange={e => setFilters(f => ({ ...f, table_name: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Action</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
              value={filters.action}
              onChange={e => setFilters(f => ({ ...f, action: e.target.value }))}
            >
              <option value="">All</option>
              <option value="create">Create</option>
              <option value="update">Update</option>
              <option value="delete">Delete</option>
              <option value="purge">Purge</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">User ID</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
              placeholder="User ID"
              type="number"
              value={filters.user_id}
              onChange={e => setFilters(f => ({ ...f, user_id: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
            <input
              type="date"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
              value={filters.from}
              onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
            <input
              type="date"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
              value={filters.to}
              onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
            />
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button type="submit" className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 font-medium">
            Apply Filters
          </button>
          <button type="button" onClick={clearFilters} className="px-4 py-2 text-gray-600 text-sm rounded-lg border border-gray-300 hover:bg-gray-50">
            Clear
          </button>
        </div>
      </form>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{error}</div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-12 text-center text-gray-400">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Table</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Record ID</th>
                <th className="px-4 py-3">Changed By</th>
                <th className="px-4 py-3">IP</th>
                <th className="px-4 py-3">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">No audit events match your filters</td></tr>
              )}
              {logs.map(log => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">{fmtDate(log.changed_at)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{log.table_name}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_COLORS[log.action] || 'bg-gray-100 text-gray-600'}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{log.record_id || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {log.changed_by || '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 font-mono">{log.ip_address || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {log.old_values && (
                        <button
                          onClick={() => setModal({ title: `Before — ${log.table_name} #${log.record_id}`, data: log.old_values })}
                          className="px-2 py-0.5 text-xs bg-amber-50 text-amber-700 rounded border border-amber-200 hover:bg-amber-100"
                        >
                          Before
                        </button>
                      )}
                      {log.new_values && (
                        <button
                          onClick={() => setModal({ title: `After — ${log.table_name} #${log.record_id}`, data: log.new_values })}
                          className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded border border-blue-200 hover:bg-blue-100"
                        >
                          After
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500">
            Showing {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total.toLocaleString()} events
          </p>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
            >
              ← Previous
            </button>
            <span className="px-3 py-1.5 text-sm text-gray-600">
              Page {page + 1} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
