/**
 * My Data — Employee/Candidate Self-Service GDPR/CCPA Portal
 *
 * Allows employees to:
 *  - Submit data access, portability, erasure, and correction requests
 *  - Track the status of their submitted requests
 *  - Download a full export of their personal data
 *
 * Backend endpoints used:
 *  POST   /api/privacy/requests          — submit a request
 *  GET    /api/privacy/requests          — list own requests (filtered by employeeId)
 *  GET    /api/privacy/export/:empId     — download JSON export
 */
import { useState, useEffect, useCallback } from 'react';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';

// ── Constants ─────────────────────────────────────────────────────────────────

const REQUEST_TYPES = [
  {
    id:          'access',
    label:       'Right to Access',
    icon:        '👁️',
    color:       'bg-blue-50 border-blue-200 text-blue-800',
    description: 'Request a copy of all personal data we hold about you (Art.15 GDPR / CCPA Right to Know).',
  },
  {
    id:          'portability',
    label:       'Right to Portability',
    icon:        '📦',
    color:       'bg-purple-50 border-purple-200 text-purple-800',
    description: 'Receive your data in a machine-readable format you can take to another service (Art.20 GDPR).',
  },
  {
    id:          'erasure',
    label:       'Right to Erasure',
    icon:        '🗑️',
    color:       'bg-red-50 border-red-200 text-red-800',
    description: 'Request deletion of your personal data, subject to legal-hold obligations (Art.17 GDPR / CCPA).',
  },
  {
    id:          'correction',
    label:       'Right to Correction',
    icon:        '✏️',
    color:       'bg-amber-50 border-amber-200 text-amber-800',
    description: 'Ask us to correct inaccurate personal data we hold about you (Art.16 GDPR / CCPA).',
  },
  {
    id:          'restriction',
    label:       'Right to Restrict Processing',
    icon:        '⏸️',
    color:       'bg-orange-50 border-orange-200 text-orange-800',
    description: 'Ask us to pause processing your data while a dispute or complaint is resolved (Art.18 GDPR).',
  },
  {
    id:          'objection',
    label:       'Right to Object',
    icon:        '🚫',
    color:       'bg-gray-50 border-gray-200 text-gray-800',
    description: 'Object to processing based on legitimate interests or for direct marketing (Art.21 GDPR).',
  },
];

const STATUS_COLORS = {
  pending:    'bg-yellow-100 text-yellow-800',
  in_review:  'bg-blue-100 text-blue-800',
  completed:  'bg-green-100 text-green-800',
  rejected:   'bg-red-100 text-red-800',
};

