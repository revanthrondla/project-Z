/**
 * SupportDashboard.jsx — Tenant Admin support management
 * View all employee/client tickets, reply, update status/priority
 */
import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';

const STATUS_COLORS = {
  open:        'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  resolved:    'bg-green-100 text-green-700',
  closed:      'bg-gray-100 text-gray-500',
};
const PRIORITY_COLORS = {
  low:    'bg-gray-100 text-gray-500',
  medium: 'bg-blue-100 text-blue-700',
  high:   'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
};
const ROLE_ICONS = { candidate: '👤', client: '🏢', admin: '👑' };

function Badge({ label, colorClass }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>{label}</span>;
}

function KpiCard({ label, value, icon, color = 'text-gray-800' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 flex items-center gap-4">
      <span className="text-2xl">{icon}</span>
      <div>
        <p className={`text-2xl font-bold ${color}`}>{value ?? 0}</p>
        <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function TicketDetailPanel({ ticketId, onClose, onUpdated }) {
  const [ticket, setTicket] = useState(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [updating, setUpdating] = useState(false);

  const load = useCallback(async () => {
    const res = await api.get(`/api/support/tickets/${ticketId}`);
    setTicket(res.data);
  }, [ticketId]);

  useEffect(() => { load(); }, [load]);

  const sendReply = async e => {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    try {
      await api.post(`/api/support/tickets/${ticketId}/messages`, { message: reply });
      setReply('');
      await load();
      onUpdated();
    } finally {
      setSending(false);
    }
  };

  const update = async (field, value) => {
    setUpdating(true);
    try {
      await api.put(`/api/support/tickets/${ticketId}`, { [field]: value });
      await load();
      onUpdated();
    } finally {
      setUpdating(false);
    }
  };

  if (!ticket) return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-8 text-gray-400">Loading…</div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-800">{ticket.subject}</h2>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-xs text-gray-500">
                {ROLE_ICONS[ticket.submitter_role]} {ticket.submitter_name} ({ticket.submitter_email})
              </span>
              <span className="text-xs text-gray-400">#{ticket.id} · {new Date(ticket.created_at).toLocaleDateString()}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none ml-4">×</button>
        </div>

        {/* Controls */}
        <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">Status:</span>
            <select
              value={ticket.status}
              onChange={e => update('status', e.target.value)}
              disabled={updating}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white"
            >
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">Priority:</span>
            <select
              value={ticket.priority}
              onChange={e => update('priority', e.target.value)}
              disabled={updating}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
        </div>

        {/* Thread */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="bg-blue-50 rounded-xl p-4">
            <p className="text-xs text-blue-500 font-medium mb-1.5">
              {ROLE_ICONS[ticket.submitter_role]} {ticket.submitter_name} — original message
            </p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{ticket.description}</p>
          </div>
          {(ticket.messages || []).map(m => (
            <div key={m.id} className={`rounded-xl p-4 ${m.is_staff ? 'bg-indigo-50 ml-4' : 'bg-gray-50 mr-4'}`}>
              <p className="text-xs font-medium mb-1.5 text-gray-500">
                {m.is_staff ? '🛟 Support Team (you)' : `${ROLE_ICONS[m.sender_role] || '👤'} ${m.sender_name}`}
                <span className="ml-2 text-gray-400 font-normal">{new Date(m.created_at).toLocaleString()}</span>
              </p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{m.message}</p>
            </div>
          ))}
        </div>

        {/* Reply */}
        <form onSubmit={sendReply} className="border-t border-gray-100 p-4 shrink-0 flex gap-3">
          <textarea
            className="input flex-1 resize-none min-h-[60px] text-sm"
            placeholder="Reply to this ticket…"
            value={reply}
            onChange={e => setReply(e.target.value)}
          />
          <button type="submit" disabled={sending || !reply.trim()} className="btn-primary px-4 py-2 self-end text-sm">
            {sending ? '…' : 'Reply'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function SupportDashboard() {
  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [filters, setFilters] = useState({ status: '', priority: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.status)   params.set('status', filters.status);
      if (filters.priority) params.set('priority', filters.priority);
      const [tRes, sRes] = await Promise.all([
        api.get(`/api/support/tickets?${params}`),
        api.get('/api/support/stats'),
      ]);
      setTickets(tRes.data.tickets || []);
      setStats(sRes.data);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Support Management</h1>
        <p className="text-gray-500 text-sm mt-0.5">Manage support tickets from employees and clients</p>
      </div>

      {/* KPIs */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard label="Open Tickets" value={stats.open} icon="📬" color="text-blue-600" />
          <KpiCard label="In Progress" value={stats.in_progress} icon="⚙️" color="text-yellow-600" />
          <KpiCard label="Resolved" value={stats.resolved} icon="✅" color="text-green-600" />
          <KpiCard label="Urgent / High" value={(stats.urgent || 0) + (stats.high_priority || 0)} icon="🚨" color="text-red-600" />
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <select
          value={filters.status}
          onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
        >
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
        <select
          value={filters.priority}
          onChange={e => setFilters(f => ({ ...f, priority: e.target.value }))}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
        >
          <option value="">All Priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading…</div>
      ) : tickets.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">🎫</p>
          <p className="font-medium text-gray-600">No support tickets yet</p>
          <p className="text-sm mt-1">Tickets submitted by employees and clients will appear here</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">#</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Subject</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3 hidden md:table-cell">Submitter</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Status</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3 hidden sm:table-cell">Priority</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3 hidden lg:table-cell">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {tickets.map(t => (
                <tr key={t.id} onClick={() => setSelectedId(t.id)} className="hover:bg-blue-50 cursor-pointer transition-colors">
                  <td className="px-4 py-3 text-gray-400 text-xs">#{t.id}</td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-800">{t.subject}</span>
                    {t.message_count > 0 && (
                      <span className="ml-2 text-xs text-indigo-500">({t.message_count})</span>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-gray-600">{ROLE_ICONS[t.submitter_role]} {t.submitter_name}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge label={t.status.replace('_', ' ')} colorClass={STATUS_COLORS[t.status]} />
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <Badge label={t.priority} colorClass={PRIORITY_COLORS[t.priority]} />
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-gray-400 text-xs">
                    {new Date(t.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedId && (
        <TicketDetailPanel
          ticketId={selectedId}
          onClose={() => setSelectedId(null)}
          onUpdated={load}
        />
      )}
    </div>
  );
}
