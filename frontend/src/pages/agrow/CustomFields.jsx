import React, { useState, useEffect } from 'react';
import api from '../../api';

const FIELD_TYPES = ['text','number','dropdown','date','time','boolean','image'];
const APPLIES_TO  = ['all','employee','product','scan','scanned_product','user'];

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

const EMPTY = { field_name:'', field_type:'text', applies_to:'all', required: false, sort_order: 0 };

export default function CustomFields() {
  const [fields, setFields] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm]       = useState(EMPTY);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  const load = () => {
    api.get('/api/agrow/custom-fields').then(r => setFields(r.data)).catch(() => {});
  };

  useEffect(load, []);

  const openNew  = () => { setEditing('new'); setForm(EMPTY); setError(''); };
  const openEdit = (f) => {
    setEditing(f.id);
    setForm({
      field_name:  f.field_name,
      field_type:  f.field_type,
      applies_to:  f.applies_to,
      required:    !!f.required,
      sort_order:  f.sort_order,
    });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editing === 'new') await api.post('/api/agrow/custom-fields', form);
      else                   await api.put(`/api/agrow/custom-fields/${editing}`, form);
      setEditing(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this custom field?')) return;
    await api.delete(`/api/agrow/custom-fields/${id}`);
    load();
  };

  const TYPE_ICONS = {
    text:'T', number:'#', dropdown:'▼', date:'📅', time:'⏰', boolean:'✓', image:'🖼'
  };
  const TYPE_COLORS = {
    text:'bg-blue-100 text-blue-700', number:'bg-green-100 text-green-700',
    dropdown:'bg-purple-100 text-purple-700', date:'bg-yellow-100 text-yellow-700',
    time:'bg-orange-100 text-orange-700', boolean:'bg-teal-100 text-teal-700',
    image:'bg-pink-100 text-pink-700'
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Custom Fields</h1>
          <p className="text-gray-500 mt-1">Define additional fields for your records</p>
        </div>
        <button onClick={openNew} className="btn-primary">+ Add Field</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {fields.map(f => (
          <div key={f.id} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold px-2 py-1 rounded-lg ${TYPE_COLORS[f.field_type] || 'bg-gray-100 text-gray-600'}`}>
                  {TYPE_ICONS[f.field_type]} {f.field_type}
                </span>
                {f.required ? <span className="text-xs text-red-500 font-medium">Required</span> : null}
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(f)} className="text-xs text-blue-500 hover:text-blue-700">Edit</button>
                <button onClick={() => handleDelete(f.id)} className="text-xs text-red-400 hover:text-red-600">Remove</button>
              </div>
            </div>
            <p className="font-semibold text-gray-900">{f.field_name}</p>
            <p className="text-xs text-gray-400 mt-1 capitalize">Applies to: {f.applies_to}</p>
          </div>
        ))}
        {fields.length === 0 && (
          <div className="col-span-3 text-center py-16 text-gray-400">
            <p className="text-4xl mb-3">🔧</p>
            <p>No custom fields yet. Add one to extend your data model.</p>
          </div>
        )}
      </div>

      {editing !== null && (
        <Modal title={editing === 'new' ? 'Add Custom Field' : 'Edit Custom Field'} onClose={() => setEditing(null)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Field Name *</label>
              <input
                type="text" required className="input"
                value={form.field_name}
                onChange={e => setForm(f => ({...f, field_name: e.target.value}))}
                placeholder="e.g. Soil Temperature"
              />
            </div>
            <div>
              <label className="label">Field Type *</label>
              <select className="input" value={form.field_type} onChange={e => setForm(f => ({...f, field_type: e.target.value}))}>
                {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Applies To</label>
              <select className="input" value={form.applies_to} onChange={e => setForm(f => ({...f, applies_to: e.target.value}))}>
                {APPLIES_TO.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Sort Order</label>
                <input
                  type="number" min="0" className="input"
                  value={form.sort_order}
                  onChange={e => setForm(f => ({...f, sort_order: parseInt(e.target.value)||0}))}
                />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.required}
                    onChange={e => setForm(f => ({...f, required: e.target.checked}))}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-gray-700">Required field</span>
                </label>
              </div>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
