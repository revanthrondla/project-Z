import React, { useState, useEffect } from 'react';
import api from '../../api';

const SOURCE_COLORS = {
  LinkedIn: 'bg-blue-100 text-blue-700',
  Indeed: 'bg-purple-100 text-purple-700',
  Dice: 'bg-red-100 text-red-700',
  Glassdoor: 'bg-emerald-100 text-emerald-700',
  ZipRecruiter: 'bg-orange-100 text-orange-700',
};

function JobCard({ job }) {
  const sourceColor = SOURCE_COLORS[job.source] || 'bg-gray-100 text-gray-600';
  const postedDate = job.postedAt
    ? new Date(job.postedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 hover:border-emerald-300 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${sourceColor}`}>{job.source}</span>
            {job.isRemote && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">Remote</span>}
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">C2C</span>
          </div>
          <h3 className="text-sm font-semibold text-gray-900">{job.title}</h3>
          <p className="text-xs text-gray-500">{job.company}{job.location ? ` · ${job.location}` : ''}</p>
          {job.salary && <p className="text-xs font-medium text-emerald-700 mt-1">💰 {job.salary}</p>}
          {job.description && <p className="text-xs text-gray-400 mt-2 line-clamp-2">{job.description}</p>}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        {postedDate && <span className="text-xs text-gray-400">Posted {postedDate}</span>}
        <a href={job.applyLink} target="_blank" rel="noopener noreferrer"
          className="ml-auto btn-primary text-xs py-1.5 px-4">
          Apply →
        </a>
      </div>
    </div>
  );
}

export default function RecruiterC2CJobs() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeCandidateId, setActiveCandidateId] = useState(null);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get('/api/c2c-jobs/recruiter/all')
      .then(res => {
        setData(res.data);
        if (res.data.results?.length > 0) {
          setActiveCandidateId(res.data.results[0].candidate.id);
        }
      })
      .catch(err => setError(err.response?.data?.error || 'Failed to load jobs'))
      .finally(() => setLoading(false));
  }, []);

  const activeResult = data?.results?.find(r => r.candidate.id === activeCandidateId);

  const filteredJobs = (activeResult?.jobs || []).filter(j => {
    if (remoteOnly && !j.isRemote) return false;
    if (search) {
      const q = search.toLowerCase();
      return j.title.toLowerCase().includes(q) || j.company.toLowerCase().includes(q);
    }
    return true;
  });

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
      <p className="text-sm text-gray-500">Loading C2C jobs for your candidates…</p>
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">C2C Job Board</h1>
        <p className="text-sm text-gray-500 mt-0.5">Corp-to-Corp opportunities for your assigned candidates</p>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

      {(!data?.results || data.results.length === 0) ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">📭</div>
          <p className="text-sm font-medium text-gray-600">No in-market candidates assigned to you</p>
          <p className="text-xs mt-1">Ask your admin to assign candidates with "In Market" status.</p>
        </div>
      ) : (
        <div className="flex gap-6">
          {/* Candidate tabs — left sidebar */}
          <div className="w-56 shrink-0">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Candidates</p>
            <div className="space-y-1">
              {data.results.map(({ candidate, count }) => (
                <button
                  key={candidate.id}
                  onClick={() => { setActiveCandidateId(candidate.id); setSearch(''); }}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    activeCandidateId === candidate.id
                      ? 'bg-emerald-600 text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <div className="font-medium truncate">{candidate.name}</div>
                  <div className={`text-xs mt-0.5 ${activeCandidateId === candidate.id ? 'text-emerald-100' : 'text-gray-400'}`}>
                    {count} jobs
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Jobs panel */}
          <div className="flex-1 min-w-0">
            <div className="flex gap-3 mb-4">
              <input
                type="text"
                className="input flex-1 text-sm"
                placeholder="Filter jobs…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer whitespace-nowrap">
                <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-emerald-600"
                  checked={remoteOnly} onChange={e => setRemoteOnly(e.target.checked)} />
                Remote
              </label>
            </div>

            {activeResult && (
              <p className="text-xs text-gray-400 mb-3">
                {filteredJobs.length} of {activeResult.count} jobs for {activeResult.candidate.name}
                {activeResult.fromCache && ' · cached'}
              </p>
            )}

            {filteredJobs.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <p className="text-sm">No jobs match your filters.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredJobs.map(job => <JobCard key={job.id} job={job} />)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
