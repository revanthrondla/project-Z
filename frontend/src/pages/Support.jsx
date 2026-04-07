/**
 * Support.jsx — Employee & Client support portal
 * Accessible by: candidate, client (and admin for testing)
 * Allows creating tickets and tracking their own tickets + replies
 */
import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';

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

const CATEGORIES = [
  { value: 'general',    label: 'General' },
  { value: 'payroll',    label: 'Payroll' },
  { value: 'timesheet',  label: 'Timesheet' },
  { value: 'invoice',    label: 'Invoice' },
  { value: 'absence',    label: 'Absence' },
  { value: 'technical',  label: 'Technical' },
  { value: 'other',      label: 'Other' },
];

function Badge({ label, colorClass }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>{label}</span>;
}

function NewTicketModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ subject: '', description: '', category: 'general', priority: 'medium' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async e => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/api/support/tickets', form);
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
          <h2 className="text-lg font-semibold text-gray-800">New Support Ticket</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject *</label>
            <input className="input" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} required placeholder="Brief summary of your issue" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
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
            <textarea className="input min-h-[120px] resize-none" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} required placeholder="Describe your issue in detail..." />
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

function TicketThread({ ticket, onClose, onUpdated }) {
  const [messages, setMessages] = useState(ticket.messages || []);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const sendReply = async e => {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    try {
      const res = await api.post(`/api/support/tickets/${ticket.id}/messages`, { message: reply });
      setMessages(res.data.messages);
      setReply('');
      onUpdated();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-800 leading-tight">{ticket.subject}</h2>
            <div className="flex items-center gap-2 mt-1.5">
              <Badge label={ticket.status.replace('_', ' ')} colorClass={STATUS_COLORS[ticket.status]} />
              <Badge label={ticket.priority} colorClass={PRIORITY_COLORS[ticket.priority]} />
              <span className="text-xs text-gray-400">#{ticket.id}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none ml-4">×</button>
        </div>

        {/* Thread */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Original message */}
          <div className="bg-blue-50 rounded-xl p-4">
            <p className="text-xs text-blue-500 font-medium mb-1.5">Your original message</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{ticket.description}</p>
          </div>
          {messages.map(m => (
            <div key={m.id} className={`rounded-xl p-4 ${m.is_staff ? 'bg-indigo-50 ml-4' : 'bg-gray-50 mr-4'}`}>
              <p className="text-xs font-medium mb-1.5 text-gray-500">
                {m.is_staff ? '🛟 Support Team' : `👤 ${m.sender_name || 'You'}`}
                <span className="ml-2 text-gray-400 font-normal">{new Date(m.created_at).toLocaleString()}</span>
              </p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{m.message}</p>
            </div>
          ))}
          {messages.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-4">No replies yet — support team will respond shortly.</p>
          )}
        </div>

        {/* Reply box */}
        {!['resolved', 'closed'].includes(ticket.status) && (
          <form onSubmit={sendReply} className="border-t border-gray-100 p-4 shrink-0 flex gap-3">
            <textarea
              className="input flex-1 resize-none min-h-[60px] text-sm"
              placeholder="Add a reply…"
              value={reply}
              onChange={e => setReply(e.target.value)}
            />
            <button type="submit" disabled={sending || !reply.trim()} className="btn-primary px-4 py-2 self-end text-sm">
              {sending ? '…' : 'Send'}
            </button>
          </form>
        )}
        {['resolved', 'closed'].includes(ticket.status) && (
          <div className="border-t border-gray-100 p-4 text-center text-sm text-gray-400 shrink-0">
            This ticket is {ticket.status}. Contact support to reopen.
          </div>
        )}
      </div>
    </div>
  );
}

export default function Support() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState(null);
  const [filterStatus, setFilterStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/support/tickets');
      setTickets(res.data.tickets || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openTicket = async t => {
    const res = await api.get(`/api/support/tickets/${t.id}`);
    setSelected(res.data);
  };

  const filtered = filterStatus ? tickets.filter(t => t.status === filterStatus) : tickets;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Support</h1>
          <p className="text-gray-500 text-sm mt-0.5">Submit requests and track responses from the support team</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary px-4 py-2 text-sm">+ New Ticket</button>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {['', 'open', 'in_progress', 'resolved', 'closed'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filterStatus === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {s === '' ? 'All' : s.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
          </button>
        ))}
      </div>

      {/* Ticket list */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading tickets…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">🎫</p>
          <p className="font-medium text-gray-600">{filterStatus ? 'No tickets match this filter' : 'No support tickets yet'}</p>
          <p className="text-sm mt-1">{!filterStatus && 'Click "New Ticket" to get help from the support team'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(t => (
            <div key={t.id} onClick={() => openTicket(t)}
              className="bg-white rounded-xl border border-gray-200 p-4 cursor-pointer hover:border-blue-300 hover:shadow-sm transition-all">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-800 text-sm">{t.subject}</span>
                    {t.message_count > 0 && (
                      <span className="text-xs bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full">
                        {t.message_count} {t.message_count === 1 ? 'reply' : 'replies'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <Badge label={t.status.replace('_', ' ')} colorClass={STATUS_COLORS[t.status]} />
                    <Badge label={t.priority} colorClass={PRIORITY_COLORS[t.priority]} />
                    <span className="text-xs text-gray-400">{CATEGORIES.find(c => c.value === t.category)?.label}</span>
                    <span className="text-xs text-gray-400">#{t.id}</span>
                  </div>
                </div>
                <span className="text-xs text-gray-400 shrink-0">{new Date(t.updated_at).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && <NewTicketModal onClose={() => setShowNew(false)} onCreated={load} />}
      {selected && <TicketThread ticket={selected} onClose={() => setSelected(null)} onUpdated={load} />}
    </div>
  );
}
