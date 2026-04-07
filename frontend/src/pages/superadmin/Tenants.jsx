import React, { useEffect, useState, useCallback } from 'react';
import api from '../../api';
import { MODULE_REGISTRY, CATEGORIES } from '../../moduleRegistry';

const STATUS_BADGE = {
  active:    'bg-green-100 text-green-700',
  trial:     'bg-amber-100 text-amber-700',
  suspended: 'bg-red-100 text-red-700',
};

function Modal({ title, onClose, children, wide = false }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function ProvisionModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    company_name: '', contact_email: '', contact_phone: '',
    admin_email: '', admin_name: '', admin_password: 'Admin@123',
    plan: 'standard', max_candidates: 100, max_clients: 50, slug: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [created, setCreated] = useState(null);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/api/super-admin/tenants', form);
      setCreated(data);
      onCreated(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to provision tenant');
    } finally {
      setLoading(false);
    }
  };

  if (created) return (
    <Modal title="✅ Organisation Provisioned" onClose={onClose}>
      <div className="space-y-4">
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800">
          <p className="font-semibold text-base mb-2">{created.company_name} is live!</p>
          <p>Share these credentials with your client's administrator:</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-4 font-mono text-sm space-y-2">
          <div className="flex justify-between"><span className="text-gray-500">Company Code:</span><strong>{created.slug}</strong></div>
          <div className="flex justify-between"><span className="text-gray-500">Admin Email:</span><strong>{created.admin_login?.email}</strong></div>
          <div className="flex justify-between"><span className="text-gray-500">Temp Password:</span><strong>{created.admin_login?.temporary_password}</strong></div>
        </div>
        <p className="text-xs text-gray-500">The administrator should change their password on first login.</p>
        <button onClick={onClose} className="btn-primary w-full">Done</button>
      </div>
    </Modal>
  );

  return (
    <Modal title="Provision New Organisation" onClose={onClose}>
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <fieldset>
          <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Organisation</legend>
          <div className="space-y-3">
            <div>
              <label className="label">Company Name *</label>
              <input className="input" required value={form.company_name} onChange={e => set('company_name', e.target.value)} placeholder="Acme Corp" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Custom Code (optional)</label>
                <input className="input" value={form.slug} onChange={e => set('slug', e.target.value)} placeholder="auto-generated" />
              </div>
              <div>
                <label className="label">Plan</label>
                <select className="input" value={form.plan} onChange={e => set('plan', e.target.value)}>
                  <option value="trial">Trial</option>
                  <option value="standard">Standard</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Contact Email</label>
                <input type="email" className="input" value={form.contact_email} onChange={e => set('contact_email', e.target.value)} />
              </div>
              <div>
                <label className="label">Contact Phone</label>
                <input className="input" value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Max Candidates</label>
                <input type="number" className="input" value={form.max_candidates} onChange={e => set('max_candidates', e.target.value)} min={1} />
              </div>
              <div>
                <label className="label">Max Clients</label>
                <input type="number" className="input" value={form.max_clients} onChange={e => set('max_clients', e.target.value)} min={1} />
              </div>
            </div>
          </div>
        </fieldset>

        <fieldset className="mt-2">
          <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Admin User</legend>
          <div className="space-y-3">
            <div>
              <label className="label">Admin Name</label>
              <input className="input" value={form.admin_name} onChange={e => set('admin_name', e.target.value)} placeholder="John Smith" />
            </div>
            <div>
              <label className="label">Admin Email *</label>
              <input type="email" className="input" required value={form.admin_email} onChange={e => set('admin_email', e.target.value)} placeholder="admin@acme.com" />
            </div>
            <div>
              <label className="label">Temporary Password</label>
              <input className="input" value={form.admin_password} onChange={e => set('admin_password', e.target.value)} />
              <p className="text-xs text-gray-400 mt-1">Admin should change this on first login.</p>
            </div>
          </div>
        </fieldset>

        <button type="submit" disabled={loading} className="btn-primary w-full mt-2">
          {loading ? 'Provisioning…' : '🚀 Provision Organisation'}
        </button>
      </form>
    </Modal>
  );
}

// ── Module Management Panel ───────────────────────────────────────────────────

