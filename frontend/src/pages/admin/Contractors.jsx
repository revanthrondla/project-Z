/**
 * Contractor Management
 * Dedicated view for contractors: W-9 status, classification, SOW, contract dates.
 * FLSA DOL 2024 independent contractor rule compliance support.
 */
import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';

const CLASSIFICATION_COLORS = {
  contractor:     'bg-blue-100 text-blue-700',
  employee:       'bg-purple-100 text-purple-700',
  pending_review: 'bg-amber-100 text-amber-700',
};

const CHECKLIST_ITEMS = [
  { key: 'w9_collected',             label: 'W-9 / W-8BEN collected' },
  { key: 'contract_signed',          label: 'Contract / SOW signed' },
  { key: 'classification_reviewed',  label: 'Classification reviewed (DOL 2024)' },
  { key: 'rate_agreed',              label: 'Rate agreed in writing' },
  { key: 'insurance_verified',       label: 'Insurance / indemnity verified' },
];

// ─── Contractor Detail Drawer ────────────────────────────────────────────────
function ContractorDrawer({ contractor, onClose, onSaved }) {
  const [form, setForm] = useState({
    classification_status: contractor.classification_status || 'contractor',
    classification_notes:  contractor.classification_notes  || '',
    w9_collected:          contractor.w9_collected          ?? false,
    sow_url:               contractor.sow_url               || '',
    contract_type:         contractor.contract_type         || 'contractor',
    start_date:            contractor.start_date            || '',
    end_date:              contractor.end_date              || '',
    target_utilization:    contractor.target_utilization    || 80,
    legal_hold:            contractor.legal_hold            ?? false,
    legal_hold_reason:     contractor.legal_hold_reason     || '',
    notes:                 contractor.notes                 || '',
  });
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true); setErr('');
    try {
      await api.put(`/api/employees/${contractor.id}`, form);
      onSaved();
    } catch (e) {
      setErr(e.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const complianceScore = [
    form.w9_collected,
    !!form.sow_url,
    form.classification_status !== 'pending_review',
    !!form.start_date,
    !!contractor.hourly_rate,
  ].filter(Boolean).length;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-end">
      <div className="bg-white w-full max-w-lg h-full overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{contractor.name}</h2>
            <p className="text-sm text-gray-500">{contractor.role || 'Contractor'} · {contractor.email}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="p-5 space-y-5">
          {err && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{err}</div>}

          {/* Compliance score */}
          <div className="card p-4">
            <p className="text-xs text-gray-500 mb-2">Compliance Score</p>
            <div className="flex items-center gap-3">
              <div className="text-2xl font-bold text-gray-900">{complianceScore}/5</div>
              <div className="flex-1">
                <div className="bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${complianceScore >= 4 ? 'bg-emerald-500' : complianceScore >= 2 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${(complianceScore / 5) * 100}%` }}
                  />
                </div>
              </div>
              <span className={`text-xs font-semibold ${complianceScore >= 4 ? 'text-emerald-600' : complianceScore >= 2 ? 'text-amber-600' : 'text-red-600'}`}>
                {complianceScore >= 4 ? 'Good' : complianceScore >= 2 ? 'Review needed' : 'Action required'}
              </span>
            </div>
          </div>

          {/* Classification */}
          <div>
            <label className="label">Classification Status</label>
            <select className="input" value={form.classification_status} onChange={e => set('classification_status', e.target.value)}>
              <option value="employee">Employee</option>
              <option value="contractor">Independent Contractor</option>
              <option value="pending_review">Pending Review</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Per DOL 2024 final rule — consider economic reality factors before classifying as contractor.
            </p>
          </div>

          <div>
            <label className="label">Classification Notes</label>
            <textarea className="input" rows={3} value={form.classification_notes}
              onChange={e => set('classification_notes', e.target.value)}
              placeholder="Document the basis for classification per the 6-factor economic reality test…" />
          </div>

          {/* Compliance checklist */}
          <div>
            <label className="label">Contractor Onboarding Checklist</label>
            <div className="space-y-2">
              {CHECKLIST_ITEMS.map(item => {
                if (item.key === 'w9_collected') {
                  return (
                    <label key={item.key} className="flex items-center gap-2 cursor-pointer select-none p-2 rounded-lg hover:bg-gray-50">
                      <input type="checkbox" checked={form.w9_collected} onChange={e => set('w9_collected', e.target.checked)}
                        className="rounded text-emerald-600 h-4 w-4" />
                      <span className="text-sm text-gray-700">{item.label}</span>
                    </label>
                  );
                }
                if (item.key === 'contract_signed') {
                  return (
                    <label key={item.key} className="flex items-center gap-2 cursor-pointer select-none p-2 rounded-lg hover:bg-gray-50">
                      <input type="checkbox" checked={!!form.sow_url} readOnly className="rounded text-emerald-600 h-4 w-4" />
                      <span className="text-sm text-gray-700">{item.label}</span>
                    </label>
                  );
                }
                if (item.key === 'classification_reviewed') {
                  return (
                    <label key={item.key} className="flex items-center gap-2 cursor-pointer select-none p-2 rounded-lg hover:bg-gray-50">
                      <input type="checkbox" checked={form.classification_status !== 'pending_review'} readOnly className="rounded text-emerald-600 h-4 w-4" />
                      <span className="text-sm text-gray-700">{item.label}</span>
                    </label>
                  );
                }
                if (item.key === 'rate_agreed') {
                  return (
                    <label key={item.key} className="flex items-center gap-2 cursor-pointer select-none p-2 rounded-lg hover:bg-gray-50">
                      <input type="checkbox" checked={!!contractor.hourly_rate} readOnly className="rounded text-emerald-600 h-4 w-4" />
                      <span className="text-sm text-gray-700">{item.label}</span>
                    </label>
                  );
                }
                return null;
              })}
            </div>
          </div>

          {/* SOW URL */}
          <div>
            <label className="label">Statement of Work / Contract URL</label>
            <input type="url" className="input" value={form.sow_url}
              onChange={e => set('sow_url', e.target.value)}
              placeholder="https://drive.google.com/…" />
          </div>

          {/* Contract dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Contract Start</label>
              <input type="date" className="input" value={form.start_date} onChange={e => set('start_date', e.target.value)} />
            </div>
            <div>
              <label className="label">Contract End</label>
              <input type="date" className="input" value={form.end_date} onChange={e => set('end_date', e.target.value)} />
            </div>
          </div>

          {/* Target utilization */}
          <div>
            <label className="label">Target Utilization %</label>
            <input type="number" min="0" max="100" className="input" value={form.target_utilization}
              onChange={e => set('target_utilization', e.target.value)} />
          </div>

          {/* Legal hold */}
          <div className="border border-amber-200 rounded-lg p-3 bg-amber-50">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={form.legal_hold} onChange={e => set('legal_hold', e.target.checked)}
                className="rounded text-amber-600 h-4 w-4" />
              <span className="text-sm font-medium text-amber-900">Legal Hold</span>
            </label>
            {form.legal_hold && (
              <input className="input mt-2 text-sm" value={form.legal_hold_reason}
                onChange={e => set('legal_hold_reason', e.target.value)}
                placeholder="Reason for legal hold…" />
            )}
            <p className="text-xs text-amber-700 mt-1">Legal hold prevents deletion and flags record for retention.</p>
          </div>

          {/* Notes */}
          <div>
            <label className="label">Internal Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>

          <div className="flex justify-end gap-3 sticky bottom-0 bg-white pt-3 border-t border-gray-100">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={save} disabled={saving} className="btn-primary">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function Contractors() {
  const [contractors, setContractors] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [filter,      setFilter]      = useState({ status: 'active', classification: '', search: '' });
  const [selected,    setSelected]    = useState(null);

  const load = useCallback(() => {
    return api.get('/api/employees', { params: { contract_type: 'contractor' } })
      .then(r => {
        const list = Array.isArray(r.data) ? r.data : [];
        setContractors(list);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = contractors.filter(c => {
    if (filter.status         && c.status !== filter.status) return false;
    if (filter.classification && c.classification_status !== filter.classification) return false;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      return c.name?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q) || c.role?.toLowerCase().includes(q);
    }
    return true;
  });

  const stats = {
    total:          contractors.length,
    active:         contractors.filter(c => c.status === 'active').length,
    missingW9:      contractors.filter(c => !c.w9_collected && c.classification_status === 'contractor').length,
    pendingReview:  contractors.filter(c => c.classification_status === 'pending_review').length,
    legalHold:      contractors.filter(c => c.legal_hold).length,
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Contractor Management</h1>
          <p className="text-gray-500 mt-1">W-9 compliance, classification review, contract tracking</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Total Contractors', value: stats.total,         icon: '👥', color: 'text-gray-900' },
          { label: 'Active',            value: stats.active,        icon: '✅', color: 'text-emerald-600' },
          { label: 'Missing W-9',       value: stats.missingW9,     icon: '⚠️', color: stats.missingW9 > 0 ? 'text-amber-600' : 'text-gray-400' },
          { label: 'Pending Review',    value: stats.pendingReview, icon: '🔍', color: stats.pendingReview > 0 ? 'text-amber-600' : 'text-gray-400' },
          { label: 'Legal Hold',        value: stats.legalHold,     icon: '⚖️', color: stats.legalHold > 0 ? 'text-red-600' : 'text-gray-400' },
        ].map(k => (
          <div key={k.label} className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <span>{k.icon}</span>
              <span className="text-xs text-gray-500">{k.label}</span>
            </div>
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Compliance Alert */}
      {(stats.missingW9 > 0 || stats.pendingReview > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5 flex items-start gap-3">
          <span className="text-xl">⚠️</span>
          <div>
            <p className="font-semibold text-amber-900">Compliance action required</p>
            <p className="text-sm text-amber-700 mt-0.5">
              {stats.missingW9 > 0 && `${stats.missingW9} contractor(s) missing W-9. `}
              {stats.pendingReview > 0 && `${stats.pendingReview} classification(s) need review per DOL 2024 rule.`}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input className="input max-w-[220px]" placeholder="Search name, email, role…"
          value={filter.search} onChange={e => setFilter(f => ({ ...f, search: e.target.value }))} />
        <select className="input max-w-[160px]" value={filter.status}
          onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}>
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select className="input max-w-[200px]" value={filter.classification}
          onChange={e => setFilter(f => ({ ...f, classification: e.target.value }))}>
          <option value="">All Classifications</option>
          <option value="contractor">Contractor</option>
          <option value="employee">Employee</option>
          <option value="pending_review">Pending Review</option>
        </select>
        <button onClick={() => setFilter({ status: 'active', classification: '', search: '' })}
          className="btn-secondary text-sm">Reset</button>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"/>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-2">👷</div>
            <p>No contractors found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Contractor</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Classification</th>
                <th className="text-center px-4 py-3 text-gray-500 font-medium">W-9</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Contract Period</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Rate</th>
                <th className="text-center px-4 py-3 text-gray-500 font-medium">SOW</th>
                <th className="text-center px-4 py-3 text-gray-500 font-medium">Legal Hold</th>
                <th className="text-right px-4 py-3 text-gray-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{c.name}</p>
                    <p className="text-xs text-gray-400">{c.email}</p>
                    {c.role && <p className="text-xs text-gray-400">{c.role}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${CLASSIFICATION_COLORS[c.classification_status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {c.classification_status?.replace('_', ' ') || 'contractor'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {c.w9_collected
                      ? <span className="text-emerald-600 text-lg">✓</span>
                      : <span className="text-amber-500 text-lg" title="W-9 not collected">!</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {c.start_date ? (
                      <div>
                        <p className="text-xs">{c.start_date}</p>
                        {c.end_date && (
                          <p className={`text-xs ${new Date(c.end_date) < new Date() ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
                            → {c.end_date}{new Date(c.end_date) < new Date() ? ' ⚠ expired' : ''}
                          </p>
                        )}
                      </div>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {c.hourly_rate ? `$${c.hourly_rate}/hr` : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {c.sow_url
                      ? <a href={c.sow_url} target="_blank" rel="noopener noreferrer"
                          className="text-indigo-500 hover:underline text-xs" onClick={e => e.stopPropagation()}>View</a>
                      : <span className="text-gray-300 text-xs">None</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {c.legal_hold && <span className="text-red-600 text-xs font-semibold">🔒 Hold</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setSelected(c)}
                      className="text-emerald-600 hover:underline text-xs font-medium">
                      Manage →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Contractor Detail Drawer */}
      {selected && (
        <ContractorDrawer
          contractor={selected}
          onClose={() => setSelected(null)}
          onSaved={() => { setSelected(null); load(); }}
        />
      )}
    </div>
  );
}
