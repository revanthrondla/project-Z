import React, { useState, useEffect } from 'react';
import api from '../../api';

const APP_STATUS_COLORS = {
  applied: 'bg-blue-100 text-blue-700',
  reviewing: 'bg-yellow-100 text-yellow-700',
  shortlisted: 'bg-purple-100 text-purple-700',
  rejected: 'bg-red-100 text-red-700',
  hired: 'bg-green-100 text-green-700',
};

const APP_STATUS_LABELS = {
  applied: '📋 Applied',
  reviewing: '🔍 Under Review',
  shortlisted: '⭐ Shortlisted',
  rejected: '❌ Not Selected',
  hired: '🎉 Hired',
};

export default function CandidateJobs() {
  const [tab, setTab] = useState('browse'); // 'browse' | 'my-applications'
  const [jobs, setJobs] = useState([]);
  const [myApplications, setMyApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState(null);
  const [coverLetter, setCoverLetter] = useState('');
  const [applying, setApplying] = useState(false);
  const [applySuccess, setApplySuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { fetchJobs(); fetchMyApplications(); }, []);

  async function fetchJobs() {
    setLoading(true);
    try {
      const res = await api.get('/api/jobs');
      setJobs(res.data);
    } catch { setError('Failed to load jobs'); }
    setLoading(false);
  }

  async function fetchMyApplications() {
    try {
      const res = await api.get('/api/jobs/my/applications');
      setMyApplications(res.data);
    } catch {}
  }

  async function openJob(job) {
    try {
      const res = await api.get(`/api/jobs/${job.id}`);
      setSelectedJob(res.data);
      setCoverLetter('');
      setApplySuccess(false);
    } catch { setSelectedJob(job); }
  }

  async function handleApply(e) {
    e.preventDefault();
    setApplying(true);
    setError('');
    try {
      await api.post(`/api/jobs/${selectedJob.id}/apply`, { cover_letter: coverLetter });
      setApplySuccess(true);
      fetchMyApplications();
      // Update local job to show applied
      setSelectedJob(prev => ({ ...prev, my_application: { status: 'applied' } }));
      setJobs(prev => prev.map(j => j.id === selectedJob.id ? { ...j, my_application: { status: 'applied' } } : j));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to apply');
    }
    setApplying(false);
  }

  const appliedJobIds = new Set(myApplications.map(a => a.job_id));

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div></div>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Jobs</h1>
        <p className="text-sm text-gray-500 mt-1">Browse open positions and track your applications</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit mb-6">
        {[['browse', '💼 Browse Jobs'], ['my-applications', `📋 My Applications (${myApplications.length})`]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'browse' && (
        <div className="flex gap-6">
          {/* Job list */}
          <div className={`${selectedJob ? 'w-1/2' : 'w-full'} transition-all`}>
            {jobs.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <div className="text-4xl mb-3">💼</div>
                <p className="text-gray-500">No open positions right now. Check back soon!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {jobs.map(job => {
                  const applied = appliedJobIds.has(job.id);
                  return (
                    <div
                      key={job.id}
                      onClick={() => openJob(job)}
                      className={`bg-white rounded-xl border p-4 cursor-pointer transition-all ${selectedJob?.id === job.id ? 'border-blue-400 shadow-md' : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-gray-900">{job.title}</h3>
                            {applied && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">✓ Applied</span>}
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
                                <span key={s} className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full">{s}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Job detail / apply panel */}
          {selectedJob && (
            <div className="w-1/2">
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden sticky top-0">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <h2 className="font-semibold text-gray-900 truncate">{selectedJob.title}</h2>
                  <button onClick={() => setSelectedJob(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none ml-2 shrink-0">×</button>
                </div>
                <div className="p-5 space-y-4">
                  {/* Job metadata */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {selectedJob.client_name && <div><p className="text-xs text-gray-400 mb-0.5">Client</p><p className="font-medium">{selectedJob.client_name}</p></div>}
                    {selectedJob.location && <div><p className="text-xs text-gray-400 mb-0.5">Location</p><p className="font-medium">{selectedJob.location}</p></div>}
                    <div><p className="text-xs text-gray-400 mb-0.5">Contract</p><p className="font-medium capitalize">{selectedJob.contract_type}</p></div>
                    {(selectedJob.hourly_rate_min || selectedJob.hourly_rate_max) && (
                      <div><p className="text-xs text-gray-400 mb-0.5">Rate</p><p className="font-medium">${selectedJob.hourly_rate_min || '?'}–${selectedJob.hourly_rate_max || '?'}/hr</p></div>
                    )}
                  </div>

                  {selectedJob.description && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Description</p>
                      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{selectedJob.description}</p>
                    </div>
                  )}

                  {selectedJob.skills && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Required Skills</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedJob.skills.split(',').map(s => s.trim()).filter(Boolean).map(s => (
                          <span key={s} className="bg-blue-50 text-blue-700 text-xs px-2.5 py-1 rounded-full font-medium">{s}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Apply or status */}
                  {selectedJob.my_application ? (
                    <div className={`rounded-xl p-4 text-center ${APP_STATUS_COLORS[selectedJob.my_application.status]}`}>
                      <p className="font-semibold text-base">{APP_STATUS_LABELS[selectedJob.my_application.status]}</p>
                      <p className="text-xs mt-1 opacity-80">
                        {selectedJob.my_application.status === 'applied' && 'Your application is awaiting review'}
                        {selectedJob.my_application.status === 'reviewing' && 'The team is reviewing your application'}
                        {selectedJob.my_application.status === 'shortlisted' && "You've been shortlisted — expect to hear soon!"}
                        {selectedJob.my_application.status === 'rejected' && 'Thank you for applying. Keep looking!'}
                        {selectedJob.my_application.status === 'hired' && 'Welcome aboard!'}
                      </p>
                    </div>
                  ) : applySuccess ? (
                    <div className="bg-green-50 text-green-700 rounded-xl p-4 text-center">
                      <p className="font-semibold">🎉 Application submitted!</p>
                      <p className="text-xs mt-1">We'll notify you when the status changes</p>
                    </div>
                  ) : (
                    <form onSubmit={handleApply} className="space-y-3 border-t border-gray-100 pt-4">
                      <p className="text-sm font-medium text-gray-700">Apply for this role</p>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Cover note (optional)</label>
                        <textarea
                          rows={3}
                          value={coverLetter}
                          onChange={e => setCoverLetter(e.target.value)}
                          placeholder="Briefly introduce yourself and why you're a great fit…"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
                        />
                      </div>
                      {error && <p className="text-red-600 text-xs">{error}</p>}
                      <button type="submit" disabled={applying} className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-60">
                        {applying ? 'Submitting…' : 'Submit Application'}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'my-applications' && (
        <div>
          {myApplications.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <div className="text-4xl mb-3">📋</div>
              <p className="text-gray-500">You haven't applied to any jobs yet.</p>
              <button onClick={() => setTab('browse')} className="mt-4 text-blue-600 text-sm font-medium hover:underline">Browse open positions →</button>
            </div>
          ) : (
            <div className="space-y-3">
              {myApplications.map(app => (
                <div key={app.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-gray-900">{app.job_title}</h3>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-gray-500">
                        {app.client_name && <span>🏢 {app.client_name}</span>}
                        {app.location && <span>📍 {app.location}</span>}
                        <span>🔖 {app.contract_type}</span>
                        <span>📅 Applied {new Date(app.applied_at).toLocaleDateString()}</span>
                      </div>
                      {app.cover_letter && <p className="text-sm text-gray-600 mt-2 italic">"{app.cover_letter}"</p>}
                    </div>
                    <span className={`shrink-0 text-xs font-medium px-3 py-1 rounded-full ${APP_STATUS_COLORS[app.status]}`}>
                      {APP_STATUS_LABELS[app.status]}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
