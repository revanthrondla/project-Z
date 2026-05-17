import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function dayOfWeek(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long' });
}

const CURRENT_YEAR = new Date().getFullYear();

// ── Modal ─────────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ── Bulk import modal ─────────────────────────────────────────────────────────
const COUNTRY_PRESETS = {
  'United Kingdom': [
    { date: `${CURRENT_YEAR}-01-01`, name: "New Year's Day" },
    { date: `${CURRENT_YEAR}-04-18`, name: 'Good Friday' },
    { date: `${CURRENT_YEAR}-04-21`, name: 'Easter Monday' },
    { date: `${CURRENT_YEAR}-05-05`, name: 'Early May Bank Holiday' },
    { date: `${CURRENT_YEAR}-05-26`, name: 'Spring Bank Holiday' },
    { date: `${CURRENT_YEAR}-08-25`, name: 'Summer Bank Holiday' },
    { date: `${CURRENT_YEAR}-12-25`, name: 'Christmas Day' },
    { date: `${CURRENT_YEAR}-12-26`, name: 'Boxing Day' },
  ],
  'United States': [
    { date: `${CURRENT_YEAR}-01-01`, name: "New Year's Day" },
    { date: `${CURRENT_YEAR}-01-20`, name: 'Martin Luther King Jr. Day' },
    { date: `${CURRENT_YEAR}-02-17`, name: "Presidents' Day" },
    { date: `${CURRENT_YEAR}-05-26`, name: 'Memorial Day' },
    { date: `${CURRENT_YEAR}-06-19`, name: 'Juneteenth' },
    { date: `${CURRENT_YEAR}-07-04`, name: 'Independence Day' },
    { date: `${CURRENT_YEAR}-09-01`, name: 'Labor Day' },
    { date: `${CURRENT_YEAR}-11-27`, name: 'Thanksgiving Day' },
    { date: `${CURRENT_YEAR}-12-25`, name: 'Christmas Day' },
  ],
  'Australia': [
    { date: `${CURRENT_YEAR}-01-01`, name: "New Year's Day" },
    { date: `${CURRENT_YEAR}-01-27`, name: 'Australia Day' },
    { date: `${CURRENT_YEAR}-04-18`, name: 'Good Friday' },
    { date: `${CURRENT_YEAR}-04-19`, name: 'Easter Saturday' },
    { date: `${CURRENT_YEAR}-04-21`, name: 'Easter Monday' },
    { date: `${CURRENT_YEAR}-04-25`, name: 'ANZAC Day' },
    { date: `${CURRENT_YEAR}-06-09`, name: "King's Birthday" },
    { date: `${CURRENT_YEAR}-12-25`, name: 'Christmas Day' },
    { date: `${CURRENT_YEAR}-12-26`, name: 'Boxing Day' },
  ],
  'India': [
    { date: `${CURRENT_YEAR}-01-26`, name: 'Republic Day' },
    { date: `${CURRENT_YEAR}-08-15`, name: 'Independence Day' },
    { date: `${CURRENT_YEAR}-10-02`, name: 'Gandhi Jayanti' },
    { date: `${CURRENT_YEAR}-10-24`, name: 'Dussehra' },
    { date: `${CURRENT_YEAR}-11-05`, name: 'Diwali' },
    { date: `${CURRENT_YEAR}-12-25`, name: 'Christmas Day' },
  ],
};

