import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const API = import.meta.env.VITE_API_URL || '';

const BILLING_MODELS = [
  { value: 'hourly',     label: '⏱ Hourly' },
  { value: 'retainer',   label: '📅 Retainer' },
  { value: 'fixed_fee',  label: '🔒 Fixed Fee' },
  { value: 'milestone',  label: '🏁 Milestone' },
];

const STATUS_COLORS = {
  active:    'bg-green-100 text-green-800',
  on_hold:   'bg-yellow-100 text-yellow-800',
  completed: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-red-100 text-red-800',
};

function fmt(n) { return n !== null && n !== undefined ? Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 }) : '—'; }
function fmtCurrency(n, sym = '$') { return n !== null && n !== undefined ? `${sym}${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'; }

// ─── Project Modal ──────────────────────────────────────────────────────────
function ProjectModal({ project, clients, adminUsers, onSave, onClose }) {
  const isEdit = !!project?.id;
  const [form, setForm] = useState({
    client_id: project?.client_id || '',
    name: project?.name || '',
    code: project?.code || '',
    description: project?.description || '',
    billing_model: project?.billing_model || 'hourly',
    budget_hours: project?.budget_hours || '',
    budget_amount: project?.budget_amount || '',
    retainer_amount: project?.retainer_amount || '',
    retainer_period: project?.retainer_period || 'monthly',
    po_number: project?.po_number || '',
    contract_start: project?.contract_start?.slice(0, 10) || '',
    contract_end: project?.contract_end?.slice(0, 10) || '',
    project_manager_id: project?.project_manager_id || '',
    status: project?.status || 'active',
    tags: project?.tags || '',
    notes: project?.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.client_id || !form.name) { setError('Client and project name are required'); return; }
    setSaving(true); setError('');
    try {
      const token = localStorage.getItem('token');
      const url = isEdit ? `${API}/api/projects/${project.id}` : `${API}/api/projects`;
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      onSave(data);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const Field = ({ label, children, half }) => (
    <div className={half ? 'w-full md:w-1/2 px-2 mb-3' : 'w-full px-2 mb-3'}>
      <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
  const inputCls = 'w-full border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';
  const selCls = 'w-full border rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-800">{isEdit ? 'Edit Project' : 'New Project'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-4 py-4">
          {error && <div className="mx-2 mb-3 bg-red-50 text-red-700 border border-red-200 rounded p-2 text-sm">{error}</div>}
          <div className="flex flex-wrap -mx-2">
            <Field label="Client *">
              <select className={selCls} value={form.client_id} onChange={e => set('client_id', e.target.value)} required>
                <option value="">— Select client —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Project Name *" half>
              <input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Website Redesign" required />
            </Field>
            <Field label="Project Code" half>
              <input className={inputCls} value={form.code} onChange={e => set('code', e.target.value)} placeholder="e.g. PROJ-001" />
            </Field>
            <Field label="Description">
              <textarea className={inputCls} rows={2} value={form.description} onChange={e => set('description', e.target.value)} />
            </Field>
            <Field label="Billing Model" half>
              <select className={selCls} value={form.billing_model} onChange={e => set('billing_model', e.target.value)}>
                {BILLING_MODELS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
              </select>
            </Field>
            <Field label="Status" half>
              <select className={selCls} value={form.status} onChange={e => set('status', e.target.value)}>
                <option value="active">Active</option>
                <option value="on_hold">On Hold</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </Field>

            {form.billing_model === 'hourly' && <>
              <Field label="Budget Hours" half>
                <input type="number" min="0" step="0.5" className={inputCls} value={form.budget_hours} onChange={e => set('budget_hours', e.target.value)} placeholder="e.g. 200" />
              </Field>
              <Field label="Budget Amount ($)" half>
                <input type="number" min="0" step="0.01" className={inputCls} value={form.budget_amount} onChange={e => set('budget_amount', e.target.value)} placeholder="e.g. 20000" />
              </Field>
            </>}
            {form.billing_model === 'fixed_fee' && <>
              <Field label="Fixed Fee Amount ($)" half>
                <input type="number" min="0" step="0.01" className={inputCls} value={form.budget_amount} onChange={e => set('budget_amount', e.target.value)} placeholder="e.g. 50000" />
              </Field>
              <Field label="Budget Hours" half>
                <input type="number" min="0" step="0.5" className={inputCls} value={form.budget_hours} onChange={e => set('budget_hours', e.target.value)} placeholder="Internal estimate" />
              </Field>
            </>}
            {form.billing_model === 'retainer' && <>
              <Field label="Retainer Amount ($)" half>
                <input type="number" min="0" step="0.01" className={inputCls} value={form.retainer_amount} onChange={e => set('retainer_amount', e.target.value)} placeholder="e.g. 5000" />
              </Field>
              <Field label="Retainer Period" half>
                <select className={selCls} value={form.retainer_period} onChange={e => set('retainer_period', e.target.value)}>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                </select>
              </Field>
            </>}

            <Field label="PO Number" half>
              <input className={inputCls} value={form.po_number} onChange={e => set('po_number', e.target.value)} placeholder="Purchase order #" />
            </Field>
            <Field label="Project Manager" half>
              <select className={selCls} value={form.project_manager_id} onChange={e => set('project_manager_id', e.target.value)}>
                <option value="">— None —</option>
                {adminUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label="Contract Start" half>
              <input type="date" className={inputCls} value={form.contract_start} onChange={e => set('contract_start', e.target.value)} />
            </Field>
            <Field label="Contract End" half>
              <input type="date" className={inputCls} value={form.contract_end} onChange={e => set('contract_end', e.target.value)} />
            </Field>
            <Field label="Tags">
              <input className={inputCls} value={form.tags} onChange={e => set('tags', e.target.value)} placeholder="e.g. strategy, consulting, phase-1" />
            </Field>
            <Field label="Notes">
              <textarea className={inputCls} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
            </Field>
          </div>
          <div className="flex gap-3 justify-end px-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded border text-gray-700 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="px-5 py-2 rounded bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Task Panel (inside project detail) ────────────────────────────────────
function TaskPanel({ projectId, tasks, onTasksChange }) {
  const [adding, setAdding] = useState(false);
  const [newTask, setNewTask] = useState({ name: '', estimated_hours: '', is_billable: true });
  const [saving, setSaving] = useState(false);

  const addTask = async () => {
    if (!newTask.name) return;
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API}/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(newTask),
      });
      const data = await res.json();
      if (res.ok) { onTasksChange([...tasks, data]); setNewTask({ name: '', estimated_hours: '', is_billable: true }); setAdding(false); }
    } finally { setSaving(false); }
  };

  const deleteTask = async (tid) => {
    if (!window.confirm('Delete this task?')) return;
    const token = localStorage.getItem('token');
    await fetch(`${API}/api/projects/${projectId}/tasks/${tid}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    onTasksChange(tasks.filter(t => t.id !== tid));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-gray-700">Tasks / Work Packages</span>
        <button onClick={() => setAdding(!adding)} className="text-xs text-blue-600 hover:underline">+ Add Task</button>
      </div>
      {adding && (
        <div className="flex gap-2 mb-3 items-end flex-wrap">
          <input
            className="border rounded px-2 py-1 text-sm flex-1 min-w-32"
            placeholder="Task name"
            value={newTask.name}
            onChange={e => setNewTask(t => ({ ...t, name: e.target.value }))}
          />
          <input
            type="number" min="0" step="0.5"
            className="border rounded px-2 py-1 text-sm w-24"
            placeholder="Est. hrs"
            value={newTask.estimated_hours}
            onChange={e => setNewTask(t => ({ ...t, estimated_hours: e.target.value }))}
          />
          <label className="flex items-center gap-1 text-xs text-gray-600">
            <input type="checkbox" checked={newTask.is_billable} onChange={e => setNewTask(t => ({ ...t, is_billable: e.target.checked }))} />
            Billable
          </label>
          <button onClick={addTask} disabled={saving} className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
            {saving ? '…' : 'Add'}
          </button>
          <button onClick={() => setAdding(false)} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
        </div>
      )}
      {tasks.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No tasks yet</p>
      ) : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-500 border-b">
            <th className="pb-1">Task</th><th className="pb-1">Est. Hrs</th><th className="pb-1">Billable</th><th className="pb-1">Status</th><th></th>
          </tr></thead>
          <tbody>
            {tasks.map(t => (
              <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-1.5 pr-2">{t.name}</td>
                <td className="py-1.5 pr-2 text-gray-600">{t.estimated_hours ? fmt(t.estimated_hours) : '—'}</td>
                <td className="py-1.5 pr-2">{t.is_billable ? <span className="text-green-600 text-xs">✓ Yes</span> : <span className="text-gray-400 text-xs">No</span>}</td>
                <td className="py-1.5 pr-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${t.status === 'active' ? 'bg-green-100 text-green-700' : t.status === 'completed' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                    {t.status}
                  </span>
                </td>
                <td className="py-1.5">
                  <button onClick={() => deleteTask(t.id)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Project Detail Drawer ──────────────────────────────────────────────────
function ProjectDetail({ projectId, onClose, onEdit }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [utilization, setUtilization] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const token = localStorage.getItem('token');
    const [projRes, utilRes] = await Promise.all([
      fetch(`${API}/api/projects/${projectId}`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API}/api/projects/${projectId}/utilization`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    if (projRes.ok) setData(await projRes.json());
    if (utilRes.ok) setUtilization(await utilRes.json());
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const updateTasks = (tasks) => setData(d => ({ ...d, tasks }));

  if (loading) return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40">
      <div className="bg-white rounded-xl p-8 shadow-2xl text-gray-500">Loading…</div>
    </div>
  );
  if (!data) return null;

  const u = utilization;
  const StatCard = ({ label, value, sub, color = 'blue' }) => (
    <div className="bg-white border rounded-lg p-3 text-center">
      <div className={`text-2xl font-bold text-${color}-600`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex justify-end z-40">
      <div className="bg-gray-50 w-full max-w-2xl h-full overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b sticky top-0 z-10">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-gray-800">{data.name}</h2>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[data.status] || 'bg-gray-100 text-gray-600'}`}>{data.status}</span>
            </div>
            <div className="text-xs text-gray-500">{data.client_name} {data.code ? `· ${data.code}` : ''}</div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => onEdit(data)} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50">Edit</button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none ml-2">&times;</button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Billing model badge */}
          <div className="flex flex-wrap gap-3 items-center text-sm">
            <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-xs font-medium">
              {BILLING_MODELS.find(b => b.value === data.billing_model)?.label || data.billing_model}
            </span>
            {data.po_number && <span className="text-gray-500">PO: {data.po_number}</span>}
            {data.contract_start && <span className="text-gray-500">{data.contract_start?.slice(0,10)} → {data.contract_end?.slice(0,10) || 'ongoing'}</span>}
          </div>

          {/* Stats */}
          {u && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Utilization" value={`${u.metrics.utilization_pct}%`} sub="billable / total hrs" color="blue" />
              <StatCard label="Approved Hrs" value={fmt(u.time.approved_hours)} sub="billable hours billed" color="green" />
              <StatCard label="Invoiced" value={fmtCurrency(u.billing.invoiced_total)} sub={`paid: ${fmtCurrency(u.billing.paid_total)}`} color="purple" />
              <StatCard
                label={data.budget_hours ? 'Budget Used' : 'Pending Hrs'}
                value={data.budget_hours ? `${u.metrics.budget_hours_used_pct ?? '—'}%` : fmt(u.time.pending_hours)}
                sub={data.budget_hours ? `of ${fmt(data.budget_hours)} hr budget` : 'awaiting approval'}
                color={u.metrics.budget_hours_used_pct > 90 ? 'red' : 'yellow'}
              />
            </div>
          )}

          {data.description && (
            <div className="bg-white border rounded-lg p-4">
              <div className="text-xs font-semibold text-gray-500 mb-1">DESCRIPTION</div>
              <p className="text-sm text-gray-700">{data.description}</p>
            </div>
          )}

          {/* Tasks */}
          <div className="bg-white border rounded-lg p-4">
            <TaskPanel projectId={data.id} tasks={data.tasks || []} onTasksChange={updateTasks} />
          </div>

          {/* People breakdown */}
          {u?.people?.length > 0 && (
            <div className="bg-white border rounded-lg p-4">
              <div className="text-sm font-semibold text-gray-700 mb-3">Team Time Breakdown</div>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500 border-b">
                  <th className="pb-1">Name</th><th className="pb-1">Role</th><th className="pb-1">Approved</th><th className="pb-1">Billable</th>
                </tr></thead>
                <tbody>
                  {u.people.map((p, i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-1.5 pr-2 font-medium">{p.name}</td>
                      <td className="py-1.5 pr-2 text-gray-500 text-xs">{p.role || '—'}</td>
                      <td className="py-1.5 pr-2">{fmt(p.approved_hours)} hrs</td>
                      <td className="py-1.5">{fmt(p.billable_hours)} hrs</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Projects Page ─────────────────────────────────────────────────────
export default function Projects() {
  const [projects, setProjects] = useState([]);
  const [clients, setClients] = useState([]);
  const [adminUsers, setAdminUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editProject, setEditProject] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [filterStatus, setFilterStatus] = useState('active');
  const [filterClient, setFilterClient] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const token = localStorage.getItem('token');
    const [pRes, cRes] = await Promise.all([
      fetch(`${API}/api/projects`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API}/api/clients`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    if (pRes.ok) setProjects(await pRes.json());
    if (cRes.ok) setClients(await cRes.json());
    // Admin users for PM selection
    const uRes = await fetch(`${API}/api/employees?role=admin`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    if (uRes?.ok) setAdminUsers(await uRes.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditProject(null); setShowModal(true); };
  const openEdit = (p) => { setEditProject(p); setShowModal(true); setDetailId(null); };

  const handleSave = (saved) => {
    setProjects(ps => {
      const idx = ps.findIndex(p => p.id === saved.id);
      return idx >= 0 ? ps.map(p => p.id === saved.id ? { ...p, ...saved } : p) : [saved, ...ps];
    });
    setShowModal(false);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Cancel this project?')) return;
    const token = localStorage.getItem('token');
    await fetch(`${API}/api/projects/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    setProjects(ps => ps.filter(p => p.id !== id));
  };

  const filtered = projects.filter(p => {
    if (filterStatus && filterStatus !== 'all' && p.status !== filterStatus) return false;
    if (filterClient && p.client_id !== parseInt(filterClient, 10)) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) &&
        !(p.client_name || '').toLowerCase().includes(search.toLowerCase()) &&
        !(p.code || '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Projects</h1>
          <p className="text-sm text-gray-500">Manage client projects, budgets, and tasks</p>
        </div>
        <button onClick={openNew} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 whitespace-nowrap">
          + New Project
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          className="border rounded-lg px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="Search projects…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="border rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="on_hold">On Hold</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          className="border rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
          value={filterClient}
          onChange={e => setFilterClient(e.target.value)}
        >
          <option value="">All Clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Active', val: projects.filter(p => p.status === 'active').length, color: 'green' },
          { label: 'On Hold', val: projects.filter(p => p.status === 'on_hold').length, color: 'yellow' },
          { label: 'Completed', val: projects.filter(p => p.status === 'completed').length, color: 'blue' },
          { label: 'Total Billed Hrs', val: fmt(projects.reduce((s, p) => s + parseFloat(p.billed_hours || 0), 0)), color: 'purple' },
        ].map(c => (
          <div key={c.label} className="bg-white border rounded-xl p-4 text-center">
            <div className={`text-2xl font-bold text-${c.color}-600`}>{c.val}</div>
            <div className="text-xs text-gray-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Projects table */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading projects…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 bg-white border rounded-xl text-gray-400">
          <div className="text-4xl mb-3">📁</div>
          <div className="text-lg font-medium">No projects found</div>
          <div className="text-sm">Create your first project to get started</div>
        </div>
      ) : (
        <div className="bg-white border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600">Project</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 hidden md:table-cell">Client</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 hidden lg:table-cell">Billing</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600">Hrs Used</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(p => {
                const budgetPct = p.budget_hours ? Math.min(100, Math.round((parseFloat(p.billed_hours || 0) / parseFloat(p.budget_hours)) * 100)) : null;
                return (
                  <tr key={p.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setDetailId(p.id)}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800">{p.name}</div>
                      {p.code && <div className="text-xs text-gray-400">{p.code}</div>}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-gray-600">{p.client_name}</td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">
                        {BILLING_MODELS.find(b => b.value === p.billing_model)?.label?.split(' ')[1] || p.billing_model}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="font-medium">{fmt(p.billed_hours)}</div>
                      {budgetPct !== null && (
                        <div className="mt-1 w-20 ml-auto">
                          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${budgetPct > 90 ? 'bg-red-500' : budgetPct > 70 ? 'bg-yellow-400' : 'bg-green-500'}`}
                              style={{ width: `${budgetPct}%` }}
                            />
                          </div>
                          <div className="text-xs text-gray-400 text-right mt-0.5">{budgetPct}%</div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[p.status] || 'bg-gray-100 text-gray-600'}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <button onClick={() => openEdit(p)} className="text-xs text-blue-600 hover:underline mr-3">Edit</button>
                      <button onClick={() => handleDelete(p.id)} className="text-xs text-red-500 hover:underline">Cancel</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <ProjectModal
          project={editProject}
          clients={clients}
          adminUsers={adminUsers}
          onSave={handleSave}
          onClose={() => setShowModal(false)}
        />
      )}
      {detailId && (
        <ProjectDetail
          projectId={detailId}
          onClose={() => setDetailId(null)}
          onEdit={(p) => { setDetailId(null); openEdit(p); }}
        />
      )}
    </div>
  );
}