const STATUS_LABELS = {
  pending:   'Pending',
  in_review: 'In Review',
  completed: 'Completed',
  rejected:  'Rejected',
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RequestCard({ type, onSelect }) {
  return (
    <button
      onClick={() => onSelect(type)}
      className={`w-full text-left p-4 rounded-xl border-2 transition-all hover:shadow-md hover:scale-[1.01] ${type.color}`}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl">{type.icon}</span>
        <div>
          <div className="font-semibold text-sm">{type.label}</div>
          <div className="text-xs mt-1 opacity-80 leading-relaxed">{type.description}</div>
        </div>
      </div>
    </button>
  );
}

function SubmitModal({ type, employeeId, onClose, onSubmitted }) {
  const [notes,   setNotes]   = useState('');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState(null);

  const handleSubmit = async e => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/privacy/requests', {
        candidate_id:  employeeId,
        request_type:  type.id,
        request_notes: notes || null,
        legal_basis:   'GDPR',
      });
      onSubmitted();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-3xl">{type.icon}</span>
          <div>
            <h3 className="font-bold text-gray-900">{type.label}</h3>
            <p className="text-xs text-gray-500">Submit your data rights request</p>
          </div>
        </div>

        <p className="text-sm text-gray-600 mb-4 leading-relaxed">{type.description}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Additional details <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Provide any specific details about your request…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 text-xs text-blue-700 leading-relaxed">
            ℹ️ We will respond to your request within <strong>30 days</strong> as required by GDPR Art.12.
            For erasure requests, note that data under legal hold cannot be deleted.
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium"
            >
              {saving ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RequestHistory({ requests, loading }) {
  if (loading) {
    return <div className="text-center text-gray-400 py-8 text-sm">Loading your requests…</div>;
  }
  if (!requests.length) {
    return (
      <div className="text-center py-10">
        <div className="text-4xl mb-3">📭</div>
        <p className="text-gray-500 text-sm">You haven't submitted any data requests yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {requests.map(r => {
        const typeInfo = REQUEST_TYPES.find(t => t.id === r.request_type);
        return (
          <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="text-xl">{typeInfo?.icon || '📋'}</span>
                <div>
                  <div className="font-medium text-gray-900 text-sm">
                    {typeInfo?.label || r.request_type}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    Submitted {fmtDate(r.created_at)}
                  </div>
                </div>
              </div>
              <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-700'}`}>
                {STATUS_LABELS[r.status] || r.status}
              </span>
            </div>

            {r.request_notes && (
              <div className="mt-3 text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                <span className="font-medium text-gray-700">Your notes: </span>
                {r.request_notes}
              </div>
            )}

            {r.response_notes && (
              <div className="mt-2 text-xs bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-green-800">
                <span className="font-medium">Response: </span>
                {r.response_notes}
              </div>
            )}

            {r.completed_at && (
              <div className="mt-2 text-xs text-gray-400">
                Completed on {fmtDate(r.completed_at)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function MyData() {
  const { user } = useAuth();
  const employeeId = user?.employeeId;

  const [activeTab,    setActiveTab]    = useState('rights');    // rights | history
  const [selectedType, setSelectedType] = useState(null);        // open modal
  const [requests,     setRequests]     = useState([]);
  const [loadingReqs,  setLoadingReqs]  = useState(true);
  const [downloading,  setDownloading]  = useState(false);
  const [dlError,      setDlError]      = useState(null);
  const [success,      setSuccess]      = useState(null);

  const loadRequests = useCallback(async () => {
    setLoadingReqs(true);
    try {
      // The backend filters by employeeId when role !== admin
      const r = await api.get('/privacy/requests');
      // Filter to own requests only in case backend doesn't scope
      const mine = r.data.filter(req =>
        req.candidate_id === employeeId || req.employee_id === employeeId
      );
      setRequests(mine);
    } catch (err) {
      console.error('Failed to load data requests', err.message);
    } finally {
      setLoadingReqs(false);
    }
  }, [employeeId]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  const handleSubmitted = () => {
    setSelectedType(null);
    setSuccess('Your request has been submitted. We will respond within 30 days.');
    setActiveTab('history');
    loadRequests();
    setTimeout(() => setSuccess(null), 6000);
  };

  const downloadData = async () => {
    if (!employeeId) return;
    setDownloading(true);
    setDlError(null);
    try {
      const resp = await api.get(`/privacy/export/${employeeId}`, { responseType: 'blob' });
      const url  = URL.createObjectURL(new Blob([resp.data], { type: 'application/json' }));
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `my-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDlError('Download failed. Please try again or contact your administrator.');
    } finally {
      setDownloading(false);
    }
  };

  const TABS = [
    { id: 'rights',  label: '⚖️ My Rights' },
    { id: 'history', label: `📋 My Requests (${requests.length})` },
  ];

  return (
    <div className="p-6 max-w-3xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Personal Data</h1>
        <p className="text-sm text-gray-500 mt-1">
          Exercise your data rights under GDPR and CCPA. All requests are handled within 30 days.
        </p>
      </div>

      {/* Success banner */}
      {success && (
        <div className="mb-4 p-4 bg-green-50 border border-green-300 rounded-xl text-green-800 text-sm font-medium">
          ✓ {success}
        </div>
      )}

      {/* Quick download card */}
      <div className="mb-6 bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200 rounded-2xl p-5 flex items-center justify-between gap-4">
        <div>
          <div className="font-semibold text-indigo-900 flex items-center gap-2">
            <span>📦</span> Download Your Data
          </div>
          <p className="text-xs text-indigo-700 mt-1">
            Get an immediate JSON export of all personal data we hold — time entries, absences, invoices, documents, and more.
          </p>
        </div>
        <div className="shrink-0">
          <button
            onClick={downloadData}
            disabled={downloading || !employeeId}
            className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
          >
            {downloading ? '⏳ Preparing…' : '⬇ Download JSON'}
          </button>
        </div>
      </div>
      {dlError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{dlError}</div>
      )}

      {/* Tab bar */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="flex border-b border-gray-200">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? 'border-indigo-500 text-indigo-700 bg-indigo-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6">

          {/* Rights tab */}
          {activeTab === 'rights' && (
            <div>
              <p className="text-sm text-gray-600 mb-5 leading-relaxed">
                Select a right below to submit a formal request. We will acknowledge your request within 72 hours
                and provide a full response within <strong>30 calendar days</strong>.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {REQUEST_TYPES.map(type => (
                  <RequestCard
                    key={type.id}
                    type={type}
                    onSelect={setSelectedType}
                  />
                ))}
              </div>

              {/* Info footer */}
              <div className="mt-6 p-4 bg-gray-50 rounded-xl border border-gray-200 text-xs text-gray-500 leading-relaxed">
                <p className="font-semibold text-gray-700 mb-1">📋 Legal basis for processing your data</p>
                <p>
                  Your personal data is processed under the lawful basis of <strong>contractual necessity</strong> (to
                  administer your employment), <strong>legal obligation</strong> (tax, payroll, compliance), and
                  <strong> legitimate interests</strong> (business operations). You have the right to obtain confirmation
                  of whether we process your data, access to it, and in certain circumstances, deletion or restriction.
                </p>
                <p className="mt-2">
                  Questions? Contact your Data Protection Officer or email <strong>privacy@hireiq.com</strong>.
                </p>
              </div>
            </div>
          )}

          {/* History tab */}
          {activeTab === 'history' && (
            <RequestHistory requests={requests} loading={loadingReqs} />
          )}
        </div>
      </div>

      {/* Submit modal */}
      {selectedType && (
        <SubmitModal
          type={selectedType}
          employeeId={employeeId}
          onClose={() => setSelectedType(null)}
          onSubmitted={handleSubmitted}
        />
      )}
    </div>
  );
}
