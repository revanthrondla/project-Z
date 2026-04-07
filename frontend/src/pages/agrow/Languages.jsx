import React, { useState, useEffect } from 'react';
import api from '../../api';

const FLAG = { EN:'🇬🇧', ES:'🇪🇸', FR:'🇫🇷', DE:'🇩🇪', PT:'🇵🇹', ZH:'🇨🇳', AR:'🇸🇦', HI:'🇮🇳' };

export default function Languages() {
  const [langs, setLangs]   = useState([]);
  const [form, setForm]     = useState({ language_name:'', language_code:'', is_default: false });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const load = () => api.get('/api/agrow/languages').then(r => setLangs(r.data)).catch(() => {});
  useEffect(load, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/api/agrow/languages', form);
      setForm({ language_name:'', language_code:'', is_default: false });
      setShowAdd(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const setDefault = async (id) => {
    await api.put(`/api/agrow/languages/${id}`, { is_default: true });
    load();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this language?')) return;
    await api.delete(`/api/agrow/languages/${id}`);
    load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Languages</h1>
          <p className="text-gray-500 mt-1">Multilingual support — field names translate based on user selection</p>
        </div>
        <button onClick={() => setShowAdd(s => !s)} className="btn-primary">+ Add Language</button>
      </div>

      {showAdd && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h3 className="font-semibold text-gray-800 mb-4">Add New Language</h3>
          <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Language Name *</label>
              <input
                type="text" className="input w-44" required placeholder="e.g. Portuguese"
                value={form.language_name}
                onChange={e => setForm(f => ({...f, language_name: e.target.value}))}
              />
            </div>
            <div>
              <label className="label">Code (2–3 chars) *</label>
              <input
                type="text" className="input w-24" required maxLength={3} placeholder="PT"
                value={form.language_code}
                onChange={e => setForm(f => ({...f, language_code: e.target.value.toUpperCase()}))}
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer mb-0.5">
              <input
                type="checkbox"
                checked={form.is_default}
                onChange={e => setForm(f => ({...f, is_default: e.target.checked}))}
                className="w-4 h-4"
              />
              <span className="text-sm text-gray-700">Set as default</span>
            </label>
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Add'}</button>
              <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary">Cancel</button>
            </div>
          </form>
          {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {langs.map(lang => (
          <div
            key={lang.id}
            className={`bg-white rounded-xl border p-5 flex items-center gap-4 transition-all
              ${lang.is_default ? 'border-green-400 ring-1 ring-green-300' : 'border-gray-200'}`}
          >
            <div className="text-4xl">{FLAG[lang.language_code] || '🌐'}</div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-gray-900">{lang.language_name}</p>
                {lang.is_default && (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Default</span>
                )}
              </div>
              <p className="text-sm text-gray-400 font-mono">{lang.language_code}</p>
            </div>
            <div className="flex flex-col gap-1.5 items-end">
              {!lang.is_default && (
                <button
                  onClick={() => setDefault(lang.id)}
                  className="text-xs text-green-600 hover:text-green-800 font-medium"
                >
                  Set default
                </button>
              )}
              <button
                onClick={() => handleDelete(lang.id)}
                className="text-xs text-red-400 hover:text-red-600"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        {langs.length === 0 && (
          <div className="col-span-3 text-center py-16 text-gray-400">
            <p className="text-4xl mb-3">🌐</p>
            <p>No languages configured yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
