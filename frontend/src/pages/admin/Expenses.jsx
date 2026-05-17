import { useState, useEffect, useCallback } from 'react';
import api from '../../api';
import CustomFieldsPanel from '../../components/CustomFieldsPanel';
import CustomFieldsCreateSection, { saveCFValues } from '../../components/CustomFieldsCreateSection';

const API = import.meta.env.VITE_API_URL || '';

const CATEGORIES = [
  { value: 'travel',        label: '✈️ Travel',        icon: '✈️' },
  { value: 'mileage',       label: '🚗 Mileage',       icon: '🚗' },
  { value: 'meals',         label: '🍽️ Meals',          icon: '🍽️' },
  { value: 'accommodation', label: '🏨 Accommodation',  icon: '🏨' },
  { value: 'software',      label: '💻 Software',       icon: '💻' },
  { value: 'hardware',      label: '🖥️ Hardware',       icon: '🖥️' },
  { value: 'per_diem',      label: '💰 Per Diem',       icon: '💰' },
  { value: 'other',         label: '📎 Other',          icon: '📎' },
];

const STATUS_STYLES = {
  pending:  'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  invoiced: 'bg-blue-100 text-blue-800',
};

function fmtAmt(exp) {
  if (exp.category === 'mileage' && exp.mileage_miles) {
    const rate = parseFloat(exp.mileage_rate || 0.67);
    return `$${(parseFloat(exp.mileage_miles) * rate).toFixed(2)}`;
  }
  return exp.amount ? `$${parseFloat(exp.amount).toFixed(2)}` : '—';
}

