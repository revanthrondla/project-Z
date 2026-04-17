/**
 * SupportDashboard.jsx — Tenant Admin support management
 *
 * Two tabs:
 *  1. "Tenant Tickets"    — incoming tickets from employees/clients → admin
 *  2. "Platform Support"  — admin → superadmin (raise / track platform tickets)
 */
import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';

const STATUS_COLORS = {
  open:        'bg-blue-100 text-emerald-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  resolved:    'bg-green-100 text-green-700',
  closed:      'bg-gray-100 text-gray-500',
};
const PRIORITY_COLORS = {
  low:    'bg-gray-100 text-gray-500',
  medium: 'bg-blue-100 text-emerald-700',
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

// ── Tenant ticket detail panel ────────────────────────────────────────────────
function TenantTicketDetailPanel({ ticketId, onClose, onUpdated }) {
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

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="bg-emerald-50 rounded-xl p-4">
            <p className="text-xs text-blue-500 font-medium mb-1.5">
              {ROLE_ICONS[ticket.submitter_role]} {ticket.submitter_name} — original message
            </p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{ticket.description}</p>
          </div>
          {(ticket.messages || []).map(m => (
            <div key={m.id} className={`rounded-xl p-4 ${m.is_staff ? 'bg-emerald-50 ml-4' : 'bg-gray-50 mr-4'}`}>
              <p className="text-xs font-medium mb-1.5 text-gray-500">
                {m.is_staff ? '🛟 Support Team (you)' : `${ROLE_ICONS[m.sender_role] || '👤'} ${m.sender_name}`}
                <span className="ml-2 text-gray-400 font-normal">{new Date(m.created_at).toLocaleString()}</span>
              </p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{m.message}</p>
            </div>
          ))}
        </div>

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

// ── Platform ticket detail panel (admin ↔ superadmin) ─────────────────────────
function PlatformTicketDetailPanel({ ticketId, onClose, onUpdated }) {
  const [ticket, setTicket] = useState(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const res = await api.get(`/api/platform-support/tickets/${ticketId}`);
    setTicket(res.data);
  }, [ticketId]);

  useEffect(() => { load(); }, [load]);

  const sendReply = async e => {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    try {
      await api.post(`/api/platform-support/tickets/${ticketId}/messages`, { message: reply });
      setReply('');
      await load();
      onUpdated();
    } finally {
      setSending(false);
    }
  };

  if (!ticket) return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-8 text-gray-400">Loading…</div>
    </div>
  );

  const isClosed = ['resolved', 'closed'].includes(ticket.status);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[92vh]">
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-800">{ticket.subject}</h2>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <Badge label={ticket.status.replace('_', ' ')} colorClass={STATUS_COLORS[ticket.status]} />
              <Badge label={ticket.priority} colorClass={PRIORITY_COLORS[ticket.priority]} />
              <span className="text-xs text-gray-400">#{ticket.id} · {new Date(ticket.created_at).toLocaleDateString()}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none ml-4">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="bg-blue-50 rounded-xl p-4">
            <p className="text-xs text-blue-500 font-medium mb-1.5">👑 You — original message</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{ticket.description}</p>
          </div>
          {(ticket.messages || []).map((m, i) => (
            <div key={i} className={`rounded-xl p-4 ${m.sender_role === 'super_admin' ? 'bg-emerald-50 ml-4' : 'bg-blue-50 mr-4'}`}>
              <p className="text-xs font-medium mb-1.5 text-gray-500">
                {m.sender_role === 'super_admin' ? '🛟 Platform Support' : '👑 You'}
                <span className="ml-2 text-gray-400 font-normal">{new Date(m.created_at).toLocaleString()}</span>
              </p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{m.message}</p>
            </div>
          ))}
          {(ticket.messages || []).length === 0 && (
            <p className="text-center text-sm text-gray-400 py-4">No replies yet — platform support will respond shortly.</p>
          )}
        </div>

        {!isClosed ? (
          <form onSubmit={sendReply} className="border-t border-gray-100 p-4 shrink-0 flex gap-3">
            <textarea
              className="input flex-1 resize-none min-h-[60px] text-sm"
              placeholder="Add more information or follow up…"
              value={reply}
              onChange={e => setReply(e.target.value)}
            />
            <button type="submit" disabled={sending || !reply.trim()} className="btn-primary px-4 py-2 self-end text-sm">
              {sending ? '…' : 'Send'}
            </button>
          </form>
        ) : (
          <div className="border-t border-gray-100 p-4 text-center text-sm text-gray-400 shrink-0">
            This ticket is {ticket.status}.
          </div>
        )}
      </div>
    </div>
  );
}