function ModulesPanel({ tenant }) {
  const [modules, setModules]   = useState([]);     // { key, enabled, name, ... }
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(null);   // key being toggled
  const [msg, setMsg]           = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/api/super-admin/tenants/${tenant.id}/modules`)
      .then(r => setModules(r.data.modules || []))
      .catch(() => setMsg('Failed to load modules'))
      .finally(() => setLoading(false));
  }, [tenant.id]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (key, currentEnabled) => {
    setSaving(key);
    setMsg('');
    try {
      await api.patch(`/api/super-admin/tenants/${tenant.id}/modules/${key}`, {
        enabled: !currentEnabled,
      });
      setModules(prev => prev.map(m => m.key === key ? { ...m, enabled: !currentEnabled } : m));
    } catch (e) {
      setMsg(e.response?.data?.error || 'Failed to update module');
    } finally {
      setSaving(null);
    }
  };

  const bulkToggle = async (category, enabled) => {
    const keys = MODULE_REGISTRY.filter(m => m.category === category).map(m => m.key);
    setSaving('__bulk__');
    // Backend expects: { modules: { key: boolean, ... } }
    const modulesObj = Object.fromEntries(keys.map(k => [k, enabled]));
    try {
      await api.put(`/api/super-admin/tenants/${tenant.id}/modules`, { modules: modulesObj });
      setModules(prev => prev.map(m => keys.includes(m.key) ? { ...m, enabled } : m));
    } catch (e) {
      setMsg(e.response?.data?.error || 'Failed');
    } finally { setSaving(null); }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue-600" />
    </div>
  );

  const moduleMap = Object.fromEntries(modules.map(m => [m.key, m.enabled]));
  const enabledCount = modules.filter(m => m.enabled).length;

  return (
    <div className="space-y-5">
      {msg && (
        <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-sm">{msg}</div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          <span className="font-semibold text-gray-900">{enabledCount}</span> of {MODULE_REGISTRY.length} modules enabled
        </p>
      </div>

      {CATEGORIES.map(category => {
        const items = MODULE_REGISTRY.filter(m => m.category === category);
        const catEnabled = items.filter(m => moduleMap[m.key]).length;
        return (
          <div key={category} className="border border-gray-200 rounded-xl overflow-hidden">
            {/* Category header */}
            <div className="bg-gray-50 px-4 py-2.5 flex items-center justify-between border-b border-gray-200">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-gray-800">{category}</span>
                <span className="text-xs text-gray-400 bg-white border border-gray-200 px-1.5 py-0.5 rounded-full">
                  {catEnabled}/{items.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => bulkToggle(category, true)}
                  disabled={saving === '__bulk__'}
                  className="text-xs text-green-600 hover:text-green-700 font-medium disabled:opacity-50"
                >Enable all</button>
                <span className="text-gray-300">·</span>
                <button
                  onClick={() => bulkToggle(category, false)}
                  disabled={saving === '__bulk__'}
                  className="text-xs text-red-500 hover:text-red-600 font-medium disabled:opacity-50"
                >Disable all</button>
              </div>
            </div>

            {/* Module rows */}
            <div className="divide-y divide-gray-100">
              {items.map(mod => {
                const enabled = !!moduleMap[mod.key];
                const isToggling = saving === mod.key;
                return (
                  <div key={mod.key} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition-colors">
                    <span className="text-xl shrink-0">{mod.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{mod.name}</p>
                      <p className="text-xs text-gray-500 truncate">{mod.description}</p>
                    </div>
                    {/* Toggle switch */}
                    <button
                      onClick={() => toggle(mod.key, enabled)}
                      disabled={isToggling}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                        isToggling ? 'opacity-50 cursor-wait' : ''
                      } ${enabled ? 'bg-green-500' : 'bg-gray-300'}`}
                      title={enabled ? 'Click to disable' : 'Click to enable'}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        enabled ? 'translate-x-4' : 'translate-x-0'
                      }`} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Detail Modal ──────────────────────────────────────────────────────────────

function DetailModal({ tenant, onClose, onUpdated }) {
  const [tab, setTab]           = useState('overview');
  const [saving, setSaving]     = useState(false);
  const [resetting, setResetting] = useState(false);
  const [newPw, setNewPw]       = useState('');
  const [msg, setMsg]           = useState('');

  const toggleStatus = async () => {
    const newStatus = tenant.status === 'active' ? 'suspended' : 'active';
    setSaving(true);
    try {
      const { data } = await api.patch(`/api/super-admin/tenants/${tenant.id}`, { status: newStatus });
      onUpdated(data);
      setMsg(`Status changed to ${newStatus}`);
    } catch (e) {
      setMsg(e.response?.data?.error || 'Failed');
    } finally { setSaving(false); }
  };

  const resetAdmin = async () => {
    if (!newPw || newPw.length < 6) return setMsg('Password must be ≥ 6 characters');
    setResetting(true);
    try {
      await api.post(`/api/super-admin/tenants/${tenant.id}/reset-admin`, { new_password: newPw });
      setMsg('Admin password reset successfully');
      setNewPw('');
    } catch (e) {
      setMsg(e.response?.data?.error || 'Failed');
    } finally { setResetting(false); }
  };

  const s = tenant.stats || {};

  const TABS = [
    { key: 'overview', label: '📋 Overview' },
    { key: 'modules',  label: '🧩 Modules' },
  ];

  return (
    <Modal title={tenant.company_name} onClose={onClose} wide>
      {/* Tab bar */}
      <div className="flex gap-1 mb-5 border-b border-gray-100 -mx-6 px-6">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setMsg(''); }}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
              tab === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-5">
          {msg && <div className="p-3 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg text-sm">{msg}</div>}

          {/* Info */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-gray-500 text-xs">Company Code</p><p className="font-mono font-semibold">{tenant.slug}</p></div>
            <div><p className="text-gray-500 text-xs">Status</p><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[tenant.status]}`}>{tenant.status}</span></div>
            <div><p className="text-gray-500 text-xs">Plan</p><p className="capitalize">{tenant.plan}</p></div>
            <div><p className="text-gray-500 text-xs">Admin Email</p><p className="truncate">{tenant.admin_email || '—'}</p></div>
            <div><p className="text-gray-500 text-xs">Created</p><p>{new Date(tenant.created_at).toLocaleDateString()}</p></div>
            <div><p className="text-gray-500 text-xs">Contact</p><p className="truncate">{tenant.contact_email || '—'}</p></div>
          </div>

          {/* Stats */}
          <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-3 gap-3 text-center text-sm">
            <div><p className="text-2xl font-bold text-blue-600">{s.active_candidates ?? '—'}</p><p className="text-gray-500 text-xs">Active candidates</p></div>
            <div><p className="text-2xl font-bold text-green-600">{s.clients ?? '—'}</p><p className="text-gray-500 text-xs">Clients</p></div>
            <div><p className="text-2xl font-bold text-purple-600">{s.invoices ?? '—'}</p><p className="text-gray-500 text-xs">Invoices</p></div>
          </div>
          {s.revenue !== undefined && (
            <p className="text-center text-sm text-gray-600">💰 Total revenue paid: <strong>${Number(s.revenue).toLocaleString()}</strong></p>
          )}

          {/* Actions */}
          <div className="border-t border-gray-100 pt-4 space-y-3">
            <button onClick={toggleStatus} disabled={saving}
              className={`w-full py-2 rounded-lg text-sm font-medium border transition-colors ${
                tenant.status === 'active'
                  ? 'border-red-200 text-red-600 hover:bg-red-50'
                  : 'border-green-200 text-green-600 hover:bg-green-50'
              }`}>
              {saving ? 'Saving…' : tenant.status === 'active' ? '🔒 Suspend Organisation' : '✅ Reactivate Organisation'}
            </button>

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Reset Admin Password</p>
              <div className="flex gap-2">
                <input className="input flex-1 text-sm" type="password" placeholder="New password (min 6 chars)"
                  value={newPw} onChange={e => setNewPw(e.target.value)} />
                <button onClick={resetAdmin} disabled={resetting}
                  className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm hover:bg-gray-700 whitespace-nowrap">
                  {resetting ? '…' : 'Reset'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'modules' && (
        <ModulesPanel tenant={tenant} />
      )}
    </Modal>
  );
}

