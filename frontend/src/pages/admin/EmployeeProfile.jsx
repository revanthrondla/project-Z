import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../../api';

// ─── Shared helpers ────────────────────────────────────────────────────────────

const fmt = (date) => date ? new Date(date).toLocaleDateString() : '—';
const fmtMoney = (val, currency = 'USD') =>
  val != null ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(val) : '—';

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
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (data) setForm(data); }, [data]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/employees/${empId}/contact`, form);
      setEditing(false);
      reload();
    } catch (e) {
      alert(e.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  const f = (k) => ({ value: form[k] || '', onChange: e => setForm(p => ({ ...p, [k]: e.target.value })) });

  return (
    <div className="space-y-6">
      <SectionCard title="Core Details" icon="👤" action={
        editing
          ? <div className="flex gap-2"><Btn onClick={() => setEditing(false)} variant="secondary">Cancel</Btn><Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn></div>
          : <Btn onClick={() => setEditing(true)} variant="secondary">✏️ Edit</Btn>
      }>
        {editing ? (
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

      <SectionCard title="Home Address" icon="🏠">
        {editing ? (
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
            ) : <p className="text-gray-400">No address on file</p>}
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
      {!data?.length ? <EmptyState message="No emergency contacts on file" icon="🆘" /> : (
        <div className="space-y-3">
          {data.map(ec => (
            <div key={ec.id} className="flex items-start justify-between p-4 border border-gray-200 rounded-xl">
              <div>
                <p className="font-semibold text-gray-800">{ec.name}</p>
                {ec.relationship && <p className="text-sm text-gray-500">{ec.relationship}</p>}
                <p className="text-sm text-gray-700 mt-1">📞 {ec.phone1}{ec.phone2 ? ` · ${ec.phone2}` : ''}</p>
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
      {!data?.length ? <EmptyState message="No employment history on file" icon="📋" /> : (
        <div className="relative">
          <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-gray-200" />
          <div className="space-y-4">
            {data.map((eh, i) => (
              <div key={eh.id} className="relative pl-12">
                <div className={`absolute left-3.5 top-3 w-3 h-3 rounded-full border-2 border-white ${!eh.end_date ? 'bg-green-500' : 'bg-gray-400'}`} />
                <div className="p-4 border border-gray-200 rounded-xl">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-gray-800">{eh.position_title}</p>
                      <p className="text-sm text-gray-500">{fmt(eh.start_date)} → {eh.end_date ? fmt(eh.end_date) : <Badge text="Current" color="green" />}</p>
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
      {!data?.length ? <EmptyState message="No bank accounts on file" icon="🏦" /> : (
        <div className="space-y-3">
          {data.map(ba => (
            <div key={ba.id} className="p-4 border border-gray-200 rounded-xl">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-800">{ba.bank_name}</p>
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
      {!data?.length ? <EmptyState message="No company assets recorded" icon="📦" /> : (
        <div className="space-y-3">
          {data.map(a => (
            <div key={a.id} className="flex items-start justify-between p-4 border border-gray-200 rounded-xl">
              <div className="flex items-start gap-3">
                <span className="text-2xl">{ASSET_ICONS[a.category] || '📦'}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-800">{a.description}</p>
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
      {!data?.length ? <EmptyState message="No benefits on file" icon="🎁" /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {data.map(b => (
            <div key={b.id} className="p-4 border border-gray-200 rounded-xl">
              <div className="flex items-start justify-between mb-2">
                <p className="font-semibold text-gray-800">🎁 {b.benefit_type}</p>
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
      {!data?.length ? <EmptyState message="No performance reviews on file" icon="📊" /> : (
        <div className="space-y-4">
          {data.map(r => (
            <div key={r.id} className="p-5 border border-gray-200 rounded-xl">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-semibold text-gray-800">{fmt(r.review_date)}</p>
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
      {!data?.length ? <EmptyState message="No training records on file" icon="🎓" /> : (
        <div className="space-y-3">
          {data.map(tr => (
            <div key={tr.id} className="p-4 border border-gray-200 rounded-xl">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-800">🎓 {tr.name}</p>
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
      {!data?.length ? <EmptyState message="No licences or permits on file" icon="📜" /> : (
        <div className="space-y-3">
          {data.map(lic => (
            <div key={lic.id} className={`p-4 border rounded-xl ${urgencyBg[lic.urgency]}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-800">📜 {lic.document_type}</p>
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
              {data.warnings.map((w, i) => <Badge key={i} text={`⚠️ ${w}`} color="yellow" />)}
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
