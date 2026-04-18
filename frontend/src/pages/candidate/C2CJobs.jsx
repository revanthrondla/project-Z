import React, { useState, useEffect } from 'react';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';

const SOURCE_COLORS = {
  LinkedIn:   'bg-blue-100 text-blue-700',
  Indeed:     'bg-purple-100 text-purple-700',
  Dice:       'bg-red-100 text-red-700',
  Glassdoor:  'bg-emerald-100 text-emerald-700',
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
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${sourceColor}`}>{job.source}</span>
            {job.isRemote && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">Remote</span>
            )}
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">C2C</span>
          </div>
          <h3 className="text-base font-semibold text-gray-900 leading-tight">{job.title}</h3>
          <p className="text-sm text-gray-600 mt-0.5">{job.company}</p>
          {job.location && (
            <p className="text-xs text-gray-400 mt-0.5">📍 {job.location}</p>
          )}
        </div>
        {job.employerLogo && (
          <img src={job.employerLogo} alt={job.company} className="w-10 h-10 rounded-lg object-contain border border-gray-100 shrink-0" />
        )}
      </div>

      {job.salary && (
        <div className="mt-3 text-sm font-medium text-emerald-700">💰 {job.salary}</div>
      )}

      {job.description && (
        <p className="mt-3 text-xs text-gray-500 line-clamp-2 leading-relaxed">{job.description}</p>
      )}

      <div className="mt-4 flex items-center justify-between">
        {postedDate && <span className="text-xs text-gray-400">Posted {postedDate}</span>}
        <a
          href={job.applyLink}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto btn-primary text-sm py-2 px-5"
        >
          Apply →
        </a>
      </div>
    </div>
  );
}

export default function C2CJobs() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get('/api/c2c-jobs/me')
      .then(res => setData(res.data))
      .catch(err => setError(err.response?.data?.error || 'Failed to load jobs'))
      .finally(() => setLoading(false));
  }, []);

  const filteredJobs = (data?.jobs || []).filter(j => {
    if (remoteOnly && !j.isRemote) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        j.title.toLowerCase().includes(q) ||
        j.company.toLowerCase().includes(q) ||
        (j.description || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
        <p className="text-sm text-gray-500">Searching C2C jobs matching your profile…</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">C2C Job Board</h1>
        <p className="text-sm text-gray-500 mt-1">
          Corp-to-Corp opportunities matched to your skills and experience from LinkedIn, Indeed, Dice, and more.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      {data && (
        <div className="mb-5 flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            className="input flex-1"
            placeholder="Filter by title, company, or keyword…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-emerald-600 cursor-pointer"
              checked={remoteOnly}
              onChange={e => setRemoteOnly(e.target.checked)}
            />
            Remote only
          </label>
        </div>
      )}

      {/* Info bar */}
      {data && (
        <div className="mb-4 flex items-center gap-3 text-xs text-gray-500">
          <span>
            {filteredJobs.length} of {data.count} job{data.count !== 1 ? 's' : ''} found
          </span>
          {data.fromCache && <span className="text-gray-400">· from cache</span>}
          <span>· Matching: <em className="text-gray-600">{data.candidate?.role}</em></span>
        </div>
      )}

      {filteredJobs.length === 0 && !loading && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">🔍</div>
          <p className="text-sm font-medium text-gray-600">No C2C jobs found</p>
          <p className="text-xs mt-1">
            {data?.count === 0
              ? 'Make sure your resume has skills listed so we can match jobs for you.'
              : 'Try adjusting your filters.'}
          </p>
        </div>
      )}

      <div className="space-y-4">
        {filteredJobs.map(job => <JobCard key={job.id} job={job} />)}
      </div>
    </div>
  );
}