// ─── Expense Modal ──────────────────────────────────────────────────────────
function ExpenseModal({ expense, employees = [], clients = [], projects = [], onSave, onClose, isAdmin }) {
  const isEdit = !!expense?.id;
  const [cfValues, setCfValues] = useState({});
  const [form, setForm] = useState({
    candidate_id: expense?.candidate_id || '',
    client_id: expense?.client_id || '',
    project_id: expense?.project_id || '',
    expense_date: expense?.expense_date?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    category: expense?.category || 'travel',
    description: expense?.description || '',
    amount: expense?.amount || '',
    mileage_miles: expense?.mileage_miles || '',
    mileage_rate: expense?.mileage_rate || '0.670',
    currency: expense?.currency || 'USD',
    is_billable: expense?.is_billable !== false,
    is_reimbursable: expense?.is_reimbursable !== false,
    receipt_url: expense?.receipt_url || '',
    notes: expense?.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Computed mileage total
  const mileageTotal = form.category === 'mileage' && form.mileage_miles
    ? (parseFloat(form.mileage_miles) * parseFloat(form.mileage_rate || 0.67)).toFixed(2)
    : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const token = localStorage.getItem('token');
      const url = isEdit ? `${API}/api/expenses/${expense.id}` : `${API}/api/expenses`;
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      if (!isEdit && data.id) await saveCFValues(api, 'expenses', data.id, cfValues);
      onSave(data);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const inputCls = 'w-full border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';
  const selCls = 'w-full border rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400';
  const Field = ({ label, children, half }) => (
    <div className={half ? 'w-full md:w-1/2 px-2 mb-3' : 'w-full px-2 mb-3'}>
      <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-800">{isEdit ? 'Edit Expense' : 'Log Expense'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-4 py-4">
          {error && <div className="mx-2 mb-3 bg-red-50 text-red-700 border border-red-200 rounded p-2 text-sm">{error}</div>}
          <div className="flex flex-wrap -mx-2">
            {isAdmin && (
              <Field label="Employee / Contractor *">
                <select className={selCls} value={form.candidate_id} onChange={e => set('candidate_id', e.target.value)} required>
                  <option value="">— Select person —</option>
                  {employees.map(c => <option key={c.id} value={c.id}>{c.name} ({c.role})</option>)}
                </select>
              </Field>
            )}
            <Field label="Date *" half>
              <input type="date" className={inputCls} value={form.expense_date} onChange={e => set('expense_date', e.target.value)} required />
            </Field>
            <Field label="Category *" half>
              <select className={selCls} value={form.category} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Description *">
              <input className={inputCls} value={form.description} onChange={e => set('description', e.target.value)} placeholder="What was this expense for?" required />
            </Field>

            {form.category === 'mileage' ? (
              <>
                <Field label="Miles Driven *" half>
                  <input type="number" min="0" step="0.1" className={inputCls} value={form.mileage_miles} onChange={e => set('mileage_miles', e.target.value)} placeholder="e.g. 45.5" required />
                </Field>
                <Field label="Rate per Mile" half>
                  <input type="number" min="0" step="0.001" className={inputCls} value={form.mileage_rate} onChange={e => set('mileage_rate', e.target.value)} />
                </Field>
                {mileageTotal && <div className="w-full px-2 mb-3 text-sm text-green-700 font-medium">Total: ${mileageTotal}</div>}
              </>
            ) : (
              <Field label="Amount ($) *" half>
                <input type="number" min="0" step="0.01" className={inputCls} value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" required />
              </Field>
            )}

            <Field label="Client" half>
              <select className={selCls} value={form.client_id} onChange={e => set('client_id', e.target.value)}>
                <option value="">— No client —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Project" half>
              <select className={selCls} value={form.project_id} onChange={e => set('project_id', e.target.value)}>
                <option value="">— No project —</option>
                {projects.filter(p => !form.client_id || p.client_id === parseInt(form.client_id)).map(p =>
                  <option key={p.id} value={p.id}>{p.name}</option>
                )}
              </select>
            </Field>

            <Field label="Receipt URL">
              <input className={inputCls} value={form.receipt_url} onChange={e => set('receipt_url', e.target.value)} placeholder="https://…" type="url" />
            </Field>
            <Field label="Notes">
              <textarea className={inputCls} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
            </Field>

            <div className="w-full px-2 mb-3 flex gap-6">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={form.is_billable} onChange={e => set('is_billable', e.target.checked)} className="rounded" />
                Billable to client
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={form.is_reimbursable} onChange={e => set('is_reimbursable', e.target.checked)} className="rounded" />
                Reimbursable
              </label>
            </div>
          </div>
          <div className="w-full px-2 mb-3">
            {isEdit && expense?.id
              ? <CustomFieldsPanel module="expenses" recordId={expense.id} />
              : <CustomFieldsCreateSection module="expenses" onValuesChange={setCfValues} />
            }
          </div>
          <div className="flex gap-3 justify-end px-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded border text-gray-700 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="px-5 py-2 rounded bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Log Expense'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Reject Modal ───────────────────────────────────────────────────────────
function RejectModal({ onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-3">Reject Expense</h3>
        <textarea
          className="w-full border rounded px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-red-400"
          rows={3} placeholder="Reason for rejection…"
          value={reason} onChange={e => setReason(e.target.value)}
        />
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 border rounded text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={() => reason && onConfirm(reason)} disabled={!reason}
            className="px-4 py-2 bg-red-600 text-white rounded font-semibold hover:bg-red-700 disabled:opacity-50">
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Expenses Page ─────────────────────────────────────────────────────
export default function Expenses() {
  const [expenses, setExpenses] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editExpense, setEditExpense] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterProject, setFilterProject] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    setIsAdmin(user.role === 'admin');

    const [eRes, candRes, cRes, pRes] = await Promise.all([
      fetch(`${API}/api/expenses`, { headers: { Authorization: `Bearer ${token}` } }),
      user.role === 'admin' ? fetch(`${API}/api/employees`, { headers: { Authorization: `Bearer ${token}` } }) : Promise.resolve(null),
      fetch(`${API}/api/clients`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API}/api/projects`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    if (eRes.ok) setExpenses(await eRes.json());
    if (candRes?.ok) setEmployees(await candRes.json());
    if (cRes.ok) setClients(await cRes.json());
    if (pRes.ok) setProjects(await pRes.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = (saved) => {
    setExpenses(es => {
      const idx = es.findIndex(e => e.id === saved.id);
      return idx >= 0 ? es.map(e => e.id === saved.id ? { ...e, ...saved } : e) : [saved, ...es];
    });
    setShowModal(false); setEditExpense(null);
  };

  const handleApprove = async (id) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/api/expenses/${id}/approve`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const updated = await res.json();
      setExpenses(es => es.map(e => e.id === id ? { ...e, ...updated } : e));
    }
  };

  const handleReject = async (id, reason) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/api/expenses/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ reason }),
    });
    if (res.ok) {
      const updated = await res.json();
      setExpenses(es => es.map(e => e.id === id ? { ...e, ...updated } : e));
    }
    setRejectTarget(null);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this expense?')) return;
    const token = localStorage.getItem('token');
    await fetch(`${API}/api/expenses/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    setExpenses(es => es.filter(e => e.id !== id));
  };

  const filtered = expenses.filter(e => {
    if (filterStatus && e.status !== filterStatus) return false;
    if (filterProject && e.project_id !== parseInt(filterProject, 10)) return false;
    return true;
  });

  // Summary totals
  const totalPending  = expenses.filter(e => e.status === 'pending').reduce((s, e) => s + (e.category === 'mileage' ? parseFloat(e.mileage_miles || 0) * parseFloat(e.mileage_rate || 0.67) : parseFloat(e.amount || 0)), 0);
  const totalApproved = expenses.filter(e => e.status === 'approved').reduce((s, e) => s + (e.category === 'mileage' ? parseFloat(e.mileage_miles || 0) * parseFloat(e.mileage_rate || 0.67) : parseFloat(e.amount || 0)), 0);
  const totalBillable = expenses.filter(e => e.status === 'approved' && e.is_billable).reduce((s, e) => s + (e.category === 'mileage' ? parseFloat(e.mileage_miles || 0) * parseFloat(e.mileage_rate || 0.67) : parseFloat(e.amount || 0)), 0);

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Expenses</h1>
          <p className="text-sm text-gray-500">Track reimbursable and client-billable expenses</p>
        </div>
        <button onClick={() => { setEditExpense(null); setShowModal(true); }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 whitespace-nowrap">
          + Log Expense
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Pending Approval', val: `$${totalPending.toFixed(2)}`, color: 'yellow', count: expenses.filter(e => e.status === 'pending').length },
          { label: 'Approved', val: `$${totalApproved.toFixed(2)}`, color: 'green', count: expenses.filter(e => e.status === 'approved').length },
          { label: 'Billable (Approved)', val: `$${totalBillable.toFixed(2)}`, color: 'blue', count: expenses.filter(e => e.status === 'approved' && e.is_billable).length },
        ].map(c => (
          <div key={c.label} className="bg-white border rounded-xl p-4">
            <div className={`text-xl font-bold text-${c.color}-600`}>{c.val}</div>
            <div className="text-xs text-gray-500 mt-0.5">{c.label}</div>
            <div className="text-xs text-gray-400">{c.count} expense{c.count !== 1 ? 's' : ''}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select className="border rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
          value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="invoiced">Invoiced</option>
        </select>
        <select className="border rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
          value={filterProject} onChange={e => setFilterProject(e.target.value)}>
          <option value="">All Projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* Expense list */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading expenses…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 bg-white border rounded-xl text-gray-400">
          <div className="text-4xl mb-3">🧾</div>
          <div className="text-lg font-medium">No expenses found</div>
          <div className="text-sm">Log your first expense to track reimbursements</div>
        </div>
      ) : (
        <div className="bg-white border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600">Date</th>
                {isAdmin && <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 hidden md:table-cell">Person</th>}
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600">Description</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 hidden lg:table-cell">Project</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600">Amount</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(exp => {
                const cat = CATEGORIES.find(c => c.value === exp.category);
                return (
                  <tr key={exp.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {exp.expense_date?.slice(0, 10)}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 hidden md:table-cell text-gray-700">
                        {exp.candidate_name}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span>{cat?.icon}</span>
                        <span className="font-medium text-gray-800">{exp.description}</span>
                      </div>
                      <div className="flex gap-2 mt-0.5">
                        {exp.is_billable && <span className="text-xs text-blue-500">Billable</span>}
                        {exp.is_reimbursable && <span className="text-xs text-green-500">Reimbursable</span>}
                        {exp.receipt_url && <a href={exp.receipt_url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:underline" onClick={e => e.stopPropagation()}>Receipt</a>}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-gray-500 text-xs">
                      {exp.project_name || exp.client_name || '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-800">
                      {fmtAmt(exp)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[exp.status] || 'bg-gray-100 text-gray-600'}`}>
                        {exp.status}
                      </span>
                      {exp.rejected_reason && (
                        <div className="text-xs text-red-500 mt-0.5 max-w-xs truncate" title={exp.rejected_reason}>{exp.rejected_reason}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {isAdmin && exp.status === 'pending' && (
                        <>
                          <button onClick={() => handleApprove(exp.id)}
                            className="text-xs text-green-600 hover:underline mr-2">Approve</button>
                          <button onClick={() => setRejectTarget(exp.id)}
                            className="text-xs text-red-500 hover:underline mr-2">Reject</button>
                        </>
                      )}
                      {exp.status === 'pending' && (
                        <>
                          <button onClick={() => { setEditExpense(exp); setShowModal(true); }}
                            className="text-xs text-blue-600 hover:underline mr-2">Edit</button>
                          <button onClick={() => handleDelete(exp.id)}
                            className="text-xs text-red-500 hover:underline">Del</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <ExpenseModal
          expense={editExpense}
          employees={employees}
          clients={clients}
          projects={projects}
          isAdmin={isAdmin}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditExpense(null); }}
        />
      )}
      {rejectTarget && (
        <RejectModal
          onConfirm={(reason) => handleReject(rejectTarget, reason)}
          onClose={() => setRejectTarget(null)}
        />
      )}
    </div>
  );
}