// ── New platform ticket modal ─────────────────────────────────────────────────
const PLATFORM_CATEGORIES = [
  { value: 'billing',     label: 'Billing' },
  { value: 'technical',   label: 'Technical Issue' },
  { value: 'feature',     label: 'Feature Request' },
  { value: 'account',     label: 'Account / Access' },
  { value: 'compliance',  label: 'Compliance' },
  { value: 'other',       label: 'Other' },
];

function NewPlatformTicketModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ subject: '', description: '', category: 'billing', priority: 'medium' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async e => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/api/platform-support/tickets', form);
      onCreated();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit ticket');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Contact Platform Support</h2>
            <p className="text-xs text-gray-500 mt-0.5">Your ticket will be handled by the HireIQ platform team</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject *</label>
            <input className="input" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} required placeholder="Brief summary of your request" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {PLATFORM_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <select className="input" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
            <textarea className="input min-h-[120px] resize-none" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} required placeholder="Describe your issue or request in detail…" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary px-4 py-2">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary px-5 py-2">{saving ? 'Submitting…' : 'Submit Ticket'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Platform Support tab (admin → superadmin) ─────────────────────────────────
function PlatformSupportTab() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/platform-support/tickets/mine');
      setTickets(Array.isArray(res.data) ? res.data : []);
    } catch (_) {
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm text-gray-500">Tickets you've raised with the HireIQ platform team</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary text-sm px-4 py-2">+ New Ticket</button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading…</div>
      ) : tickets.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">🏢</p>
          <p className="font-medium text-gray-600">No platform support tickets yet</p>
          <p className="text-sm mt-1">Contact the HireIQ team for billing, technical, or account issues</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">#</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Subject</th>
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
                      <span className="ml-2 text-xs text-emerald-500">({t.message_count})</span>
                    )}
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

      {showNew && <NewPlatformTicketModal onClose={() => setShowNew(false)} onCreated={load} />}
      {selectedId && (
        <PlatformTicketDetailPanel
          ticketId={selectedId}
          onClose={() => setSelectedId(null)}
          onUpdated={load}
        />
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function SupportDashboard() {
  const [activeTab, setActiveTab] = useState('tenant');
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
        <h1 className="text-2xl font-bold text-gray-900">Support</h1>
        <p className="text-gray-500 text-sm mt-0.5">Manage incoming tickets and contact platform support</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
        <button
          onClick={() => setActiveTab('tenant')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'tenant' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          🎫 Tenant Tickets
        </button>
        <button
          onClick={() => setActiveTab('platform')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'platform' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          🏢 Platform Support
        </button>
      </div>

      {/* ── Tenant Tickets tab ── */}
      {activeTab === 'tenant' && (
        <>
          {stats && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <KpiCard label="Open Tickets" value={stats.open} icon="📬" color="text-emerald-600" />
              <KpiCard label="In Progress" value={stats.in_progress} icon="⚙️" color="text-yellow-600" />
              <KpiCard label="Resolved" value={stats.resolved} icon="✅" color="text-green-600" />
              <KpiCard label="Urgent / High" value={(stats.urgent || 0) + (stats.high_priority || 0)} icon="🚨" color="text-red-600" />
            </div>
          )}

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
                    <tr key={t.id} onClick={() => setSelectedId(t.id)} className="hover:bg-emerald-50 cursor-pointer transition-colors">
                      <td className="px-4 py-3 text-gray-400 text-xs">#{t.id}</td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-800">{t.subject}</span>
                        {t.message_count > 0 && (
                          <span className="ml-2 text-xs text-emerald-500">({t.message_count})</span>
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
            <TenantTicketDetailPanel
              ticketId={selectedId}
              onClose={() => setSelectedId(null)}
              onUpdated={load}
            />
          )}
        </>
      )}

      {/* ── Platform Support tab ── */}
      {activeTab === 'platform' && <PlatformSupportTab />}
    </div>
  );
}
