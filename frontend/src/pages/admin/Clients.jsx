import React, { useState, useEffect } from 'react';
import api from '../../api';

function Modal({ title, onClose, children, size = 'md' }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-xl shadow-2xl w-full ${size === 'lg' ? 'max-w-lg' : 'max-w-md'}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900 text-lg">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

const EMPTY_FORM = { name: '', contact_name: '', contact_email: '', address: '', billing_currency: 'USD' };

function CreateLoginModal({ client, onClose, onDone }) {
  const [form, setForm] = useState({
    name: client.contact_name || '',
    email: client.contact_email || '',
    password: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/api/client-portal/admin/clients/${client.id}/create-login`, form);
      onDone();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create login');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Create Portal Login — ${client.name}`} onClose={onClose} size="lg">
      <p className="text-sm text-gray-500 mb-4">
        Create a client portal account so <strong>{client.name}</strong> can log in, view their invoices, edit line items, and approve them.
      </p>
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">Contact Name *</label>
          <input
            className="input"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            required
            placeholder="John Smith"
          />
        </div>
        <div>
          <label className="label">Login Email *</label>
          <input
            type="email"
            className="input"
            value={form.email}
            onChange={e => setForm({ ...form, email: e.target.value })}
            required
            placeholder="john@clientcompany.com"
          />
        </div>
        <div>
          <label className="label">Initial Password *</label>
          <input
            type="text"
            className="input font-mono"
            value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
            required
            placeholder="Minimum 6 characters"
          />
          <p className="text-xs text-gray-400 mt-1">Share this with the client — they can change it after logging in.</p>
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving} className="btn-primary flex-1">
            {saving ? 'Creating…' : '🔑 Create Login'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

function RemoveLoginModal({ client, onClose, onDone }) {
  const [removing, setRemoving] = useState(false);

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await api.delete(`/api/client-portal/admin/clients/${client.id}/remove-login`);
      onDone();
      onClose();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to remove login');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Modal title="Remove Client Portal Login" onClose={onClose}>
      <p className="text-sm text-gray-600 mb-5">
        Remove the portal login for <strong>{client.name}</strong>? The client will no longer be able to log in.
      </p>
      <div className="flex gap-3">
        <button onClick={handleRemove} disabled={removing} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50">
          {removing ? 'Removing…' : 'Remove Login'}
        </button>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
      </div>
    </Modal>
  );
}

export default function AdminClients() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [createLoginFor, setCreateLoginFor] = useState(null);
  const [removeLoginFor, setRemoveLoginFor] = useState(null);

  const load = () => api.get('/api/clients').then(r => setClients(r.data)).finally(() => setLoading(false));
  useEffect(load, []);

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setError(''); setShowModal(true); };
  const openEdit = (c) => { setEditing(c); setForm(c); setError(''); setShowModal(true); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (editing) await api.put(`/api/clients/${editing.id}`, form);
      else await api.post('/api/clients', form);
      setShowModal(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this client?')) return;
    try { await api.delete(`/api/clients/${id}`); load(); }
    catch (err) { alert(err.response?.data?.error || 'Delete failed'); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
          <p className="text-gray-500 mt-1">{clients.length} clients</p>
        </div>
        <button onClick={openCreate} className="btn-primary">+ Add Client</button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading ? (
          <div className="col-span-3 flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
          </div>
        ) : clients.length === 0 ? (
          <div className="col-span-3 text-center py-16 text-gray-400">
            <div className="text-4xl mb-2">🏢</div>
            <p>No clients yet. Add your first client!</p>
          </div>
        ) : clients.map(c => (
          <div key={c.id} className="card p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center text-purple-700 font-bold text-lg shrink-0">{c.name[0]}</div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(c)} className="text-emerald-600 hover:underline text-xs">Edit</button>
                <button onClick={() => handleDelete(c.id)} className="text-red-500 hover:underline text-xs">Delete</button>
              </div>
            </div>
            <h3 className="font-semibold text-gray-900">{c.name}</h3>
            {c.contact_name && <p className="text-sm text-gray-500 mt-1">{c.contact_name}</p>}
            {c.contact_email && <p className="text-xs text-gray-400">{c.contact_email}</p>}
            {c.address && <p className="text-xs text-gray-400 mt-2 border-t border-gray-100 pt-2">{c.address}</p>}
            <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{c.billing_currency}</span>
              <span className="text-xs text-gray-400">{c.candidate_count} active candidate{c.candidate_count !== 1 ? 's' : ''}</span>
            </div>

            {/* Client Portal Login Section */}
            <div className="mt-3 pt-3 border-t border-gray-100">
              {c.user_id ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 bg-green-500 rounded-full inline-block"></span>
                    <span className="text-xs text-green-700 font-medium">Portal access enabled</span>
                  </div>
                  <button
                    onClick={() => setRemoveLoginFor(c)}
                    className="text-xs text-red-400 hover:text-red-600 hover:underline"
                  >
                    Revoke
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setCreateLoginFor(c)}
                  className="w-full text-xs text-center py-1.5 px-3 rounded-lg border border-blue-200 text-emerald-600 hover:bg-emerald-50 font-medium transition-colors"
                >
                  🔑 Create Portal Login
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Edit / Create Client modal */}
      {showModal && (
        <Modal title={editing ? 'Edit Client' : 'Add Client'} onClose={() => setShowModal(false)} size="lg">
          {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Company Name *</label>
              <input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />
            </div>
            <div>
              <label className="label">Contact Name</label>
              <input className="input" value={form.contact_name || ''} onChange={e => setForm({...form, contact_name: e.target.value})} />
            </div>
            <div>
              <label className="label">Contact Email</label>
              <input type="email" className="input" value={form.contact_email || ''} onChange={e => setForm({...form, contact_email: e.target.value})} />
            </div>
            <div>
              <label className="label">Address</label>
              <textarea className="input" rows={2} value={form.address || ''} onChange={e => setForm({...form, address: e.target.value})} />
            </div>
            <div>
              <label className="label">Billing Currency</label>
              <select className="input" value={form.billing_currency} onChange={e => setForm({...form, billing_currency: e.target.value})}>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="CAD">CAD</option>
                <option value="AUD">AUD</option>
              </select>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="submit" className="btn-primary flex-1">{editing ? 'Save Changes' : 'Add Client'}</button>
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Create portal login modal */}
      {createLoginFor && (
        <CreateLoginModal
          client={createLoginFor}
          onClose={() => setCreateLoginFor(null)}
          onDone={load}
        />
      )}

      {/* Remove portal login modal */}
      {removeLoginFor && (
        <RemoveLoginModal
          client={removeLoginFor}
          onClose={() => setRemoveLoginFor(null)}
          onDone={load}
        />
      )}
    </div>
  );
}