function BulkImportModal({ onClose, onImported }) {
  const [country, setCountry] = useState('United Kingdom');
  const [selected, setSelected] = useState(() => new Set(COUNTRY_PRESETS['United Kingdom'].map(h => h.date)));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const holidays = COUNTRY_PRESETS[country] || [];

  const toggleAll = () => {
    if (selected.size === holidays.length) setSelected(new Set());
    else setSelected(new Set(holidays.map(h => h.date)));
  };

  const toggle = (date) => {
    const next = new Set(selected);
    next.has(date) ? next.delete(date) : next.add(date);
    setSelected(next);
  };

  useEffect(() => {
    setSelected(new Set(COUNTRY_PRESETS[country]?.map(h => h.date) || []));
  }, [country]);

  const handleImport = async () => {
    const toImport = holidays.filter(h => selected.has(h.date));
    if (!toImport.length) return setError('Select at least one holiday');
    setLoading(true); setError('');
    try {
      await api.post('/api/holidays/bulk', { holidays: toImport });
      onImported();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Bulk Import Holidays" onClose={onClose}>
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
      <div className="space-y-4">
        <div>
          <label className="label">Country / Region</label>
          <select className="input" value={country} onChange={e => setCountry(e.target.value)}>
            {Object.keys(COUNTRY_PRESETS).map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Select Holidays</label>
            <button onClick={toggleAll} className="text-xs text-emerald-600 hover:underline">
              {selected.size === holidays.length ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
            {holidays.map(h => (
              <label key={h.date} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" checked={selected.has(h.date)} onChange={() => toggle(h.date)}
                  className="w-4 h-4 accent-emerald-600 rounded" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{h.name}</p>
                  <p className="text-xs text-gray-400">{fmtDate(h.date)} · {dayOfWeek(h.date)}</p>
                </div>
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1">{selected.size} selected</p>
        </div>
        <div className="flex gap-3 pt-2">
          <button className="btn-primary flex-1" onClick={handleImport} disabled={loading || !selected.size}>
            {loading ? 'Importing…' : `Import ${selected.size} holidays`}
          </button>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Add/Edit single holiday modal ─────────────────────────────────────────────
function HolidayFormModal({ holiday, onClose, onSaved }) {
  const [form, setForm] = useState({
    date: holiday?.date || '',
    name: holiday?.name || '',
    description: holiday?.description || '',
    is_recurring: holiday?.is_recurring ?? true,
    location_id: holiday?.location_id || '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      if (holiday?.id) {
        await api.put(`/api/holidays/${holiday.id}`, form);
      } else {
        await api.post('/api/holidays', form);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title={holiday?.id ? 'Edit Holiday' : 'Add Holiday'} onClose={onClose}>
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Date *</label>
            <input type="date" className="input" required value={form.date}
              onChange={e => setForm({ ...form, date: e.target.value })} />
          </div>
          <div>
            <label className="label">Name *</label>
            <input type="text" className="input" required placeholder="e.g. Christmas Day" value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="label">Description (optional)</label>
          <input type="text" className="input" placeholder="Brief description" value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" className="w-4 h-4 rounded accent-emerald-600"
            checked={form.is_recurring}
            onChange={e => setForm({ ...form, is_recurring: e.target.checked })} />
          <span className="text-sm text-gray-700">Recurring annually</span>
        </label>
        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn-primary flex-1" disabled={loading}>
            {loading ? 'Saving…' : holiday?.id ? 'Save Changes' : 'Add Holiday'}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AdminHolidays() {
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState(String(CURRENT_YEAR));
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null); // null | 'add' | 'edit' | 'bulk'
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const r = await api.get('/api/holidays', { params: { year: yearFilter } });
      setHolidays(Array.isArray(r.data) ? r.data : []);
    } catch {
      setError('Failed to load holidays');
    } finally {
      setLoading(false);
    }
  }, [yearFilter]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id, name) => {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await api.delete(`/api/holidays/${id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed');
    }
  };

  const filtered = holidays.filter(h =>
    !search || h.name.toLowerCase().includes(search.toLowerCase())
  );

  const yearOptions = [String(CURRENT_YEAR - 1), String(CURRENT_YEAR), String(CURRENT_YEAR + 1)];

  // Group by month
  const byMonth = filtered.reduce((acc, h) => {
    const month = h.date.slice(0, 7); // YYYY-MM
    if (!acc[month]) acc[month] = [];
    acc[month].push(h);
    return acc;
  }, {});

  const sortedMonths = Object.keys(byMonth).sort();

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Public Holidays</h1>
          <p className="text-gray-500 mt-1">{holidays.length} holidays in {yearFilter}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setModal('bulk')} className="btn-secondary">
            📥 Bulk Import
          </button>
          <button onClick={() => { setEditing(null); setModal('add'); }} className="btn-primary">
            + Add Holiday
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-6 flex flex-wrap gap-3">
        <select className="input w-32" value={yearFilter} onChange={e => setYearFilter(e.target.value)}>
          {yearOptions.map(y => <option key={y}>{y}</option>)}
        </select>
        <input type="text" className="input flex-1 min-w-40" placeholder="Search holidays…"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {error && (
        <div className="card text-center py-12 text-red-500">
          <p>{error}</p>
          <button onClick={load} className="mt-3 btn-primary text-sm">Retry</button>
        </div>
      )}

      {!error && loading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
        </div>
      )}

      {!error && !loading && filtered.length === 0 && (
        <div className="card text-center py-16 text-gray-400">
          <div className="text-4xl mb-2">🎉</div>
          <p>No public holidays found</p>
          <div className="flex gap-3 justify-center mt-4">
            <button onClick={() => setModal('bulk')} className="btn-secondary text-sm">Bulk Import</button>
            <button onClick={() => { setEditing(null); setModal('add'); }} className="btn-primary text-sm">Add Holiday</button>
          </div>
        </div>
      )}

      {!error && !loading && sortedMonths.length > 0 && (
        <div className="space-y-6">
          {sortedMonths.map(month => {
            const monthLabel = new Date(month + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
            return (
              <div key={month} className="card overflow-hidden">
                <div className="px-5 py-3 bg-gray-50 border-b">
                  <h3 className="font-semibold text-gray-700">{monthLabel}</h3>
                </div>
                <div className="divide-y">
                  {byMonth[month].map(h => (
                    <div key={h.id} className="flex items-center gap-4 px-5 py-4">
                      {/* Date badge */}
                      <div className="w-14 h-14 rounded-xl bg-emerald-50 flex flex-col items-center justify-center shrink-0 text-emerald-700">
                        <p className="text-lg font-bold leading-none">{h.date.slice(8)}</p>
                        <p className="text-xs uppercase tracking-wide mt-0.5">
                          {new Date(h.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' })}
                        </p>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-900">{h.name}</p>
                          {h.is_recurring && (
                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">🔁 Annual</span>
                          )}
                        </div>
                        {h.description && <p className="text-sm text-gray-500 mt-0.5">{h.description}</p>}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => { setEditing(h); setModal('edit'); }}
                          className="text-xs text-blue-600 hover:underline"
                        >Edit</button>
                        <button
                          onClick={() => handleDelete(h.id, h.name)}
                          className="text-xs text-red-500 hover:underline"
                        >Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      {(modal === 'add' || modal === 'edit') && (
        <HolidayFormModal
          holiday={modal === 'edit' ? editing : null}
          onClose={() => { setModal(null); setEditing(null); }}
          onSaved={load}
        />
      )}
      {modal === 'bulk' && (
        <BulkImportModal
          onClose={() => setModal(null)}
          onImported={load}
        />
      )}
    </div>
  );
}
