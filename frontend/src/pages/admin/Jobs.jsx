import React, { useState, useEffect } from 'react';
import api from '../../api';

const CONTRACT_TYPES = ['contractor', 'employee', 'part-time'];
const STATUS_OPTIONS = ['open', 'draft', 'closed'];
const APP_STATUS_OPTIONS = ['applied', 'reviewing', 'shortlisted', 'rejected', 'hired'];

const APP_STATUS_COLORS = {
  applied: 'bg-blue-100 text-emerald-700',
  reviewing: 'bg-yellow-100 text-yellow-700',
  shortlisted: 'bg-purple-100 text-purple-700',
  rejected: 'bg-red-100 text-red-700',
  hired: 'bg-green-100 text-green-700',
};

const JOB_STATUS_COLORS = {
  open: 'bg-green-100 text-green-700',
  draft: 'bg-gray-100 text-gray-600',
  closed: 'bg-red-100 text-red-600',
};

const emptyForm = { title: '', description: '', skills: '', client_id: '', location: '', contract_type: 'contractor', hourly_rate_min: '', hourly_rate_max: '', status: 'open' };

export default function AdminJobs() {
  const [jobs, setJobs] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editJob, setEditJob] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const [applications, setApplications] = useState([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchJobs();
    fetchClients();
  }, []);

  async function fetchJobs() {
    setLoading(true);
    try {
      const res = await api.get('/api/jobs');
      setJobs(res.data);
    } catch { setError('Failed to load jobs'); }
    setLoading(false);
  }

  async function fetchClients() {
    try {
      const res = await api.get('/api/clients');
      setClients(res.data);
    } catch {}
  }

  async function viewApplications(job) {
    setSelectedJob(job);
    setAppsLoading(true);
    try {
      const res = await api.get(`/api/jobs/${job.id}`);
      setApplications(res.data.applications || []);
    } catch { setApplications([]); }
    setAppsLoading(false);
  }

  async function updateAppStatus(appId, status) {
    try {
      await api.put(`/api/jobs/${selectedJob.id}/applications/${appId}`, { status });
      setApplications(prev => prev.map(a => a.id === appId ? { ...a, status } : a));
    } catch { alert('Failed to update status'); }
  }

  function openCreate() {
    setEditJob(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEdit(job) {
    setEditJob(job);
    setForm({
      title: job.title || '',
      description: job.description || '',
      skills: job.skills || '',
      client_id: job.client_id || '',
      location: job.location || '',
      contract_type: job.contract_type || 'contractor',
      hourly_rate_min: job.hourly_rate_min || '',
      hourly_rate_max: job.hourly_rate_max || '',
      status: job.status || 'open',
    });
    setShowForm(true);
    setSelectedJob(null);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        client_id: form.client_id || null,
        hourly_rate_min: form.hourly_rate_min ? parseFloat(form.hourly_rate_min) : null,
        hourly_rate_max: form.hourly_rate_max ? parseFloat(form.hourly_rate_max) : null,
      };
      if (editJob) {
        await api.put(`/api/jobs/${editJob.id}`, payload);
      } else {
        await api.post('/api/jobs', payload);
      }
      setShowForm(false);
      fetchJobs();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save job');
    }
    setSaving(false);
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this job posting?')) return;
    try {
      await api.delete(`/api/jobs/${id}`);
      setJobs(prev => prev.filter(j => j.id !== id));
      if (selectedJob?.id === id) setSelectedJob(null);
    } catch { alert('Failed to delete'); }
  }

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600"></div></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Job Postings</h1>
          <p className="text-sm text-gray-500 mt-1">Create and manage open positions</p>
        </div>
        <button onClick={openCreate} className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors">
          + New Job
        </button>
      </div>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">{error}</div>}

      {/* Job list + application panel side by side */}
      <div className="flex gap-6">
        {/* Job list */}
        <div className={`${selectedJob ? 'w-1/2' : 'w-full'} transition-all`}>
          {jobs.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <div className="text-4xl mb-3">💼</div>
              <p className="text-gray-500">No job postings yet. Create your first one!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {jobs.map(job => (
                <div
                  key={job.id}
                  className={`bg-white rounded-xl border p-4 transition-all cursor-pointer ${selectedJob?.id === job.id ? 'border-blue-400 shadow-md' : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'}`}
                  onClick={() => viewApplications(job)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-gray-900">{job.title}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${JOB_STATUS_COLORS[job.status]}`}>{job.status}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-gray-500">
                        {job.client_name && <span>🏢 {job.client_name}</span>}
                        {job.location && <span>📍 {job.location}</span>}
                        <span>🔖 {job.contract_type}</span>
                        {(job.hourly_rate_min || job.hourly_rate_max) && (
                          <span>💰 ${job.hourly_rate_min || '?'}–${job.hourly_rate_max || '?'}/hr</span>
                        )}
                      </div>
                      {job.skills && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {job.skills.split(',').map(s => s.trim()).filter(Boolean).map(s => (
                            <span key={s} className="bg-emerald-50 text-emerald-700 text-xs px-2 py-0.5 rounded-full">{s}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-lg">
                        {job.application_count} applicant{job.application_count !== 1 ? 's' : ''}
                      </span>
                      <button onClick={e => { e.stopPropagation(); openEdit(job); }} className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">✏️</button>
                      <button onClick={e => { e.stopPropagation(); handleDelete(job.id); }} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">🗑️</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Applications panel */}
        {selectedJob && (
          <div className="w-1/2">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <h2 className="font-semibold text-gray-900">Applications — {selectedJob.title}</h2>
                <button onClick={() => setSelectedJob(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
              </div>
              {appsLoading ? (
                <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-600"></div></div>
              ) : applications.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">No applications yet</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {applications.map(app => (
                    <div key={app.id} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-gray-900">{app.candidate_name}</p>
                          <p className="text-xs text-gray-500">{app.candidate_email} · {app.candidate_role}</p>
                          <p className="text-xs text-gray-400 mt-0.5">Applied {new Date(app.applied_at).toLocaleDateString()}</p>
                          {app.cover_letter && <p className="text-sm text-gray-600 mt-2 italic">"{app.cover_letter}"</p>}
                        </div>
                        <div className="shrink-0">
                          <select
                            value={app.status}
                            onChange={e => updateAppStatus(app.id, e.target.value)}
                            className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer ${APP_STATUS_COLORS[app.status]}`}
                          >
                            {APP_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">{editJob ? 'Edit Job Posting' : 'New Job Posting'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Job Title *</label>
                <input required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Senior React Developer" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Role overview, responsibilities, requirements…" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Skills (comma-separated)</label>
                <input value={form.skills} onChange={e => setForm(f => ({ ...f, skills: e.target.value }))} placeholder="e.g. React, TypeScript, Node.js" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Client</label>
                  <select value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none bg-white">
                    <option value="">No client</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                  <input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Remote, New York" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contract Type</label>
                  <select value={form.contract_type} onChange={e => setForm(f => ({ ...f, contract_type: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none bg-white">
                    {CONTRACT_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none bg-white">
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Min Rate ($/hr)</label>
                  <input type="number" min="0" step="0.01" value={form.hourly_rate_min} onChange={e => setForm(f => ({ ...f, hourly_rate_min: e.target.value }))} placeholder="50" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max Rate ($/hr)</label>
                  <input type="number" min="0" step="0.01" value={form.hourly_rate_max} onChange={e => setForm(f => ({ ...f, hourly_rate_max: e.target.value }))} placeholder="120" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none" />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-emerald-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-60">
                  {saving ? 'Saving…' : editJob ? 'Save Changes' : 'Create Job'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
