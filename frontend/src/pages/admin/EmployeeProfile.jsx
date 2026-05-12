import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../../api';

// ─── Shared helpers ────────────────────────────────────────────────────────────

const fmt = (date) => date ? new Date(date).toLocaleDateString() : '—';
const fmtDateTime = (date) => date ? new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const fmtMoney = (val, currency = 'USD') =>
  val != null ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(val) : '—';

// Small "last updated" caption shown on each record card
function UpdatedAt({ date, label = 'Updated' }) {
  if (!date) return null;
  return (
    <p className="text-xs text-gray-400 mt-1.5">{label}: {fmtDateTime(date)}</p>
  );
}

function Badge({ text, color = 'gray' }) {
  const colors = {
    gray:   'bg-gray-100 text-gray-700',
    green:  'bg-green-100 text-green-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    red:    'bg-red-100 text-red-700',
    blue:   'bg-blue-100 text-emerald-700',
    purple: 'bg-purple-100 text-purple-700',
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[color] || colors.gray}`}>{text}</span>;
}

function SectionCard({ title, icon, children, action }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2">{icon} {title}</h3>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function EmptyState({ message, icon = '📭' }) {
  return (
    <div className="text-center py-8 text-gray-400">
      <div className="text-3xl mb-2">{icon}</div>
      <p className="text-sm">{message}</p>
    </div>
  );
}

function Btn({ children, onClick, variant = 'primary', size = 'sm', disabled = false, type = 'button', className = '' }) {
  const base = 'inline-flex items-center gap-1.5 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-base' };
  const variants = {
    primary:  'bg-green-600 text-white hover:bg-green-700',
    secondary:'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50',
    danger:   'bg-red-600 text-white hover:bg-red-700',
    ghost:    'text-gray-600 hover:bg-gray-100',
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

function FormField({ label, children, required }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}{required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}

function Input({ value, onChange, type = 'text', placeholder = '', required, name }) {
  return (
    <input
      type={type} name={name} value={value || ''} onChange={onChange}
      placeholder={placeholder} required={required}
      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
    />
  );
}

function Select({ value, onChange, children, name }) {
  return (
    <select name={name} value={value || ''} onChange={onChange}
      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
      {children}
    </select>
  );
}

function Textarea({ value, onChange, placeholder, rows = 3, name }) {
  return (
    <textarea name={name} value={value || ''} onChange={onChange} rows={rows}
      placeholder={placeholder}
      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"/>
  );
}

function Modal({ title, onClose, children, wide = false }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function useData(url, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(url);
      setData(res.data);
      setError(null);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => { load(); }, [load, ...deps]);
  return { data, loading, error, reload: load };
}

// ─── TAB: CONTACT ─────────────────────────────────────────────────────────────

function ContactTab({ empId }) {
  const { data, loading, reload } = useData(`/employees/${empId}/contact`);
  const [editingCore, setEditingCore]       = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [form, setForm]     = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (data) setForm(data); }, [data]);

  const saveCore = async () => {
    setSaving(true);
    try {
      await api.put(`/employees/${empId}/contact`, form);
      setEditingCore(false);
      reload();
    } catch (e) { alert(e.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const saveAddress = async () => {
    setSaving(true);
    try {
      await api.put(`/employees/${empId}/contact`, form);
      setEditingAddress(false);
      reload();
    } catch (e) { alert(e.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  const f = (k) => ({ value: form[k] || '', onChange: e => setForm(p => ({ ...p, [k]: e.target.value })) });

  return (
    <div className="space-y-6">
      {/* Core Details — independently editable */}
      <SectionCard title="Core Details" icon="👤" action={
        editingCore
          ? <div className="flex gap-2">
              <Btn onClick={() => { setForm(data); setEditingCore(false); }} variant="secondary">Cancel</Btn>
              <Btn onClick={saveCore} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn>
            </div>
          : <Btn onClick={() => setEditingCore(true)} variant="secondary">✏️ Edit</Btn>
      }>
        {editingCore ? (
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Full Name" required><Input {...f('name')} required /></FormField>
            <FormField label="Work Email"><Input {...f('email')} type="email" /></FormField>
            <FormField label="Phone"><Input {...f('phone')} /></FormField>
            <FormField label="Alt Phone"><Input {...f('alt_phone')} /></FormField>
            <FormField label="Personal Email"><Input {...f('personal_email')} type="email" /></FormField>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 text-sm">
            {[['Full Name', data?.name], ['Work Email', data?.email], ['Phone', data?.phone || '—'], ['Alt Phone', data?.alt_phone || '—'], ['Personal Email', data?.personal_email || '—']].map(([l, v]) => (
              <div key={l}><p className="text-xs text-gray-500 mb-0.5">{l}</p><p className="font-medium text-gray-800">{v || '—'}</p></div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Home Address — independently editable */}
      <SectionCard title="Home Address" icon="🏠" action={
        editingAddress
          ? <div className="flex gap-2">
              <Btn onClick={() => { setForm(data); setEditingAddress(false); }} variant="secondary">Cancel</Btn>
              <Btn onClick={saveAddress} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn>
            </div>
          : <Btn onClick={() => setEditingAddress(true)} variant="secondary">✏️ Edit</Btn>
      }>
        {editingAddress ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><FormField label="Street Address"><Input {...f('home_street')} /></FormField></div>
            <FormField label="City"><Input {...f('home_city')} /></FormField>
            <FormField label="State / Region"><Input {...f('home_state')} /></FormField>
            <FormField label="Postcode / ZIP"><Input {...f('home_postcode')} /></FormField>
            <FormField label="Country"><Input {...f('home_country')} /></FormField>
          </div>
        ) : (
          <div className="text-sm">
            {data?.home_street ? (
              <address className="not-italic text-gray-800">
                <p>{data.home_street}</p>
                <p>{[data.home_city, data.home_state, data.home_postcode].filter(Boolean).join(', ')}</p>
                <p>{data.home_country}</p>
              </address>
            ) : <p className="text-gray-400 italic">No address on file — click ✏️ Edit to add one.</p>}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ─── TAB: EMERGENCY CONTACTS ──────────────────────────────────────────────────

function EmergencyTab({ empId }) {
  const { data, loading, reload } = useData(`/employees/${empId}/emergency-contacts`);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({ name: '', relationship: '', phone1: '', phone2: '' });
  const [saving, setSaving] = useState(false);

  const openNew = () => { setForm({ name: '', relationship: '', phone1: '', phone2: '' }); setEditItem(null); setShowModal(true); };
  const openEdit = (item) => { setForm(item); setEditItem(item); setShowModal(true); };

  const save = async () => {
    if (!form.name || !form.phone1) return alert('Name and primary phone are required');
    setSaving(true);
    try {
      if (editItem) await api.put(`/employees/${empId}/emergency-contacts/${editItem.id}`, form);
      else await api.post(`/employees/${empId}/emergency-contacts`, form);
      setShowModal(false); reload();
    } catch (e) { alert(e.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!confirm('Remove this emergency contact?')) return;
    await api.delete(`/employees/${empId}/emergency-contacts/${id}`);
    reload();
  };

  const f = (k) => ({ value: form[k] || '', onChange: e => setForm(p => ({ ...p, [k]: e.target.value })) });

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Btn onClick={openNew}>+ Add Contact</Btn>
      </div>
      {!(Array.isArray(data) && data.length) ? <EmptyState message="No emergency contacts on file" icon="🆘" /> : (
        <div className="space-y-3">
          {(Array.isArray(data) ? data : []).map(ec => (
            <div key={ec.id} className="flex items-start justify-between p-4 border border-gray-200 rounded-xl">
              <div>
                <p className="font-semibold text-gray-800">{ec.name}</p>
                {ec.relationship && <p className="text-sm text-gray-500">{ec.relationship}</p>}
                <p className="text-sm text-gray-700 mt-1">📞 {ec.phone1}{ec.phone2 ? ` · ${ec.phone2}` : ''}</p>
                <UpdatedAt date={ec.updated_at} />
              </div>
              <div className="flex gap-2">
                <Btn variant="secondary" onClick={() => openEdit(ec)}>Edit</Btn>
                <Btn variant="danger" onClick={() => del(ec.id)}>Remove</Btn>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal title={editItem ? 'Edit Emergency Contact' : 'Add Emergency Contact'} onClose={() => setShowModal(false)}>
          <div className="space-y-4">
            <FormField label="Name" required><Input {...f('name')} required /></FormField>
            <FormField label="Relationship"><Input {...f('relationship')} placeholder="e.g. Spouse, Parent, Sibling" /></FormField>
            <FormField label="Primary Phone" required><Input {...f('phone1')} required /></FormField>
            <FormField label="Secondary Phone"><Input {...f('phone2')} /></FormField>
            <div className="flex justify-end gap-2 pt-2">
              <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
              <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── TAB: EMPLOYMENT HISTORY ──────────────────────────────────────────────────

const FREQ_LABELS = { hourly: 'per hour', daily: 'per day', weekly: 'per week', monthly: 'per month', annual: 'per year' };

function EmploymentTab({ empId }) {
  const { data, loading, reload } = useData(`/employees/${empId}/employment-history`);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({ position_title: '', start_date: '', end_date: '', remuneration: '', currency: 'USD', frequency: 'annual', notes: '' });
  const [saving, setSaving] = useState(false);

  const openNew = () => { setForm({ position_title: '', start_date: '', end_date: '', remuneration: '', currency: 'USD', frequency: 'annual', notes: '' }); setEditItem(null); setShowModal(true); };
  const openEdit = (item) => { setForm({ ...item, remuneration: item.remuneration || '' }); setEditItem(item); setShowModal(true); };
  const f = (k) => ({ value: form[k] || '', onChange: e => setForm(p => ({ ...p, [k]: e.target.value })), name: k });

  const save = async () => {
    if (!form.position_title || !form.start_date) return alert('Position title and start date are required');
    setSaving(true);
    try {
      if (editItem) await api.put(`/employees/${empId}/employment-history/${editItem.id}`, form);
      else await api.post(`/employees/${empId}/employment-history`, form);
      setShowModal(false); reload();
    } catch (e) { alert(e.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!confirm('Delete this employment record?')) return;
    await api.delete(`/employees/${empId}/employment-history/${id}`);
    reload();
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div>
      <div className="flex justify-end mb-4"><Btn onClick={openNew}>+ Add Record</Btn></div>
      {!(Array.isArray(data) && data.length) ? <EmptyState message="No employment history on file" icon="📋" /> : (
        <div className="relative">
          <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-gray-200" />
          <div className="space-y-4">
            {(Array.isArray(data) ? data : []).map((eh, i) => (
              <div key={eh.id} className="relative pl-12">
                <div className={`absolute left-3.5 top-3 w-3 h-3 rounded-full border-2 border-white ${!eh.end_date ? 'bg-green-500' : 'bg-gray-400'}`} />
                <div className="p-4 border border-gray-200 rounded-xl">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-gray-800">{eh.position_title}</p>
                      <p className="text-sm text-gray-500">{fmt(eh.start_date)} → {eh.end_date ? fmt(eh.end_date) : <Badge text="Current" color="green" />}</p>
                      <UpdatedAt date={eh.updated_at} />
                      {eh.remuneration && (
                        <p className="text-sm text-gray-700 mt-1">{fmtMoney(eh.remuneration, eh.currency)} <span className="text-gray-400">{FREQ_LABELS[eh.frequency]}</span></p>
                      )}
                      {eh.notes && <p className="text-xs text-gray-500 mt-1 italic">{eh.notes}</p>}
                    </div>
                    <div className="flex gap-2 ml-4">
                      <Btn variant="secondary" onClick={() => openEdit(eh)}>Edit</Btn>
                      <Btn variant="danger" onClick={() => del(eh.id)}>Delete</Btn>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showModal && (
        <Modal title={editItem ? 'Edit Employment Record' : 'Add Employment Record'} onClose={() => setShowModal(false)} wide>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><FormField label="Position Title" required><Input {...f('position_title')} required /></FormField></div>
            <FormField label="Start Date" required><Input {...f('start_date')} type="date" required /></FormField>
            <FormField label="End Date"><Input {...f('end_date')} type="date" /></FormField>
            <FormField label="Remuneration"><Input {...f('remuneration')} type="number" placeholder="0.00" /></FormField>
            <FormField label="Currency">
              <Select {...f('currency')}>
                {['USD','GBP','EUR','AUD','CAD','NZD','SGD','INR','ZAR'].map(c => <option key={c}>{c}</option>)}
              </Select>
            </FormField>
            <FormField label="Frequency">
              <Select {...f('frequency')}>
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
              </Select>
            </FormField>
            <div className="col-span-2"><FormField label="Notes"><Textarea {...f('notes')} rows={2} /></FormField></div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── TAB: BANK ACCOUNTS ───────────────────────────────────────────────────────

function BankTab({ empId }) {
  const { data, loading, reload } = useData(`/employees/${empId}/bank-accounts`);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ account_name: '', bank_name: '', account_number: '', routing_number: '', swift_code: '', country: 'US', is_primary: false });
  const [saving, setSaving] = useState(false);

  const f = (k) => ({ value: form[k] || '', onChange: e => setForm(p => ({ ...p, [k]: e.target.value })), name: k });

  const save = async () => {
    if (!form.account_name || !form.bank_name || !form.account_number) return alert('Account name, bank name and account number are required');
    setSaving(true);
    try {
      await api.post(`/employees/${empId}/bank-accounts`, form);
      setShowModal(false); reload();
    } catch (e) { alert(e.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!confirm('Remove this bank account?')) return;
    await api.delete(`/employees/${empId}/bank-accounts/${id}`);
    reload();
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-gray-500">🔒 Account numbers are masked. Only the last 4 digits are shown.</p>
        <Btn onClick={() => { setForm({ account_name: '', bank_name: '', account_number: '', routing_number: '', swift_code: '', country: 'US', is_primary: false }); setShowModal(true); }}>+ Add Account</Btn>
      </div>
      {!(Array.isArray(data) && data.length) ? <EmptyState message="No bank accounts on file" icon="🏦" /> : (
        <div className="space-y-3">
          {(Array.isArray(data) ? data : []).map(ba => (
            <div key={ba.id} className="p-4 border border-gray-200 rounded-xl">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-800">{ba.bank_name}</p>
                  <UpdatedAt date={ba.updated_at} />
                    {ba.is_primary ? <Badge text="Primary" color="green" /> : null}
                  </div>
                  <p className="text-sm text-gray-500">{ba.account_name}</p>
                  <p className="text-sm text-gray-700 font-mono mt-1">Account: {ba.account_number}</p>
                  {ba._has_routing && <p className="text-xs text-gray-400 mt-0.5">Has routing number</p>}
                  {ba._has_swift && <p className="text-xs text-gray-400">Has SWIFT code</p>}
                  <p className="text-xs text-gray-400">Country: {ba.country}</p>
                </div>
                <Btn variant="danger" onClick={() => del(ba.id)}>Remove</Btn>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal title="Add Bank Account" onClose={() => setShowModal(false)} wide>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Account Name" required><Input {...f('account_name')} placeholder="Name on account" required /></FormField>
            <FormField label="Bank Name" required><Input {...f('bank_name')} required /></FormField>
            <div className="col-span-2"><FormField label="Account Number" required><Input {...f('account_number')} required placeholder="Full account number (stored securely)" /></FormField></div>
            <FormField label="Routing / ACH Number"><Input {...f('routing_number')} /></FormField>
            <FormField label="SWIFT / BIC Code"><Input {...f('swift_code')} /></FormField>
            <FormField label="Country">
              <Select {...f('country')}>
                {['US','GB','AU','CA','NZ','SG','IN','ZA','EU'].map(c => <option key={c}>{c}</option>)}
              </Select>
            </FormField>
            <FormField label="Set as Primary">
              <label className="flex items-center gap-2 mt-2 text-sm cursor-pointer">
                <input type="checkbox" checked={!!form.is_primary} onChange={e => setForm(p => ({ ...p, is_primary: e.target.checked }))} />
                Primary payroll account
              </label>
            </FormField>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── TAB: LEAVE BALANCES ──────────────────────────────────────────────────────

function LeaveTab({ empId }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, loading, reload } = useData(`/employees/${empId}/leave-balances?year=${year}`, [year]);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({ entitlement_days: '', carry_over_days: '' });
  const [saving, setSaving] = useState(false);

  const ICONS = { vacation: '🏖️', sick: '🤒', personal: '👤', public_holiday: '🏛️', other: '📅' };
  const COLORS = { vacation: 'blue', sick: 'red', personal: 'purple', public_holiday: 'green', other: 'gray' };

  const openEdit = (bal) => { setForm({ entitlement_days: bal.entitlement_days, carry_over_days: bal.carry_over_days }); setEditItem(bal); };

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/employees/${empId}/leave-balances`, { leave_type: editItem.leave_type, year, entitlement_days: parseFloat(form.entitlement_days) || 0, carry_over_days: parseFloat(form.carry_over_days) || 0 });
      setEditItem(null); reload();
    } catch (e) { alert(e.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  const balances = data?.balances || [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <label className="text-sm font-medium text-gray-700">Year:</label>
        <Select value={year} onChange={e => setYear(parseInt(e.target.value))}>
          {[year - 1, year, year + 1].map(y => <option key={y}>{y}</option>)}
        </Select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {balances.map(bal => (
          <div key={bal.leave_type} className="p-4 border border-gray-200 rounded-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">{ICONS[bal.leave_type]}</span>
                <p className="font-semibold text-gray-800 capitalize">{bal.leave_type.replace('_', ' ')}</p>
              </div>
              <Btn variant="ghost" size="sm" onClick={() => openEdit(bal)}>✏️ Set</Btn>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[['Entitlement', bal.entitlement_days, 'blue'], ['Used', bal.used_days, 'red'], ['Available', bal.available_days, bal.available_days < 0 ? 'red' : 'green']].map(([l, v, c]) => (
                <div key={l} className={`rounded-lg p-2 ${c === 'blue' ? 'bg-emerald-50' : c === 'red' ? 'bg-red-50' : 'bg-green-50'}`}>
                  <p className={`text-lg font-bold ${c === 'blue' ? 'text-emerald-700' : c === 'red' ? 'text-red-700' : 'text-green-700'}`}>{v}</p>
                  <p className="text-xs text-gray-500">{l}</p>
                </div>
              ))}
            </div>
            {bal.carry_over_days > 0 && <p className="text-xs text-gray-400 mt-2">Carried over: {bal.carry_over_days} days</p>}
          </div>
        ))}
      </div>

      {editItem && (
        <Modal title={`Edit ${editItem.leave_type.replace('_', ' ')} Balance`} onClose={() => setEditItem(null)}>
          <div className="space-y-4">
            <FormField label="Annual Entitlement (days)"><Input value={form.entitlement_days} onChange={e => setForm(p => ({ ...p, entitlement_days: e.target.value }))} type="number" placeholder="0" /></FormField>
            <FormField label="Carry-over Days"><Input value={form.carry_over_days} onChange={e => setForm(p => ({ ...p, carry_over_days: e.target.value }))} type="number" placeholder="0" /></FormField>
            <div className="flex justify-end gap-2 pt-2">
              <Btn variant="secondary" onClick={() => setEditItem(null)}>Cancel</Btn>
              <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── TAB: ASSETS ─────────────────────────────────────────────────────────────

const ASSET_CATS = ['computer','phone','security_card','uniform','equipment','vehicle','other'];
const ASSET_STATUS = ['on_loan','returned','lost','damaged'];
const ASSET_ICONS = { computer: '💻', phone: '📱', security_card: '🪪', uniform: '👔', equipment: '🔧', vehicle: '🚗', other: '📦' };
const STATUS_COLORS = { on_loan: 'blue', returned: 'green', lost: 'red', damaged: 'yellow' };

function AssetsTab({ empId }) {
  const { data, loading, reload } = useData(`/employees/${empId}/assets`);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({ serial_number: '', description: '', category: 'other', checkout_date: '', checkin_date: '', status: 'on_loan', notes: '' });
  const [saving, setSaving] = useState(false);

  const openNew = () => { setForm({ serial_number: '', description: '', category: 'other', checkout_date: new Date().toISOString().split('T')[0], checkin_date: '', status: 'on_loan', notes: '' }); setEditItem(null); setShowModal(true); };
  const openEdit = (item) => { setForm(item); setEditItem(item); setShowModal(true); };
  const f = (k) => ({ value: form[k] || '', onChange: e => setForm(p => ({ ...p, [k]: e.target.value })), name: k });

  const save = async () => {
    if (!form.description || !form.checkout_date) return alert('Description and checkout date are required');
    setSaving(true);
    try {
      if (editItem) await api.put(`/employees/${empId}/assets/${editItem.id}`, form);
      else await api.post(`/employees/${empId}/assets`, form);
      setShowModal(false); reload();
    } catch (e) { alert(e.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!confirm('Remove this asset record?')) return;
    await api.delete(`/employees/${empId}/assets/${id}`);
    reload();
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div>
      <div className="flex justify-end mb-4"><Btn onClick={openNew}>+ Add Asset</Btn></div>
      {!(Array.isArray(data) && data.length) ? <EmptyState message="No company assets recorded" icon="📦" /> : (
        <div className="space-y-3">
          {(Array.isArray(data) ? data : []).map(a => (
            <div key={a.id} className="flex items-start justify-between p-4 border border-gray-200 rounded-xl">
              <div className="flex items-start gap-3">
                <span className="text-2xl">{ASSET_ICONS[a.category] || '📦'}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-800">{a.description}</p>
                  <UpdatedAt date={a.updated_at} />
                    <Badge text={a.status.replace('_', ' ')} color={STATUS_COLORS[a.status]} />
                  </div>
                  {a.serial_number && <p className="text-xs text-gray-500 font-mono">S/N: {a.serial_number}</p>}
                  <p className="text-sm text-gray-500 mt-1">Out: {fmt(a.checkout_date)}{a.checkin_date ? ` · In: ${fmt(a.checkin_date)}` : ''}</p>
                  {a.notes && <p className="text-xs text-gray-400 italic mt-0.5">{a.notes}</p>}
                </div>
              </div>
              <div className="flex gap-2">
                <Btn variant="secondary" onClick={() => openEdit(a)}>Edit</Btn>
                <Btn variant="danger" onClick={() => del(a.id)}>Remove</Btn>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal title={editItem ? 'Edit Asset' : 'Add Company Asset'} onClose={() => setShowModal(false)} wide>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><FormField label="Description" required><Input {...f('description')} required /></FormField></div>
            <FormField label="Category">
              <Select {...f('category')}>{ASSET_CATS.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}</Select>
            </FormField>
            <FormField label="Serial / Identifier"><Input {...f('serial_number')} /></FormField>
            <FormField label="Checkout Date" required><Input {...f('checkout_date')} type="date" required /></FormField>
            <FormField label="Return Date"><Input {...f('checkin_date')} type="date" /></FormField>
            <FormField label="Status">
              <Select {...f('status')}>{ASSET_STATUS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select>
            </FormField>
            <div className="col-span-2"><FormField label="Notes"><Textarea {...f('notes')} rows={2} /></FormField></div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── TAB: BENEFITS ────────────────────────────────────────────────────────────

function BenefitsTab({ empId }) {
  const { data, loading, reload } = useData(`/employees/${empId}/benefits`);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({ benefit_type: '', provider: '', value: '', currency: 'USD', access_details: '', notes: '', effective_date: '', end_date: '' });
  const [saving, setSaving] = useState(false);

  const openNew = () => { setForm({ benefit_type: '', provider: '', value: '', currency: 'USD', access_details: '', notes: '', effective_date: '', end_date: '' }); setEditItem(null); setShowModal(true); };
  const openEdit = (item) => { setForm({ ...item, value: item.value || '' }); setEditItem(item); setShowModal(true); };
  const f = (k) => ({ value: form[k] || '', onChange: e => setForm(p => ({ ...p, [k]: e.target.value })), name: k });

  const save = async () => {
    if (!form.benefit_type) return alert('Benefit type is required');
    setSaving(true);
    try {
      if (editItem) await api.put(`/employees/${empId}/benefits/${editItem.id}`, form);
      else await api.post(`/employees/${empId}/benefits`, form);
      setShowModal(false); reload();
    } catch (e) { alert(e.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!confirm('Remove this benefit?')) return;
    await api.delete(`/employees/${empId}/benefits/${id}`);
    reload();
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div>
      <div className="flex justify-end mb-4"><Btn onClick={openNew}>+ Add Benefit</Btn></div>
      {!(Array.isArray(data) && data.length) ? <EmptyState message="No benefits on file" icon="🎁" /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(Array.isArray(data) ? data : []).map(b => (
            <div key={b.id} className="p-4 border border-gray-200 rounded-xl">
              <div className="flex items-start justify-between mb-2">
                <p className="font-semibold text-gray-800">🎁 {b.benefit_type}</p>
                <UpdatedAt date={b.updated_at} />
                <div className="flex gap-1">
                  <Btn variant="ghost" size="sm" onClick={() => openEdit(b)}>✏️</Btn>
                  <Btn variant="ghost" size="sm" onClick={() => del(b.id)}>🗑️</Btn>
                </div>
              </div>
              {b.provider && <p className="text-sm text-gray-500">{b.provider}</p>}
              {b.value && <p className="text-sm font-medium text-green-700">{fmtMoney(b.value, b.currency)}</p>}
              {b.access_details && <p className="text-xs text-gray-500 mt-2">{b.access_details}</p>}
              {b.effective_date && <p className="text-xs text-gray-400 mt-1">Effective: {fmt(b.effective_date)}{b.end_date ? ` → ${fmt(b.end_date)}` : ''}</p>}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal title={editItem ? 'Edit Benefit' : 'Add Benefit'} onClose={() => setShowModal(false)} wide>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><FormField label="Benefit Type" required><Input {...f('benefit_type')} placeholder="e.g. Health Insurance, Car Allowance, Sales Bonus" required /></FormField></div>
            <FormField label="Provider"><Input {...f('provider')} placeholder="e.g. BUPA, Cigna" /></FormField>
            <FormField label="Value"><Input {...f('value')} type="number" placeholder="0.00" /></FormField>
            <FormField label="Currency"><Select {...f('currency')}>{['USD','GBP','EUR','AUD','CAD'].map(c => <option key={c}>{c}</option>)}</Select></FormField>
            <FormField label="Effective Date"><Input {...f('effective_date')} type="date" /></FormField>
            <FormField label="End Date"><Input {...f('end_date')} type="date" /></FormField>
            <div className="col-span-2"><FormField label="Access Details"><Textarea {...f('access_details')} placeholder="How to access or use this benefit" rows={2} /></FormField></div>
            <div className="col-span-2"><FormField label="Notes"><Textarea {...f('notes')} rows={2} /></FormField></div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── TAB: PERFORMANCE REVIEWS ─────────────────────────────────────────────────

const STAR_LABELS = { 1: 'Needs Improvement', 2: 'Below Expectations', 3: 'Meets Expectations', 4: 'Exceeds Expectations', 5: 'Outstanding' };

function Stars({ score }) {
  return (
    <div className="flex items-center gap-1">
      {[1,2,3,4,5].map(n => <span key={n} className={n <= score ? 'text-yellow-400' : 'text-gray-200'}>★</span>)}
      {score ? <span className="text-xs text-gray-500 ml-1">{STAR_LABELS[score]}</span> : null}
    </div>
  );
}

function ReviewsTab({ empId }) {
  const { data, loading, reload } = useData(`/employees/${empId}/performance-reviews`);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({ review_date: '', reviewer_name: '', overall_score: '', evaluation: '', next_steps: '' });
  const [saving, setSaving] = useState(false);

  const openNew = () => { setForm({ review_date: new Date().toISOString().split('T')[0], reviewer_name: '', overall_score: '', evaluation: '', next_steps: '' }); setEditItem(null); setShowModal(true); };
  const openEdit = (item) => { setForm({ ...item, overall_score: item.overall_score || '' }); setEditItem(item); setShowModal(true); };
  const f = (k) => ({ value: form[k] || '', onChange: e => setForm(p => ({ ...p, [k]: e.target.value })), name: k });

  const save = async () => {
    if (!form.review_date) return alert('Review date is required');
    setSaving(true);
    try {
      if (editItem) await api.put(`/employees/${empId}/performance-reviews/${editItem.id}`, form);
      else await api.post(`/employees/${empId}/performance-reviews`, form);
      setShowModal(false); reload();
    } catch (e) { alert(e.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!confirm('Delete this performance review?')) return;
    await api.delete(`/employees/${empId}/performance-reviews/${id}`);
    reload();
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div>
      <div className="flex justify-end mb-4"><Btn onClick={openNew}>+ Add Review</Btn></div>
      {!(Array.isArray(data) && data.length) ? <EmptyState message="No performance reviews on file" icon="📊" /> : (
        <div className="space-y-4">
          {(Array.isArray(data) ? data : []).map(r => (
            <div key={r.id} className="p-5 border border-gray-200 rounded-xl">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-semibold text-gray-800">{fmt(r.review_date)}</p>
                  <UpdatedAt date={r.updated_at} />
                  <p className="text-sm text-gray-500">Reviewed by: {r.reviewer_name}</p>
                </div>
                <div className="flex gap-2">
                  <Btn variant="secondary" onClick={() => openEdit(r)}>Edit</Btn>
                  <Btn variant="danger" onClick={() => del(r.id)}>Delete</Btn>
                </div>
              </div>
              {r.overall_score && <div className="mb-3"><Stars score={r.overall_score} /></div>}
              {r.evaluation && (
                <div className="mb-2">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Evaluation</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{r.evaluation}</p>
                </div>
              )}
              {r.next_steps && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Agreed Next Steps</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{r.next_steps}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal title={editItem ? 'Edit Review' : 'Add Performance Review'} onClose={() => setShowModal(false)} wide>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Review Date" required><Input {...f('review_date')} type="date" required /></FormField>
              <FormField label="Reviewer Name"><Input {...f('reviewer_name')} /></FormField>
            </div>
            <FormField label="Overall Score (1–5)">
              <div className="flex gap-2 mt-1">
                {[1,2,3,4,5].map(n => (
                  <button key={n} type="button" onClick={() => setForm(p => ({ ...p, overall_score: n }))}
                    className={`w-10 h-10 rounded-lg text-lg font-bold transition-colors ${form.overall_score >= n ? 'bg-yellow-400 text-white' : 'bg-gray-100 text-gray-400'}`}>★</button>
                ))}
                {form.overall_score ? <span className="self-center text-sm text-gray-500">{STAR_LABELS[form.overall_score]}</span> : null}
              </div>
            </FormField>
            <FormField label="Evaluation"><Textarea {...f('evaluation')} rows={4} placeholder="Detailed performance evaluation…" /></FormField>
            <FormField label="Agreed Next Steps"><Textarea {...f('next_steps')} rows={3} placeholder="Action items and goals…" /></FormField>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── TAB: TRAINING ────────────────────────────────────────────────────────────

function TrainingTab({ empId }) {
  const { data, loading, reload } = useData(`/employees/${empId}/training`);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({ training_date: '', name: '', content: '', results: '', certificate_url: '' });
  const [saving, setSaving] = useState(false);

  const openNew = () => { setForm({ training_date: new Date().toISOString().split('T')[0], name: '', content: '', results: '', certificate_url: '' }); setEditItem(null); setShowModal(true); };
  const openEdit = (item) => { setForm(item); setEditItem(item); setShowModal(true); };
  const f = (k) => ({ value: form[k] || '', onChange: e => setForm(p => ({ ...p, [k]: e.target.value })), name: k });

  const save = async () => {
    if (!form.training_date || !form.name) return alert('Date and training name are required');
    setSaving(true);
    try {
      if (editItem) await api.put(`/employees/${empId}/training/${editItem.id}`, form);
      else await api.post(`/employees/${empId}/training`, form);
      setShowModal(false); reload();
    } catch (e) { alert(e.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!confirm('Delete this training record?')) return;
    await api.delete(`/employees/${empId}/training/${id}`);
    reload();
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div>
      <div className="flex justify-end mb-4"><Btn onClick={openNew}>+ Add Training</Btn></div>
      {!(Array.isArray(data) && data.length) ? <EmptyState message="No training records on file" icon="🎓" /> : (
        <div className="space-y-3">
          {(Array.isArray(data) ? data : []).map(tr => (
            <div key={tr.id} className="p-4 border border-gray-200 rounded-xl">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-800">🎓 {tr.name}</p>
                  <UpdatedAt date={tr.updated_at} />
                    {tr.certificate_url && <a href={tr.certificate_url} target="_blank" rel="noopener noreferrer"><Badge text="Certificate" color="green" /></a>}
                  </div>
                  <p className="text-sm text-gray-500">{fmt(tr.training_date)}</p>
                  {tr.content && <p className="text-sm text-gray-600 mt-1">{tr.content}</p>}
                  {tr.results && <p className="text-sm text-green-700 mt-1 font-medium">Result: {tr.results}</p>}
                </div>
                <div className="flex gap-2 ml-4">
                  <Btn variant="secondary" onClick={() => openEdit(tr)}>Edit</Btn>
                  <Btn variant="danger" onClick={() => del(tr.id)}>Delete</Btn>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal title={editItem ? 'Edit Training Record' : 'Add Training Record'} onClose={() => setShowModal(false)} wide>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Training Date" required><Input {...f('training_date')} type="date" required /></FormField>
              <FormField label="Training Name" required><Input {...f('name')} required /></FormField>
            </div>
            <FormField label="Content / Topics Covered"><Textarea {...f('content')} rows={3} placeholder="Describe what was covered…" /></FormField>
            <FormField label="Results / Grade"><Input {...f('results')} placeholder="e.g. Passed — 92%, Completed, Distinction" /></FormField>
            <FormField label="Certificate URL"><Input {...f('certificate_url')} placeholder="https://…" /></FormField>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── TAB: LICENCES ────────────────────────────────────────────────────────────

function LicencesTab({ empId }) {
  const { data, loading, reload } = useData(`/employees/${empId}/licenses`);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({ document_type: '', document_url: '', issue_date: '', expiry_date: '', reminder_days_before: 30, notes: '' });
  const [saving, setSaving] = useState(false);

  const openNew = () => { setForm({ document_type: '', document_url: '', issue_date: '', expiry_date: '', reminder_days_before: 30, notes: '' }); setEditItem(null); setShowModal(true); };
  const openEdit = (item) => { setForm(item); setEditItem(item); setShowModal(true); };
  const f = (k) => ({ value: form[k] || '', onChange: e => setForm(p => ({ ...p, [k]: e.target.value })), name: k });

  const save = async () => {
    if (!form.document_type) return alert('Document type is required');
    setSaving(true);
    try {
      if (editItem) await api.put(`/employees/${empId}/licenses/${editItem.id}`, form);
      else await api.post(`/employees/${empId}/licenses`, form);
      setShowModal(false); reload();
    } catch (e) { alert(e.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!confirm('Delete this licence record?')) return;
    await api.delete(`/employees/${empId}/licenses/${id}`);
    reload();
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  const urgencyBg = { ok: 'border-gray-200', expiring_soon: 'border-yellow-300 bg-yellow-50', expired: 'border-red-300 bg-red-50' };
  const urgencyBadge = { ok: ['Valid', 'green'], expiring_soon: ['Expiring Soon', 'yellow'], expired: ['Expired', 'red'] };

  return (
    <div>
      <div className="flex justify-end mb-4"><Btn onClick={openNew}>+ Add Licence</Btn></div>
      {!(Array.isArray(data) && data.length) ? <EmptyState message="No licences or permits on file" icon="📜" /> : (
        <div className="space-y-3">
          {(Array.isArray(data) ? data : []).map(lic => (
            <div key={lic.id} className={`p-4 border rounded-xl ${urgencyBg[lic.urgency]}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-800">📜 {lic.document_type}</p>
                  <UpdatedAt date={lic.updated_at} />
                    <Badge text={urgencyBadge[lic.urgency][0]} color={urgencyBadge[lic.urgency][1]} />
                  </div>
                  {lic.issue_date && <p className="text-sm text-gray-500">Issued: {fmt(lic.issue_date)}</p>}
                  {lic.expiry_date && <p className={`text-sm font-medium mt-0.5 ${lic.urgency === 'expired' ? 'text-red-700' : lic.urgency === 'expiring_soon' ? 'text-yellow-700' : 'text-gray-600'}`}>
                    Expires: {fmt(lic.expiry_date)} · Reminder: {lic.reminder_days_before} days before
                  </p>}
                  {lic.document_url && <a href={lic.document_url} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-600 hover:underline mt-1 inline-block">View Document →</a>}
                  {lic.notes && <p className="text-xs text-gray-500 italic mt-1">{lic.notes}</p>}
                </div>
                <div className="flex gap-2 ml-4">
                  <Btn variant="secondary" onClick={() => openEdit(lic)}>Edit</Btn>
                  <Btn variant="danger" onClick={() => del(lic.id)}>Delete</Btn>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal title={editItem ? 'Edit Licence' : 'Add Licence / Permit'} onClose={() => setShowModal(false)} wide>
          <div className="space-y-4">
            <FormField label="Document Type" required>
              <Input {...f('document_type')} required placeholder="e.g. Driver's Licence, Work Visa, Professional Certificate" />
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Issue Date"><Input {...f('issue_date')} type="date" /></FormField>
              <FormField label="Expiry Date"><Input {...f('expiry_date')} type="date" /></FormField>
            </div>
            <FormField label="Reminder (days before expiry)">
              <Input value={form.reminder_days_before} onChange={e => setForm(p => ({ ...p, reminder_days_before: parseInt(e.target.value) || 30 }))} type="number" />
            </FormField>
            <FormField label="Document URL"><Input {...f('document_url')} placeholder="https://… or internal reference" /></FormField>
            <FormField label="Notes"><Textarea {...f('notes')} rows={2} /></FormField>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── PROFILE HEADER ───────────────────────────────────────────────────────────

function ProfileHeader({ empId }) {
  const { data, loading } = useData(`/employees/${empId}/summary`);
  const { data: contact } = useData(`/employees/${empId}/contact`);

  if (loading || !contact) return <div className="h-32 bg-gray-100 rounded-2xl animate-pulse" />;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <div className="flex items-start gap-5">
        <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center text-2xl font-bold text-green-700 flex-shrink-0">
          {contact.name?.charAt(0)?.toUpperCase() || '?'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between flex-wrap gap-2">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{contact.name}</h1>
              <p className="text-gray-500 text-sm">{contact.email}</p>
              {data?.latest_position && <p className="text-gray-600 text-sm font-medium mt-0.5">{data.latest_position}</p>}
            </div>
            <Link to="/employees" className="text-sm text-gray-500 hover:text-gray-700">← Back to Employees</Link>
          </div>

          {data?.warnings?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {(data.warnings ?? []).map((w, i) => <Badge key={i} text={`⚠️ ${w}`} color="yellow" />)}
            </div>
          )}

          <div className="flex flex-wrap gap-4 mt-4 text-sm text-gray-600">
            {[
              ['📞', data?.has_emergency_contact ? `${data.emergency_contact_count} emergency contact(s)` : null, !data?.has_emergency_contact && '⚠️ No emergency contact'],
              ['📦', data?.assets_on_loan ? `${data.assets_on_loan} asset(s) on loan` : null, null],
              ['🎁', data?.benefit_count ? `${data.benefit_count} benefit(s)` : null, null],
              ['🏦', data?.has_bank_account ? 'Bank account on file' : null, !data?.has_bank_account && '⚠️ No bank account'],
            ].map(([icon, pos, neg], i) => pos ? (
              <span key={i} className="flex items-center gap-1">{icon} {pos}</span>
            ) : neg ? (
              <span key={i} className="flex items-center gap-1 text-yellow-600">{neg}</span>
            ) : null)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── TAB: EEO ─────────────────────────────────────────────────────────────────

const EEO_RACE_OPTIONS = [
  { value: 'hispanic_latino',                  label: 'Hispanic or Latino' },
  { value: 'white',                            label: 'White (Not Hispanic or Latino)' },
  { value: 'black_african_american',           label: 'Black or African American' },
  { value: 'native_hawaiian_pacific_islander', label: 'Native Hawaiian or Other Pacific Islander' },
  { value: 'asian',                            label: 'Asian (Not Hispanic or Latino)' },
  { value: 'american_indian_alaska_native',    label: 'American Indian or Alaska Native' },
  { value: 'two_or_more_races',                label: 'Two or More Races' },
  { value: 'prefer_not_to_say',               label: 'Prefer Not to Say / Not Disclosed' },
];

const EEO_JOB_CAT_OPTIONS = [
  { value: 'exec_senior_mgr', label: '1.1 Executive/Senior Level Officials & Managers' },
  { value: 'first_mid_mgr',   label: '1.2 First/Mid Level Officials & Managers' },
  { value: 'professional',    label: '2. Professionals' },
  { value: 'technician',      label: '3. Technicians' },
  { value: 'sales',           label: '4. Sales Workers' },
  { value: 'admin_support',   label: '5. Administrative Support Workers' },
  { value: 'craft',           label: '6. Craft Workers' },
  { value: 'operative',       label: '7. Operatives' },
  { value: 'laborer_helper',  label: '8. Laborers & Helpers' },
  { value: 'service_worker',  label: '9. Service Workers' },
  { value: 'not_assigned',    label: 'Not Assigned' },
];

const EEO_VETERAN_OPTIONS = [
  { value: 'not_veteran',                        label: 'Not a Veteran' },
  { value: 'disabled_veteran',                   label: 'Disabled Veteran' },
  { value: 'recently_separated_veteran',         label: 'Recently Separated Veteran' },
  { value: 'active_duty_wartime_badge_veteran',  label: 'Active Duty Wartime / Campaign Badge Veteran' },
  { value: 'armed_forces_service_medal_veteran', label: 'Armed Forces Service Medal Veteran' },
  { value: 'prefer_not_to_say',                 label: 'Prefer Not to Say' },
];

function EEOTab({ empId }) {
  const [form,    setForm]    = useState({});
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [err,     setErr]     = useState(null);

  useEffect(() => {
    api.get(`/eeo/employees/${empId}`)
      .then(r => setForm(r.data))
      .catch(e => setErr(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [empId]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true); setErr(null); setSaved(false);
    try {
      const { id, name, email, role, _labels, ...body } = form;
      await api.put(`/eeo/employees/${empId}`, body);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading EEO data…</p>;

  const SL = ({ label, field, options, help }) => (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <select
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
        value={form[field] || ''}
        onChange={e => set(field, e.target.value || null)}
      >
        <option value="">— Not provided —</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {help && <p className="text-xs text-gray-400 mt-0.5">{help}</p>}
    </div>
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
        <strong>Voluntary Self-Identification</strong> — All EEO fields are collected on a voluntary, confidential basis per EEOC guidelines.
        Employees may select "Prefer Not to Say" or leave any field blank. This data is used solely for regulatory reporting and is never used in employment decisions.
      </div>

      {err && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{err}</div>}

      {/* EEO-1 Fields */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <h3 className="font-semibold text-gray-800 mb-4 text-sm flex items-center gap-2">
          <span>📋</span> EEO-1 Data (EEOC Required)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SL label="Race / Ethnicity" field="eeo_race_ethnicity" options={EEO_RACE_OPTIONS} />
          <div>
            <label className="block text-xs text-gray-500 mb-1">Gender</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              value={form.eeo_gender || ''}
              onChange={e => set('eeo_gender', e.target.value || null)}
            >
              <option value="">— Not provided —</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="nonbinary">Nonbinary</option>
              <option value="prefer_not_to_say">Prefer Not to Say</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <SL label="EEO-1 Job Category" field="eeo_job_category" options={EEO_JOB_CAT_OPTIONS} help="Maps this employee to the EEOC occupational group for EEO-1 filing" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Race/Ethnicity Data Source</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              value={form.eeo_data_source || 'not_collected'}
              onChange={e => set('eeo_data_source', e.target.value)}
            >
              <option value="self_identified">Self-Identified (preferred)</option>
              <option value="visual_observation">Visual Observation</option>
              <option value="payroll_records">Payroll Records</option>
              <option value="not_collected">Not Collected</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Self-ID Date</label>
            <input
              type="date"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50 cursor-default"
              value={form.eeo_self_id_date || ''}
              readOnly
            />
            <p className="text-xs text-gray-400 mt-0.5">Auto-set when any EEO field is saved</p>
          </div>
        </div>
      </div>

      {/* VEVRAA */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <h3 className="font-semibold text-gray-800 mb-1 text-sm flex items-center gap-2">
          <span>🎖️</span> Veteran Status (VEVRAA)
        </h3>
        <p className="text-xs text-gray-500 mb-4">Required for federal contractors. Voluntary for all others.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SL label="Veteran Status" field="veteran_status" options={EEO_VETERAN_OPTIONS} />
          <div>
            <label className="block text-xs text-gray-500 mb-1">Self-Identified?</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              value={form.veteran_self_identified === false ? 'false' : 'true'}
              onChange={e => set('veteran_self_identified', e.target.value === 'true')}
            >
              <option value="true">Yes — self-identified</option>
              <option value="false">No — employer-identified</option>
            </select>
          </div>
        </div>
      </div>

      {/* Section 503 / ADA */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <h3 className="font-semibold text-gray-800 mb-1 text-sm flex items-center gap-2">
          <span>♿</span> Disability Status (Section 503 / ADA)
        </h3>
        <p className="text-xs text-gray-500 mb-4">Required for federal contractors. Voluntary for all others. Employees are invited to self-identify at hire and every 5 years thereafter.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Disability Status</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              value={form.disability_status || ''}
              onChange={e => set('disability_status', e.target.value || null)}
            >
              <option value="">— Not provided —</option>
              <option value="yes_disability">Yes, I have a disability</option>
              <option value="no_disability">No, I do not have a disability</option>
              <option value="prefer_not_to_say">Prefer not to answer</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Self-Identified?</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              value={form.disability_self_identified === false ? 'false' : 'true'}
              onChange={e => set('disability_self_identified', e.target.value === 'true')}
            >
              <option value="true">Yes — self-identified</option>
              <option value="false">No — employer-identified</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium px-6 py-2 rounded-lg text-sm transition-colors"
        >
          {saving ? 'Saving…' : 'Save EEO Data'}
        </button>
        {saved && <span className="text-green-600 text-sm font-medium">✓ Saved</span>}
      </div>
    </div>
  );
}

// ─── TAB: HISTORY ─────────────────────────────────────────────────────────────

const SECTION_LABELS = {
  employees:            'Core details',
  employee_contact_ext: 'Contact / Address',
  emergency_contacts:   'Emergency contacts',
  employment_history:   'Employment history',
  bank_accounts:        'Bank accounts',
  leave_balances:       'Leave balances',
  employee_assets:      'Assets',
  employee_benefits:    'Benefits',
  performance_reviews:  'Performance reviews',
  training_records:     'Training',
  employee_licenses:    'Licences',
  eeo_data:             'EEO data',
};

const ACTION_STYLE = {
  INSERT: { label: 'Created', bg: 'bg-green-50 border-green-200', dot: 'bg-green-500', text: 'text-green-700' },
  UPDATE: { label: 'Updated', bg: 'bg-blue-50 border-blue-200',  dot: 'bg-blue-500',  text: 'text-blue-700'  },
  DELETE: { label: 'Deleted', bg: 'bg-red-50 border-red-200',    dot: 'bg-red-500',   text: 'text-red-700'   },
};

function HistoryTab({ empId }) {
  const { data, loading, error } = useData(`/employees/${empId}/history`);
  const [expanded, setExpanded] = useState({});

  const entries = Array.isArray(data) ? data : [];

  if (loading) return <p className="text-sm text-gray-500">Loading history…</p>;
  if (error)   return <p className="text-sm text-red-500">Could not load history: {error}</p>;

  if (entries.length === 0) {
    return (
      <EmptyState
        icon="🕐"
        message="No change history recorded yet. History is captured automatically as data is added or edited."
      />
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-400 mb-4">
        Showing the last {entries.length} change{entries.length !== 1 ? 's' : ''} across all sections of this employee's profile.
      </p>
      {entries.map(entry => {
        const style = ACTION_STYLE[entry.action] || ACTION_STYLE.UPDATE;
        const sectionLabel = SECTION_LABELS[entry.table_name] || entry.table_name;
        const isOpen = !!expanded[entry.id];
        const hasDetail = entry.old_data || entry.new_data;

        return (
          <div key={entry.id} className={`border rounded-xl overflow-hidden ${style.bg}`}>
            <div className="flex items-start gap-3 px-4 py-3">
              <span className={`mt-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${style.dot}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-semibold uppercase tracking-wide ${style.text}`}>{style.label}</span>
                  <span className="text-sm font-medium text-gray-800">{sectionLabel}</span>
                  {entry.changed_by_name && (
                    <span className="text-xs text-gray-500">by {entry.changed_by_name}</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{fmtDateTime(entry.changed_at)}</p>
              </div>
              {hasDetail && (
                <button
                  onClick={() => setExpanded(p => ({ ...p, [entry.id]: !p[entry.id] }))}
                  className="text-xs text-gray-500 hover:text-gray-700 flex-shrink-0 pt-0.5"
                >
                  {isOpen ? '▲ Hide' : '▼ Details'}
                </button>
              )}
            </div>

            {isOpen && hasDetail && (
              <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {entry.old_data && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-1">Before</p>
                    <pre className="text-xs bg-white/60 border border-gray-200 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(entry.old_data, null, 2)}
                    </pre>
                  </div>
                )}
                {entry.new_data && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-1">After</p>
                    <pre className="text-xs bg-white/60 border border-gray-200 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(entry.new_data, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── DOCUMENTS TAB ────────────────────────────────────────────────────────────

const SIG_TYPE_LABELS = {
  none:      'No signature',
  single:    'Single',
  two_way:   'Two-way',
  three_way: 'Three-way',
};
const DOC_STATUS_META = {
  pending:   { label: 'Pending',   cls: 'bg-yellow-100 text-yellow-800' },
  partial:   { label: 'Partial',   cls: 'bg-blue-100   text-blue-800'   },
  completed: { label: 'Completed', cls: 'bg-green-100  text-green-800'  },
  voided:    { label: 'Voided',    cls: 'bg-red-100    text-red-800'    },
};

function DocStatusBadge({ status }) {
  const m = DOC_STATUS_META[status] || { label: status, cls: 'bg-gray-100 text-gray-700' };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${m.cls}`}>{m.label}</span>;
}

function DocumentsTab({ empId }) {
  const [docs, setDocs]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [selected, setSelected]   = useState(null);  // for detail/download view

  const loadDocs = useCallback(() => {
    setLoading(true); setError('');
    api.get(`/api/documents?candidate_id=${empId}`)
      .then(r => setDocs(Array.isArray(r.data) ? r.data : []))
      .catch(e => setError(e.response?.data?.error || 'Failed to load documents'))
      .finally(() => setLoading(false));
  }, [empId]);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  const handleDelete = async (docId, e) => {
    e.stopPropagation();
    if (!confirm('Delete this document permanently?')) return;
    try {
      await api.delete(`/api/documents/${docId}`);
      loadDocs();
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed');
    }
  };

  if (loading) return <p className="text-sm text-gray-500 py-4">Loading documents…</p>;

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {docs.length === 0 ? 'No documents attached yet.' : `${docs.length} document${docs.length !== 1 ? 's' : ''}`}
        </p>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors"
        >
          📤 Upload Document
        </button>
      </div>

      {/* Document cards */}
      {docs.length === 0 ? (
        <EmptyState icon="📁" message="No documents have been uploaded for this employee yet." />
      ) : (
        <div className="space-y-2">
          {docs.map(doc => (
            <div
              key={doc.id}
              onClick={() => setSelected(doc)}
              className="flex items-center justify-between p-3 rounded-xl border border-gray-200 hover:border-emerald-300 hover:bg-emerald-50/30 cursor-pointer transition-colors group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-2xl flex-shrink-0">
                  {doc.mime_type === 'application/pdf' ? '📄' :
                   doc.mime_type?.includes('image')    ? '🖼️' :
                   doc.mime_type?.includes('word')     ? '📝' : '📎'}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{doc.title}</p>
                  <p className="text-xs text-gray-400 truncate">{doc.file_name} · {(doc.file_size / 1024).toFixed(1)} KB</p>
                  <p className="text-xs text-gray-400">{fmtDateTime(doc.created_at)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full hidden sm:inline">
                  {SIG_TYPE_LABELS[doc.signature_type] || doc.signature_type}
                </span>
                <DocStatusBadge status={doc.status} />
                <a
                  href={`/api/documents/${doc.id}/file`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="text-xs text-emerald-600 hover:underline px-2 py-1 rounded hover:bg-emerald-50"
                  title="View / Download"
                >
                  ↓
                </a>
                <button
                  onClick={e => handleDelete(doc.id, e)}
                  className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <EmpDocUploadModal
          empId={empId}
          onClose={() => setShowUpload(false)}
          onUploaded={() => { setShowUpload(false); loadDocs(); }}
        />
      )}

      {/* Detail / Download Modal */}
      {selected && (
        <DocDetailModal
          doc={selected}
          onClose={() => setSelected(null)}
          onDelete={() => { setSelected(null); loadDocs(); }}
        />
      )}
    </div>
  );
}

// ── Inline upload modal scoped to this employee ────────────────────────────
function EmpDocUploadModal({ empId, onClose, onUploaded }) {
  const [form, setForm]     = useState({ title: '', description: '', signature_type: 'none', required_signers: [] });
  const [file, setFile]     = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const fileRef             = useRef();

  const signerOptions = {
    none:      [],
    single:    [['candidate'], ['admin']],
    two_way:   [['candidate','admin'], ['candidate','client'], ['client','admin']],
    three_way: [['candidate','client','admin']],
  };
  const ROLE_ICONS = { candidate: '👤', client: '🏢', admin: '🔑' };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return setError('Please select a file');
    if (!form.title.trim()) return setError('Title is required');
    if (form.signature_type !== 'none' && form.required_signers.length === 0)
      return setError('Select who must sign');

    setSaving(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', form.title.trim());
      fd.append('description', form.description);
      fd.append('signature_type', form.signature_type);
      fd.append('required_signers', form.required_signers.join(','));
      fd.append('candidate_id', empId);
      // Pass Content-Type: undefined to clear the axios-instance default of
      // 'application/json'. Axios then auto-sets 'multipart/form-data; boundary=...'
      await api.post('/api/documents', fd, { headers: { 'Content-Type': undefined } });
      onUploaded();
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Upload Document</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">{error}</div>}

          {/* File picker */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">File <span className="text-red-500">*</span></label>
            <div
              onClick={() => fileRef.current.click()}
              className="border-2 border-dashed border-gray-300 rounded-xl p-4 text-center cursor-pointer hover:border-emerald-400 transition-colors"
            >
              {file
                ? <p className="text-sm text-gray-700">📄 {file.name} ({(file.size/1024).toFixed(1)} KB)</p>
                : <p className="text-sm text-gray-400">Click to browse — PDF, Word, image, TXT (max 10 MB)</p>
              }
              <input ref={fileRef} type="file" className="hidden"
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt"
                onChange={e => setFile(e.target.files[0] || null)} />
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title <span className="text-red-500">*</span></label>
            <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Employment Contract 2026" />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Optional notes…" />
          </div>

          {/* Signature type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Signature Requirement</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(SIG_TYPE_LABELS).map(([val, lbl]) => (
                <button key={val} type="button"
                  onClick={() => setForm(f => ({ ...f, signature_type: val, required_signers: [] }))}
                  className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors text-left ${
                    form.signature_type === val
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}>
                  {val === 'none' && '✏️ '}
                  {val === 'single' && '👤 '}
                  {val === 'two_way' && '🤝 '}
                  {val === 'three_way' && '🔐 '}
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* Signer combos */}
          {form.signature_type !== 'none' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Who must sign?</label>
              <div className="space-y-1">
                {(signerOptions[form.signature_type] || []).map(combo => {
                  const key = combo.join(',');
                  const selected = form.required_signers.join(',') === key;
                  return (
                    <button key={key} type="button"
                      onClick={() => setForm(f => ({ ...f, required_signers: combo }))}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                        selected ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                      }`}>
                      <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${selected ? 'bg-emerald-600 border-emerald-600' : 'border-gray-300'}`} />
                      {combo.map(r => `${ROLE_ICONS[r]} ${r}`).join(' + ')}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60">
              {saving ? '⏳ Uploading…' : '📤 Upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Document detail / download modal ──────────────────────────────────────
function DocDetailModal({ doc, onClose, onDelete }) {
  const [audit, setAudit]           = useState(null);
  const [loadingAudit, setLoadAudit] = useState(true);

  useEffect(() => {
    api.get(`/api/documents/${doc.id}/audit`)
      .then(r => setAudit(r.data))
      .catch(() => {})
      .finally(() => setLoadAudit(false));
  }, [doc.id]);

  const doDelete = async () => {
    if (!confirm('Delete this document permanently?')) return;
    try {
      await api.delete(`/api/documents/${doc.id}`);
      onDelete();
    } catch (e) {
      alert(e.response?.data?.error || 'Delete failed');
    }
  };

  const ROLE_ICONS = { candidate: '👤', client: '🏢', admin: '🔑' };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">{doc.title}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {doc.file_name} · {(doc.file_size / 1024).toFixed(1)} KB · Uploaded {fmtDateTime(doc.created_at)}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl ml-4">✕</button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Status + download */}
          <div className="flex flex-wrap items-center gap-2">
            <DocStatusBadge status={doc.status} />
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
              {SIG_TYPE_LABELS[doc.signature_type] || doc.signature_type}
            </span>
            <a
              href={`/api/documents/${doc.id}/file`}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-sm text-emerald-600 hover:underline flex items-center gap-1"
            >
              📄 View / Download
            </a>
          </div>

          {doc.description && <p className="text-sm text-gray-600">{doc.description}</p>}

          {/* Signature audit trail */}
          {doc.required_signers && doc.required_signers.length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Signature Status</p>
              {loadingAudit ? (
                <p className="text-xs text-gray-400">Loading…</p>
              ) : (
                <div className="space-y-2">
                  {(audit?.audit_trail || []).map((entry, i) => (
                    <div key={i} className={`flex items-center gap-3 rounded-xl p-3 border ${
                      entry.status === 'signed'   ? 'bg-green-50 border-green-200' :
                      entry.status === 'rejected' ? 'bg-red-50 border-red-200'    :
                                                    'bg-gray-50 border-gray-200'}`}>
                      <span className="text-xl">{ROLE_ICONS[entry.role] || '?'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 capitalize">{entry.role}</p>
                        {entry.status === 'signed' && (
                          <p className="text-xs text-gray-500">{entry.name} · {fmtDateTime(entry.signed_at)}</p>
                        )}
                        {entry.status === 'pending'  && <p className="text-xs text-gray-400">Awaiting signature</p>}
                        {entry.status === 'rejected' && <p className="text-xs text-red-600">Rejected</p>}
                      </div>
                      <span className="text-lg">
                        {entry.status === 'signed' ? '✅' : entry.status === 'rejected' ? '❌' : '⏳'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-2 justify-end">
          <button onClick={doDelete}
            className="px-4 py-2 rounded-lg border border-red-200 text-red-600 text-sm hover:bg-red-50">
            Delete
          </button>
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm hover:bg-gray-200">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'contact',     label: '📇 Contact',     component: ContactTab },
  { id: 'emergency',   label: '🆘 Emergency',   component: EmergencyTab },
  { id: 'employment',  label: '📋 Employment',  component: EmploymentTab },
  { id: 'bank',        label: '🏦 Bank',        component: BankTab },
  { id: 'leave',       label: '🏖️ Leave',      component: LeaveTab },
  { id: 'assets',      label: '📦 Assets',      component: AssetsTab },
  { id: 'benefits',    label: '🎁 Benefits',    component: BenefitsTab },
  { id: 'reviews',     label: '📊 Reviews',     component: ReviewsTab },
  { id: 'training',    label: '🎓 Training',    component: TrainingTab },
  { id: 'licenses',    label: '📜 Licences',    component: LicencesTab },
  { id: 'documents',   label: '📁 Documents',   component: DocumentsTab },
  { id: 'eeo',         label: '⚖️ EEO',         component: EEOTab },
  { id: 'history',     label: '🕐 History',     component: HistoryTab },
];

export default function EmployeeProfile() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'contact');

  const switchTab = (tabId) => {
    setActiveTab(tabId);
    setSearchParams({ tab: tabId }, { replace: true });
  };

  const TabComponent = TABS.find(t => t.id === activeTab)?.component || ContactTab;

  return (
    <div className="space-y-6">
      <ProfileHeader empId={id} />

      {/* Tab bar */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <div className="flex border-b border-gray-200 min-w-max">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                  activeTab === tab.id
                    ? 'border-green-500 text-green-700 bg-green-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="p-6">
          <TabComponent empId={id} />
        </div>
      </div>
    </div>
  );
}
