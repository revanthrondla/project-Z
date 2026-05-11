import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';
import CustomFieldRenderer, { validateCustomFieldValues } from '../../components/CustomFieldRenderer';

const MARKET_CFG = {
  employed:              { label: 'Employed',       color: 'bg-gray-100 text-gray-600' },
  in_market:             { label: 'In Market',      color: 'bg-green-100 text-green-700' },
  about_to_be_in_market: { label: 'Available Soon', color: 'bg-amber-100 text-amber-700' },
};
function MarketBadge({ status }) {
  const cfg = MARKET_CFG[status] || MARKET_CFG.employed;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>{cfg.label}</span>;
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-xl shadow-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900 text-lg">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ── Duplicate Detected Modal ───────────────────────────────────────────────
function DuplicateDetectedModal({ duplicates, onContinueNew, onRehire, onClose }) {
  const [reHireTarget, setRehireTarget] = useState(duplicates[0] || null);
  const [rehireDate, setRehireDate]     = useState('');
  const [rehiring, setRehiring]         = useState(false);
  const [error, setError]              = useState('');

  const doRehire = async () => {
    if (!rehireDate) { setError('Please set a new start date'); return; }
    setRehiring(true); setError('');
    try {
      await onRehire(reHireTarget.id, rehireDate);
    } catch (e) {
      setError(e.response?.data?.error || 'Rehire failed');
      setRehiring(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-amber-500 text-xl">⚠️</span>
            <h3 className="font-semibold text-gray-900 text-lg">Potential Duplicate Detected</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-600">
            The details you entered match an existing employee record. Please review and choose how to proceed.
          </p>

          {/* List of matches */}
          <div className="space-y-2">
            {duplicates.map(d => (
              <button
                key={d.id}
                onClick={() => setRehireTarget(d)}
                className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                  reHireTarget?.id === d.id
                    ? 'border-emerald-400 bg-emerald-50'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{d.name}</p>
                    <p className="text-xs text-gray-500">{d.email}</p>
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    {d.employee_number && <p className="font-mono font-medium">{d.employee_number}</p>}
                    <p>{d.status}</p>
                    {d.termination_date && <p className="text-red-500">Terminated {d.termination_date}</p>}
                    {d.is_rehire && <p className="text-amber-600">Previously rehired</p>}
                    {d.ssn_last4 && <p>SSN: ***-**-{d.ssn_last4}</p>}
                  </div>
                </div>
                {d.client_name && <p className="text-xs text-gray-400 mt-1">Client: {d.client_name}</p>}
              </button>
            ))}
          </div>

          {/* Rehire date for the selected match */}
          {reHireTarget && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
              <p className="text-sm font-medium text-blue-800">
                Rehiring <strong>{reHireTarget.name}</strong> — set new start date:
              </p>
              <input
                type="date"
                className="input"
                value={rehireDate}
                onChange={e => setRehireDate(e.target.value)}
              />
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              onClick={doRehire}
              disabled={!reHireTarget || rehiring}
              className="btn-primary flex-1"
            >
              {rehiring ? 'Processing…' : `Rehire ${reHireTarget?.name || 'Selected'}`}
            </button>
            <button
              onClick={onContinueNew}
              className="btn-secondary flex-1"
            >
              Continue as New Employee
            </button>
          </div>
          <p className="text-xs text-gray-400 text-center">
            Rehiring will create a new record linked to the previous employment history.
          </p>
        </div>
      </div>
    </div>
  );
}

const EMPTY_FORM = {
  name: '', email: '', phone: '', role: '', hourly_rate: '', client_id: '',
  start_date: '', end_date: '', status: 'active', contract_type: 'contractor',
  password: 'candidate123', market_status: 'employed', available_date: '', market_notes: '',
  employee_number: '', ssn: '', date_of_birth: '',
};

export default function AdminCandidates() {
  const [employees, setEmployees]   = useState([]);
  const [clients, setClients]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [showModal, setShowModal]     = useState(false);
  const [editing, setEditing]         = useState(null);
  const [form, setForm]               = useState(EMPTY_FORM);
  const [error, setError]             = useState('');
  const [search, setSearch]           = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  // Employee number config
  const [empNumConfig, setEmpNumConfig] = useState({ emp_num_mode: 'auto', next_number: null });

  // Duplicate detection state
  const [dupDuplicates, setDupDuplicates] = useState(null); // null = no dialog; array = show dialog
  const [pendingPayload, setPendingPayload] = useState(null); // form payload waiting on dup decision

  // Custom fields state
  const [customFieldDefs, setCustomFieldDefs]   = useState([]);
  const [customFieldValues, setCustomFieldValues] = useState({}); // { [field_key]: value }
  const [cfErrors, setCfErrors]                 = useState({});

  const load = useCallback(() => {
    Promise.all([
      api.get('/api/employees'),
      api.get('/api/clients'),
      api.get('/api/custom-fields/active'),
    ]).then(([c, cl, cf]) => {
      setEmployees(Array.isArray(c.data) ? c.data : []);
      setClients(Array.isArray(cl.data) ? cl.data : []);
      setCustomFieldDefs(Array.isArray(cf.data) ? cf.data : []);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Load employee number config on mount
  useEffect(() => {
    api.get('/api/employees/next-number')
      .then(r => setEmpNumConfig(r.data))
      .catch(() => {}); // non-critical
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setCustomFieldValues({});
    setCfErrors({});
    setError('');
    setShowModal(true);
  };

  const openEdit = async (c) => {
    setEditing(c);
    setForm({ ...c, password: '', ssn: '', date_of_birth: c.date_of_birth ? c.date_of_birth.split('T')[0] : '' });
    setCustomFieldValues({});
    setCfErrors({});
    setError('');
    // Load existing custom field values for this employee
    try {
      const valRes = await api.get(`/api/custom-fields/employee/${c.id}/values`);
      const vals = {};
      for (const v of (valRes.data || [])) {
        const isJson = ['select','radio','checkbox','multi_checkbox'].includes(v.field_type);
        vals[v.field_key] = isJson ? v.value_json : v.value_text;
      }
      setCustomFieldValues(vals);
    } catch {
      // ignore — non-critical
    }
    setShowModal(true);
  };

  const handleCfChange = (fieldKey, value) => {
    setCustomFieldValues(prev => ({ ...prev, [fieldKey]: value }));
    setCfErrors(prev => { const n = {...prev}; delete n[fieldKey]; return n; });
  };

  // Save custom fields for an employee
  const saveCustomFields = async (employeeId) => {
    if (customFieldDefs.length === 0 || !employeeId) return;
    const values = customFieldDefs
      .filter(f => f.is_active && !f.formula)
      .map(f => ({ field_key: f.field_key, value: customFieldValues[f.field_key] ?? null }));
    if (values.length > 0) {
      await api.put(`/api/custom-fields/employee/${employeeId}/values`, { values }).catch(() => {});
    }
  };

  // Core hire logic — actually sends POST /api/employees
  const doCreate = async (payload) => {
    const res = await api.post('/api/employees', payload);
    const employeeId = res.data?.id || res.data?.candidate?.id;
    await saveCustomFields(employeeId);
    setShowModal(false);
    setDupDuplicates(null);
    setPendingPayload(null);
    load();
    // Refresh next-number preview
    api.get('/api/employees/next-number').then(r => setEmpNumConfig(r.data)).catch(() => {});
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validate custom fields
    const cfErrs = validateCustomFieldValues(customFieldDefs, customFieldValues);
    if (Object.keys(cfErrs).length > 0) {
      setCfErrors(cfErrs);
      return;
    }

    const payload = { ...form };

    if (editing) {
      // PUT — no duplicate check needed
      try {
        await api.put(`/api/employees/${editing.id}`, payload);
        await saveCustomFields(editing.id);
        setShowModal(false);
        load();
      } catch (err) {
        setError(err.response?.data?.error || 'Something went wrong');
      }
      return;
    }

    // New hire — run duplicate check first
    try {
      const dupRes = await api.post('/api/employees/duplicate-check', {
        ssn:           form.ssn           || undefined,
        date_of_birth: form.date_of_birth || undefined,
        name:          form.name          || undefined,
      });
      const dups = dupRes.data?.duplicates || [];
      if (dups.length > 0 && !dupRes.data?.skipped) {
        // Show duplicate modal — pause the hire
        setDupDuplicates(dups);
        setPendingPayload(payload);
        return;
      }
    } catch {
      // Dup-check failure is non-blocking — proceed with hire
    }

    try {
      await doCreate(payload);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    }
  };

  // User chose "Continue as New Employee" despite duplicate warning
  const handleContinueNew = async () => {
    if (!pendingPayload) return;
    try {
      await doCreate(pendingPayload);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    }
  };

  // User chose to rehire an existing employee
  const handleRehire = async (prevId, startDate) => {
    const payload = pendingPayload || {};
    await api.post(`/api/employees/${prevId}/rehire`, {
      start_date: startDate,
      role:        payload.role        || undefined,
      hourly_rate: payload.hourly_rate || undefined,
      client_id:   payload.client_id  || undefined,
    });
    setShowModal(false);
    setDupDuplicates(null);
    setPendingPayload(null);
    load();
    api.get('/api/employees/next-number').then(r => setEmpNumConfig(r.data)).catch(() => {});
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this employee? This cannot be undone.')) return;
    try {
      await api.delete(`/api/employees/${id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed');
    }
  };

  const filtered = employees.filter(c => {
    const matchSearch = !search ||
      (c.name           || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.email          || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.role           || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.employee_number|| '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'all' || c.status === filterStatus;
    return matchSearch && matchStatus;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
          <p className="text-gray-500 mt-1">{employees.length} total employees</p>
        </div>
        <button onClick={openCreate} className="btn-primary">+ Add Employee</button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input className="input max-w-xs" placeholder="Search name, email, role..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input max-w-[160px]" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="pending">Pending</option>
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-2">👥</div>
            <p>No employees found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Employee</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">#</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Role</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Client</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Rate</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Type</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Market</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Start Date</th>
                <th className="text-right px-4 py-3 text-gray-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-emerald-700 font-semibold text-sm">{(c.name||'?')[0]}</div>
                      <div>
                        <Link to={`/employees/${c.id}`} className="font-medium text-gray-900 hover:text-green-700 hover:underline">{c.name}</Link>
                        <p className="text-xs text-gray-400">{c.email}</p>
                        {c.is_rehire && <span className="text-xs text-amber-600 font-medium">↩ Rehire</span>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{c.employee_number || '—'}</td>
                  <td className="px-4 py-3 text-gray-700">{c.role}</td>
                  <td className="px-4 py-3 text-gray-500">{c.client_name || '—'}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">${c.hourly_rate}/hr</td>
                  <td className="px-4 py-3 text-gray-500 capitalize">{c.contract_type}</td>
                  <td className="px-4 py-3"><span className={`badge-${c.status}`}>{c.status}</span></td>
                  <td className="px-4 py-3"><MarketBadge status={c.market_status || 'employed'} /></td>
                  <td className="px-4 py-3 text-gray-500">{c.start_date || '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link to={`/employees/${c.id}`} className="text-green-600 hover:underline text-xs font-medium">Profile</Link>
                      <button onClick={() => openEdit(c)} className="text-emerald-600 hover:underline text-xs">Edit</button>
                      <button onClick={() => handleDelete(c.id)} className="text-red-500 hover:underline text-xs">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <Modal title={editing ? 'Edit Employee' : 'Add Employee'} wide onClose={() => setShowModal(false)}>
          {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="label">Full Name *</label>
                <input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />
              </div>
              <div>
                <label className="label">Email *</label>
                <input type="email" className="input" value={form.email} onChange={e => setForm({...form, email: e.target.value})} required disabled={!!editing} />
              </div>
              <div>
                <label className="label">Phone</label>
                <input className="input" value={form.phone || ''} onChange={e => setForm({...form, phone: e.target.value})} />
              </div>
              <div>
                <label className="label">Role / Title *</label>
                <input className="input" placeholder="e.g. Senior Developer" value={form.role} onChange={e => setForm({...form, role: e.target.value})} required />
              </div>
              <div>
                <label className="label">Hourly Rate (USD) *</label>
                <input type="number" min="0" step="0.01" className="input" value={form.hourly_rate} onChange={e => setForm({...form, hourly_rate: e.target.value})} required />
              </div>
              <div>
                <label className="label">Client</label>
                <select className="input" value={form.client_id || ''} onChange={e => setForm({...form, client_id: e.target.value})}>
                  <option value="">No client assigned</option>
                  {clients.map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Contract Type</label>
                <select className="input" value={form.contract_type} onChange={e => setForm({...form, contract_type: e.target.value})}>
                  <option value="contractor">Contractor</option>
                  <option value="employee">Employee</option>
                  <option value="part-time">Part-time</option>
                </select>
              </div>
              <div>
                <label className="label">Start Date</label>
                <input type="date" className="input" value={form.start_date || ''} onChange={e => setForm({...form, start_date: e.target.value})} />
              </div>
              <div>
                <label className="label">End Date</label>
                <input type="date" className="input" value={form.end_date || ''} onChange={e => setForm({...form, end_date: e.target.value})} />
              </div>
              <div>
                <label className="label">Status</label>
                <select className="input" value={form.status} onChange={e => setForm({...form, status: e.target.value})}>
                  <option value="active">Active</option>
                  <option value="pending">Pending</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="label">Market Status</label>
                <select
                  className="input"
                  value={form.market_status || 'employed'}
                  onChange={e => setForm(f => ({ ...f, market_status: e.target.value }))}
                >
                  <option value="employed">Employed</option>
                  <option value="in_market">In Market — actively seeking</option>
                  <option value="about_to_be_in_market">Available Soon</option>
                </select>
              </div>
              {(form.market_status === 'in_market' || form.market_status === 'about_to_be_in_market') && (
                <>
                  <div>
                    <label className="label">Available From</label>
                    <input type="date" className="input" value={form.available_date || ''} onChange={e => setForm(f => ({ ...f, available_date: e.target.value }))} />
                  </div>
                  <div className="col-span-2">
                    <label className="label">Notes</label>
                    <textarea className="input" rows={2} placeholder="e.g. finishing current contract end of June" value={form.market_notes || ''} onChange={e => setForm(f => ({ ...f, market_notes: e.target.value }))} />
                  </div>
                </>
              )}
              {!editing && (
                <div className="col-span-2">
                  <label className="label">Initial Password</label>
                  <input type="password" className="input" value={form.password} onChange={e => setForm({...form, password: e.target.value})} placeholder="Default: candidate123" />
                </div>
              )}
            </div>

            {/* ── Employee Identity / HR Section ── */}
            <div className="border-t border-gray-100 pt-4 mt-2">
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Employee Identity</h4>
              <div className="grid grid-cols-2 gap-4">
                {/* Employee Number */}
                <div>
                  <label className="label">
                    Employee Number
                    {!editing && empNumConfig.mode === 'auto' && (
                      <span className="ml-2 text-xs font-normal text-emerald-600">(auto: {empNumConfig.next_number || '…'})</span>
                    )}
                  </label>
                  {(!editing && empNumConfig.mode === 'auto') ? (
                    <input className="input bg-gray-50 font-mono" value={empNumConfig.next_number || '—'} disabled
                      title="Auto-generated on hire. Configure in Settings → Employee Numbers." />
                  ) : (
                    <input className="input font-mono" value={form.employee_number || ''}
                      onChange={e => setForm(f => ({ ...f, employee_number: e.target.value.toUpperCase() }))}
                      placeholder="e.g. EMP-0042"
                      disabled={!!editing} // can't rename after creation
                    />
                  )}
                  {editing && form.employee_number && (
                    <p className="text-xs text-gray-400 mt-1">Employee number cannot be changed after creation.</p>
                  )}
                </div>

                {/* Date of Birth */}
                <div>
                  <label className="label">Date of Birth</label>
                  <input type="date" className="input" value={form.date_of_birth || ''}
                    onChange={e => setForm(f => ({ ...f, date_of_birth: e.target.value }))} />
                  <p className="text-xs text-gray-400 mt-1">Used for duplicate detection if enabled.</p>
                </div>

                {/* SSN — new hires only */}
                {!editing && (
                  <div className="col-span-2">
                    <label className="label">SSN (Social Security Number)</label>
                    <input
                      type="password"
                      autoComplete="off"
                      className="input font-mono tracking-widest"
                      value={form.ssn || ''}
                      onChange={e => setForm(f => ({ ...f, ssn: e.target.value }))}
                      placeholder="e.g. 123-45-6789 — stored as a secure hash"
                      maxLength={11}
                    />
                    <p className="text-xs text-gray-400 mt-1">Only the last 4 digits are stored for display. The full number is hashed for duplicate detection.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Custom Fields */}
            {customFieldDefs.length > 0 && (
              <div className="border-t border-gray-100 pt-4 mt-2">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Custom Fields</h4>
                <div className="grid grid-cols-2 gap-4">
                  {customFieldDefs.map(field => (
                    <div key={field.field_key} className={field.field_type === 'rich_text' ? 'col-span-2' : ''}>
                      <CustomFieldRenderer
                        field={field}
                        value={customFieldValues[field.field_key]}
                        onChange={handleCfChange}
                        errors={cfErrors}
                        allValues={customFieldValues}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button type="submit" className="btn-primary flex-1">{editing ? 'Save Changes' : 'Add Employee'}</button>
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Duplicate Detected Modal */}
      {dupDuplicates && (
        <DuplicateDetectedModal
          duplicates={dupDuplicates}
          onContinueNew={handleContinueNew}
          onRehire={handleRehire}
          onClose={() => { setDupDuplicates(null); setPendingPayload(null); }}
        />
      )}
    </div>
  );
}
