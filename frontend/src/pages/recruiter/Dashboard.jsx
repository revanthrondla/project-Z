import React, { useState, useEffect } from 'react';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';

export default function RecruiterDashboard() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/api/recruiters/me'),
      api.get('/api/c2c-jobs/recruiter/all'),
    ]).then(([profileRes, jobsRes]) => {
      setProfile(profileRes.data);
      // Count total jobs across all candidates
      const total = (jobsRes.data.results || []).reduce((sum, r) => sum + r.count, 0);
      setAssignments({ results: jobsRes.data.results || [], totalJobs: total });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const MARKET_LABELS = {
    employed: { label: 'Employed', color: 'text-gray-500' },
    in_market: { label: 'In Market', color: 'text-green-600' },
    about_to_be_in_market: { label: 'Available Soon', color: 'text-amber-600' },
  };

  if (loading) {
    return <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" /></div>;
  }

  const candidateResults = assignments.results || [];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Welcome, {user?.name}</h1>
        <p className="text-sm text-gray-500 mt-0.5">Your recruiting dashboard</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Assigned Candidates', value: profile?.assignment_count ?? 0, icon: '👤' },
          { label: 'Total C2C Jobs Found', value: assignments.totalJobs ?? 0, icon: '💼' },
          { label: 'In Market Now', value: (candidateResults ?? []).filter(r => r.candidate.market_status === 'in_market').length, icon: '🟢' },
        ].map(stat => (
          <div key={stat.label} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="text-2xl mb-1">{stat.icon}</div>
            <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Candidate job matches */}
      <h2 className="text-base font-semibold text-gray-800 mb-4">Candidates & C2C Matches</h2>
      {candidateResults.length === 0 ? (
        <div className="text-center py-12 text-gray-400 bg-white rounded-xl border border-gray-200">
          <div className="text-3xl mb-2">🕵️</div>
          <p className="text-sm">No in-market candidates assigned yet.</p>
          <p className="text-xs mt-1">Ask your admin to assign candidates to you.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {candidateResults.map(({ candidate, count, jobs }) => {
            const mkt = MARKET_LABELS[candidate.market_status] || MARKET_LABELS.employed;
            return (
              <div key={candidate.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                  <div>
                    <span className="font-medium text-gray-900">{candidate.name}</span>
                    <span className="text-xs text-gray-400 ml-2">{candidate.job_title}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-medium ${mkt.color}`}>{mkt.label}</span>
                    <span className="text-xs bg-emerald-100 text-emerald-700 font-semibold px-2 py-0.5 rounded-full">
                      {count} job{count !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                {jobs.slice(0, 3).map(job => (
                  <div key={job.id} className="flex items-center justify-between px-5 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{job.title}</p>
                      <p className="text-xs text-gray-500">{job.company} · {job.isRemote ? 'Remote' : job.location}</p>
                    </div>
                    <a href={job.applyLink} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-emerald-600 hover:text-emerald-700 font-medium whitespace-nowrap ml-4">
                      Apply →
                    </a>
                  </div>
                ))}
                {count > 3 && (
                  <div className="px-5 py-2 text-xs text-gray-400">
                    + {count - 3} more jobs — <a href={`/recruiter/jobs?candidate=${candidate.id}`} className="text-emerald-600">view all</a>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
