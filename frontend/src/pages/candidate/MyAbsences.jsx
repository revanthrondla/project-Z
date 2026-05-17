import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api';

const ABSENCE_TYPES = [
  { value: 'vacation',       label: '🌴 Vacation' },
  { value: 'sick',           label: '🤒 Sick Leave' },
  { value: 'personal',       label: '👤 Personal Day' },
  { value: 'public_holiday', label: '🎉 Public Holiday' },
  { value: 'other',          label: '📌 Other' },
];

function daysBetween(start, end) {
  const a = new Date(start), b = new Date(end);
  return Math.round((b - a) / (1000 * 60 * 60 * 24)) + 1;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ── PTO Balance Widget ────────────────────────────────────────────────────────
function PtoBalanceWidget() {
  const [balances, setBalances] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/leave-balances/summary')
      .then(r => setBalances(Array.isArray(r.data) ? r.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (!balances.length) return null;

  return (
    <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
      {balances.map(b => {
        const available = (parseFloat(b.balance_days) || 0) + (parseFloat(b.carry_over_days) || 0);
        const pending   = parseFloat(b.pending_days) || 0;
        const upcoming  = parseFloat(b.upcoming_days) || 0;
        return (
          <div key={b.id} className="card p-4 text-center">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{b.policy_name || b.leave_type}</p>
            <p className="text-3xl font-bold text-emerald-600">{available.toFixed(1)}</p>
            <p className="text-xs text-gray-400 mt-0.5">days available</p>
            {pending > 0 && <p className="text-xs text-yellow-600 mt-1">{pending.toFixed(1)} pending approval</p>}
            {upcoming > 0 && <p className="text-xs text-blue-500 mt-0.5">{upcoming.toFixed(1)} upcoming</p>}
          </div>
        );
      })}
    </div>
  );
}

export default function MyAbsences() {
  const { user } = useAuth();
  const [absences, setAbsences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    start_date: '', end_date: '', type: 'vacation', notes: '',
    is_partial_day: false, partial_hours: '',
  });
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoadError('');
    return api.get('/api/absences')
      .then(r => setAbsences(Array.isArray(r.data) ? r.data : []))
      .catch(() => setLoadError('Failed to load. Is the server running?'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setForm({ start_date: '', end_date: '', type: 'vacation', notes: '', is_partial_day: false, partial_hours: '' });
    setError('');
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.is_partial_day && (!form.partial_hours || parseFloat(form.partial_hours) <= 0)) {
      return setError('Partial hours must be greater than 0');
    }
    try {
      await api.post('/api/absences', {
        ...form,
        partial_hours: form.is_partial_day ? parseFloat(form.partial_hours) : undefined,
      });
      setShowModal(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Cancel this absence request?')) return;
    try { await api.delete(`/api/absences/${id}`); load(); }
    catch (err) { alert(err.response?.data?.error || 'Delete failed'); }
  };

  const totalDaysApproved = absences
    .filter(a => a.status === 'approved' && !a.is_partial_day)
    .reduce((s, a) => s + daysBetween(a.start_date, a.end_date), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Absences</h1>
          <p className="text-gray-500 mt-1">{totalDaysApproved} full days approved this year</p>
        </div>
        <button onClick={openCreate} className="btn-primary">+ Request Time Off</button>
      </div>

      {/* PTO Balance Cards */}
      <PtoBalanceWidget />

      {loadError ? (
        <div className="card text-center py-16 text-red-500">
          <div className="text-4xl mb-2">⚠️</div>
          <p>{loadError}</p>
          <button onClick={load} className="mt-3 btn-primary text-sm">Retry</button>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
        </div>
      ) : absences.length === 0 ? (
        <div className="card text-center py-16 text-gray-400">
          <div className="text-4xl mb-2">🏖️</div>
          <p>No absence requests yet</p>
          <button onClick={openCreate} className="mt-3 btn-primary text-sm">Request time off</button>
        </div>
      ) : (
        <div className="space-y-3">
          {absences.map(a => {
            const days = a.is_partial_day ? `${a.partial_hours}h` : `${daysBetween(a.start_date, a.end_date)}d`;
            const typeLabel = ABSENCE_TYPES.find(t => t.value === a.type)?.label || a.type;
            return (
              <div key={a.id} className="card p-5 flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${
                  a.status === 'approved' ? 'bg-green-50' :
                  a.status === 'rejected' ? 'bg-red-50' : 'bg-yellow-50'
                }`}>
                  {typeLabel.split(' ')[0]}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium text-gray-900">{typeLabel.split(' ').slice(1).join(' ')}</h3>
                    <span className={`badge-${a.status}`}>{a.status}</span>
                    {a.is_partial_day && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Partial day</span>}
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {a.start_date === a.end_date ? fmtDate(a.start_date) : `${fmtDate(a.start_date)} → ${fmtDate(a.end_date)}`}
                    <span className="mx-2">·</span>{days}
                  </p>
                  {a.notes && <p className="text-xs text-gray-400 mt-1">"{a.notes}"</p>}
                  {a.rejection_reason && a.status === 'rejected' && (
                    <p className="text-xs text-red-500 mt-1">Reason: {a.rejection_reason}</p>
                  )}
                </div>
                {a.status === 'pending' && (
                  <button onClick={() => handleDelete(a.id)} className="text-red-500 hover:underline text-xs">Cancel</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <Modal title="Request Time Off" onClose={() => setShowModal(false)}>
          {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Type of Absence *</label>
              <select className="input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} required>
                {ABSENCE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            {/* Partial day toggle */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" className="w-4 h-4 rounded accent-emerald-600"
                checked={form.is_partial_day}
                onChange={e => setForm({ ...form, is_partial_day: e.target.checked, partial_hours: '' })} />
              <span className="text-sm font-medium text-gray-700">Partial day (less than a full day)</span>
            </label>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Start Date *</label>
                <input type="date" className="input" value={form.start_date}
                  onChange={e => setForm({ ...form, start_date: e.target.value, end_date: form.is_partial_day ? e.target.value : (form.end_date || e.target.value) })}
                  required />
              </div>
              {!form.is_partial_day ? (
                <div>
                  <label className="label">End Date *</label>
                  <input type="date" className="input" value={form.end_date} min={form.start_date}
                    onChange={e => setForm({ ...form, end_date: e.target.value })} required />
                </div>
              ) : (
                <div>
                  <label className="label">Hours *</label>
                  <input type="number" className="input" min="0.5" max="24" step="0.5" placeholder="e.g. 4"
                    value={form.partial_hours}
                    onChange={e => setForm({ ...form, partial_hours: e.target.value })} required />
                </div>
              )}
            </div>

            {!form.is_partial_day && form.start_date && form.end_date && (
              <div className="text-sm text-emerald-600 bg-emerald-50 p-2 rounded-lg text-center">
                📅 {daysBetween(form.start_date, form.end_date)} day{daysBetween(form.start_date, form.end_date) !== 1 ? 's' : ''} requested
              </div>
            )}

            <div>
              <label className="label">Notes (optional)</label>
              <textarea className="input" rows={2} placeholder="Any additional information..."
                value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="submit" className="btn-primary flex-1">Submit Request</button>
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