export default function Tenants() {
  const [tenants, setTenants]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [statusFilter, setStatus] = useState('all');
  const [showProvision, setShowProvision] = useState(false);
  const [selected, setSelected]   = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/api/super-admin/tenants')
      .then(r => setTenants(r.data))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = tenants.filter(t => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (search && !t.company_name.toLowerCase().includes(search.toLowerCase()) &&
        !t.slug.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const onCreated = () => { load(); };
  const onUpdated = updated => {
    setTenants(ts => ts.map(t => t.id === updated.id ? { ...t, ...updated } : t));
    setSelected(s => s ? { ...s, ...updated } : s);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Organisations</h1>
          <p className="text-sm text-gray-500 mt-0.5">{tenants.length} provisioned</p>
        </div>
        <button onClick={() => setShowProvision(true)} className="btn-primary flex items-center gap-2">
          <span className="text-lg">+</span> Provision New
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input className="input flex-1 min-w-48 text-sm" placeholder="Search by name or code…"
          value={search} onChange={e => setSearch(e.target.value)} />
        {['all','active','trial','suspended'].map(s => (
          <button key={s} onClick={() => setStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-sm border capitalize transition-colors ${
              statusFilter === s ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'
            }`}>{s}</button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <p className="text-4xl mb-3">🏢</p>
            <p className="font-medium">No organisations found</p>
            {tenants.length === 0 && <p className="text-sm mt-1">Provision your first client organisation to get started.</p>}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Organisation</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Code</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">Plan</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Candidates</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Clients</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Provisioned</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(t => (
                <tr key={t.id} onClick={() => setSelected(t)}
                  className="hover:bg-gray-50 cursor-pointer transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-xs shrink-0 overflow-hidden">
                        {t.company_logo
                          ? <img src={t.company_logo} alt="" className="w-full h-full object-cover" />
                          : t.company_name[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{t.company_name}</p>
                        <p className="text-xs text-gray-400">{t.contact_email || '—'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">{t.slug}</span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell capitalize text-gray-600">{t.plan}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{t.candidate_count ?? 0}</td>
                  <td className="px-4 py-3 text-right text-gray-700 hidden md:table-cell">{t.client_count ?? 0}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[t.status]}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500 text-xs">
                    {new Date(t.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modals */}
      {showProvision && (
        <ProvisionModal onClose={() => setShowProvision(false)} onCreated={d => { onCreated(d); }} />
      )}
      {selected && (
        <DetailModal tenant={selected} onClose={() => setSelected(null)} onUpdated={onUpdated} />
      )}
    </div>
  );
}
