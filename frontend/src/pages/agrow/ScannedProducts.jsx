import React, { useState, useEffect } from 'react';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';

const UNITS = ['crates','items','kg','lbs','boxes','pallets'];

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900 text-lg">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

export default function ScannedProducts() {
  const { user } = useAuth();
  const [items, setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState({ date: '', crew: '' });
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm]       = useState({
    product_name: '', quantity: 1, unit: 'crates',
    crew_name: '', ranch: '', entity_name: '',
    picking_average: '', highest_picking_speed: '', lowest_picking_speed: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter.date) params.set('date', filter.date);
    if (filter.crew) params.set('crew', filter.crew);
    api.get(`/api/agrow/scanned-products?${params}`)
      .then(r => setItems(r.data))
      .catch(() => setError('Failed to load data'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [filter]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/api/agrow/scanned-products', {
        ...form,
        quantity: parseFloat(form.quantity),
        user_name: user?.name,
        scanned_at: new Date().toISOString(),
      });
      setShowAdd(false);
      setForm({ product_name:'',quantity:1,unit:'crates',crew_name:'',ranch:'',entity_name:'',picking_average:'',highest_picking_speed:'',lowest_picking_speed:'' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this scan record?')) return;
    await api.delete(`/api/agrow/scanned-products/${id}`);
    load();
  };

  const totals = {
    items: items.length,
    quantity: items.reduce((s, i) => s + (i.quantity || 0), 0),
    products: [...new Set(items.map(i => i.product_name))].length,
  };

  const crews = [...new Set(items.map(i => i.crew_name).filter(Boolean))];

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600"/></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Scanned Products</h1>
          <p className="text-gray-500 mt-1">All field scan records</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary">+ Add Record</button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Scan Records', value: totals.items, color: 'text-emerald-600' },
          { label: 'Total Quantity', value: totals.quantity.toFixed(1), color: 'text-green-600' },
          { label: 'Unique Products', value: totals.products, color: 'text-purple-600' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5">
        <input
          type="date"
          className="input w-44"
          value={filter.date}
          onChange={e => setFilter(f => ({ ...f, date: e.target.value }))}
        />
        <select className="input w-44" value={filter.crew} onChange={e => setFilter(f => ({ ...f, crew: e.target.value }))}>
          <option value="">All Crews</option>
          {crews.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {(filter.date || filter.crew) && (
          <button onClick={() => setFilter({ date:'', crew:'' })} className="text-sm text-gray-500 hover:text-red-500">✕ Clear</button>
        )}
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Product</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Qty</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Crew</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Worker</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Scanned</th>
              <th className="px-4 py-3"/>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-10 text-gray-400">No scan records found</td></tr>
            ) : items.map(item => (
              <tr key={item.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{item.product_name}</td>
                <td className="px-4 py-3 text-right font-semibold text-green-700">{item.quantity} {item.unit}</td>
                <td className="px-4 py-3 text-gray-500">{item.crew_name || '—'}</td>
                <td className="px-4 py-3 text-gray-500">{item.user_name || '—'}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">{new Date(item.scanned_at).toLocaleString()}</td>
                <td className="px-4 py-3">
                  {user?.role === 'admin' && (
                    <button onClick={() => handleDelete(item.id)} className="text-xs text-red-400 hover:text-red-600">Remove</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <Modal title="Add Scan Record" onClose={() => setShowAdd(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Product Name *</label>
              <input type="text" className="input" required
                value={form.product_name} onChange={e => setForm(f => ({...f,product_name:e.target.value}))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Quantity</label>
                <input type="number" min="0" step="0.1" className="input"
                  value={form.quantity} onChange={e => setForm(f => ({...f,quantity:e.target.value}))} />
              </div>
              <div>
                <label className="label">Unit</label>
                <select className="input" value={form.unit} onChange={e => setForm(f => ({...f,unit:e.target.value}))}>
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Crew</label>
                <input type="text" className="input" value={form.crew_name} onChange={e => setForm(f => ({...f,crew_name:e.target.value}))} />
              </div>
              <div>
                <label className="label">Ranch</label>
                <input type="text" className="input" value={form.ranch} onChange={e => setForm(f => ({...f,ranch:e.target.value}))} />
              </div>
            </div>
            <div>
              <label className="label">Entity</label>
              <input type="text" className="input" value={form.entity_name} onChange={e => setForm(f => ({...f,entity_name:e.target.value}))} />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
