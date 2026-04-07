import { useState, useEffect, useRef } from 'react';
import api from '../../api';
import SignaturePad from '../../components/SignaturePad';

/* ── helpers ── */
const STATUS_META = {
  pending:   { label: 'Pending',   cls: 'bg-yellow-100 text-yellow-800' },
  partial:   { label: 'Partial',   cls: 'bg-blue-100   text-blue-800'   },
  completed: { label: 'Completed', cls: 'bg-green-100  text-green-800'  },
  voided:    { label: 'Voided',    cls: 'bg-red-100    text-red-800'    },
};
const SIG_TYPE_LABELS = {
  none:      'No signature',
  single:    'Single',
  two_way:   'Two-way',
  three_way: 'Three-way',
};
const ROLE_ICONS = { candidate: '👤', client: '🏢', admin: '🔑' };

function StatusBadge({ status }) {
  const m = STATUS_META[status] || { label: status, cls: 'bg-gray-100 text-gray-700' };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${m.cls}`}>{m.label}</span>;
}

function SignerBadge({ sig }) {
  const icon = ROLE_ICONS[sig.signer_role] || '?';
  const signed = sig.status === 'signed';
  const rejected = sig.status === 'rejected';
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium
      ${signed ? 'bg-green-100 text-green-800' : rejected ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-600'}`}>
      {icon} {sig.signer_role}
      {signed && ' ✓'}
      {rejected && ' ✗'}
    </span>
  );
}

/* ── Upload Modal ── */
function UploadModal({ candidates, clients, onClose, onUploaded }) {
  const [form, setForm] = useState({
    title: '', description: '',
    signature_type: 'none',
    required_signers: [],
    candidate_id: '', client_id: '',
  });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();

  const signerOptions = {
    none:      [],
    single:    [['candidate'], ['client'], ['admin']],
    two_way:   [['candidate','client'], ['candidate','admin'], ['client','admin']],
    three_way: [['candidate','client','admin']],
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return setError('Please select a file');
    if (!form.title.trim()) return setError('Title is required');
    if (form.signature_type !== 'none' && form.required_signers.length === 0)
      return setError('Select who must sign');

    setSaving(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', form.title);
      fd.append('description', form.description);
      fd.append('signature_type', form.signature_type);
      fd.append('required_signers', form.required_signers.join(','));
      if (form.candidate_id) fd.append('candidate_id', form.candidate_id);
      if (form.client_id)    fd.append('client_id', form.client_id);
      await api.post('/api/documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onUploaded();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Upload Document</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">{error}</div>}

          {/* File picker */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">File <span className="text-red-500">*</span></label>
            <div
              onClick={() => fileRef.current.click()}
              className="border-2 border-dashed border-gray-300 rounded-xl p-4 text-center cursor-pointer hover:border-blue-400 transition-colors"
            >
              {file
                ? <p className="text-sm text-gray-700">📄 {file.name} ({(file.size/1024).toFixed(1)} KB)</p>
                : <p className="text-sm text-gray-400">Click to browse — PDF, Word, image, TXT (max 20 MB)</p>
              }
              <input ref={fileRef} type="file" className="hidden"
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt"
                onChange={e => setFile(e.target.files[0] || null)} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title <span className="text-red-500">*</span></label>
            <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Employment Contract 2026" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional notes…" />
          </div>

          {/* Assign to */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Assign to Candidate</label>
              <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.candidate_id} onChange={e => setForm(f => ({ ...f, candidate_id: e.target.value }))}>
                <option value="">— None —</option>
                {candidates.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Assign to Client</label>
              <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
                <option value="">— None —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          {/* Signature type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Signature Requirement</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(SIG_TYPE_LABELS).map(([val, lbl]) => (
                <button key={val} type="button"
                  onClick={() => setForm(f => ({ ...f, signature_type: val, required_signers: [] }))}
                  className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors text-left
                    ${form.signature_type === val
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
                  {val === 'none' && '✏️ '}
                  {val === 'single' && '👤 '}
                  {val === 'two_way' && '🤝 '}
                  {val === 'three_way' && '🔐 '}
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* Required signers picker */}
          {form.signature_type !== 'none' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Who must sign?</label>
              <div className="space-y-1">
                {signerOptions[form.signature_type].map(combo => {
                  const key = combo.join(',');
                  const selected = form.required_signers.join(',') === key;
                  return (
                    <button key={key} type="button"
                      onClick={() => setForm(f => ({ ...f, required_signers: combo }))}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors
                        ${selected ? 'bg-blue-50 border-blue-400 text-blue-700' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
                      <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${selected ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`} />
                      {combo.map(r => `${ROLE_ICONS[r]} ${r}`).join(' + ')}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
              {saving ? '⏳ Uploading…' : '📤 Upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Document Detail / Sign Modal ── */
function DetailModal({ doc, onClose, onRefresh }) {
  const [signing, setSigning] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [audit, setAudit] = useState(null);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [err, setErr] = useState('');

  const loadAudit = async () => {
    setLoadingAudit(true);
    try {
      const { data } = await api.get(`/api/documents/${doc.id}/audit`);
      setAudit(data);
    } finally { setLoadingAudit(false); }
  };

  useEffect(() => { loadAudit(); }, [doc.id]);

  const handleSign = async (dataURL) => {
    setErr('');
    try {
      await api.post(`/api/documents/${doc.id}/sign`, { signature_data: dataURL });
      setSigning(false);
      onRefresh();
      loadAudit();
    } catch (e) { setErr(e.response?.data?.error || 'Sign failed'); }
  };

  const handleVoid = async () => {
    if (!confirm('Void this document? All signatures will be invalidated.')) return;
    await api.patch(`/api/documents/${doc.id}/void`);
    onRefresh(); onClose();
  };

  const handleDelete = async () => {
    if (!confirm('Delete this document permanently?')) return;
    await api.delete(`/api/documents/${doc.id}`);
    onRefresh(); onClose();
  };

  const fileUrl = `/api/documents/${doc.id}/file`;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">{doc.title}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Uploaded {new Date(doc.created_at).toLocaleDateString()} ·{' '}
              {doc.candidate_name && `Candidate: ${doc.candidate_name}`}
              {doc.client_name && ` · Client: ${doc.client_name}`}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl ml-4">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-5">
          {err && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">{err}</div>}

          {/* Status + type */}
          <div className="flex flex-wrap gap-2 items-center">
            <StatusBadge status={doc.status} />
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
              {SIG_TYPE_LABELS[doc.signature_type] || doc.signature_type}
            </span>
            <a href={fileUrl} target="_blank" rel="noreferrer"
              className="ml-auto text-sm text-blue-600 hover:underline flex items-center gap-1">
              📄 View / Download
            </a>
          </div>

          {doc.description && <p className="text-sm text-gray-600">{doc.description}</p>}

          {/* Signature slots */}
          {doc.required_signers && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Signature Status</p>
              <div className="space-y-2">
                {audit?.audit_trail?.map((entry, i) => (
                  <div key={i} className={`flex items-center gap-3 rounded-xl p-3 border
                    ${entry.status === 'signed'   ? 'bg-green-50 border-green-200' :
                      entry.status === 'rejected' ? 'bg-red-50   border-red-200'  :
                                                    'bg-gray-50  border-gray-200'}`}>
                    <span className="text-2xl">{ROLE_ICONS[entry.role]}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 capitalize">{entry.role}</p>
                      {entry.status === 'signed' && (
                        <p className="text-xs text-gray-500">
                          {entry.name} · {new Date(entry.signed_at).toLocaleString()}
                          {entry.ip_address && ` · IP: ${entry.ip_address}`}
                        </p>
                      )}
                      {entry.status === 'pending' && <p className="text-xs text-gray-400">Awaiting signature</p>}
                      {entry.status === 'rejected' && <p className="text-xs text-red-600">Rejected</p>}
                    </div>
                    <span className={`text-xl ${entry.status === 'signed' ? 'text-green-600' : entry.status === 'rejected' ? 'text-red-500' : 'text-gray-300'}`}>
                      {entry.status === 'signed' ? '✅' : entry.status === 'rejected' ? '❌' : '⏳'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Admin sign panel */}
          {doc.status !== 'completed' && doc.status !== 'voided' && (
            <div className="border border-blue-100 rounded-xl p-4 bg-blue-50">
              <p className="text-sm font-medium text-blue-800 mb-3">Admin Signature</p>
              {!signing ? (
                <button onClick={() => setSigning(true)}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
                  ✍️ Sign as Admin
                </button>
              ) : (
                <SignaturePad onSave={handleSign} onCancel={() => setSigning(false)} />
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-2 justify-end">
          {doc.status !== 'voided' && (
            <button onClick={handleVoid}
              className="px-4 py-2 rounded-lg border border-orange-200 text-orange-600 text-sm hover:bg-orange-50">
              Void
            </button>
          )}
          <button onClick={handleDelete}
            className="px-4 py-2 rounded-lg border border-red-200 text-red-600 text-sm hover:bg-red-50">
            Delete
          </button>
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm hover:bg-gray-200">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ── */
export default function AdminDocuments() {
  const [docs, setDocs]           = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [clients, setClients]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [selected, setSelected]   = useState(null);
  const [filter, setFilter]       = useState({ status: '', type: '', search: '' });

  const load = async () => {
    setLoading(true);
    try {
      const [d, c, cl] = await Promise.all([
        api.get('/api/documents'),
        api.get('/api/candidates'),
        api.get('/api/clients'),
      ]);
      setDocs(d.data);
      setCandidates(c.data);
      setClients(cl.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filtered = docs.filter(d => {
    if (filter.status && d.status !== filter.status) return false;
    if (filter.type   && d.signature_type !== filter.type) return false;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      if (!d.title?.toLowerCase().includes(q) &&
          !d.candidate_name?.toLowerCase().includes(q) &&
          !d.client_name?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const stats = {
    total:     docs.length,
    pending:   docs.filter(d => d.status === 'pending').length,
    partial:   docs.filter(d => d.status === 'partial').length,
    completed: docs.filter(d => d.status === 'completed').length,
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
          <p className="text-gray-500 mt-1">Upload and manage documents requiring digital signatures</p>
        </div>
        <button onClick={() => setShowUpload(true)}
          className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 flex items-center gap-2">
          📤 Upload Document
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total',     val: stats.total,     color: 'blue'   },
          { label: 'Pending',   val: stats.pending,   color: 'yellow' },
          { label: 'Partial',   val: stats.partial,   color: 'indigo' },
          { label: 'Completed', val: stats.completed, color: 'green'  },
        ].map(k => (
          <div key={k.label} className="card p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">{k.val}</p>
            <p className="text-xs text-gray-500 mt-1">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card p-4 mb-4 flex flex-wrap gap-3">
        <input
          className="flex-1 min-w-48 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Search by title, candidate, client…"
          value={filter.search}
          onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
        />
        <select className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}>
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="partial">Partial</option>
          <option value="completed">Completed</option>
          <option value="voided">Voided</option>
        </select>
        <select className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={filter.type} onChange={e => setFilter(f => ({ ...f, type: e.target.value }))}>
          <option value="">All Types</option>
          <option value="none">No Signature</option>
          <option value="single">Single</option>
          <option value="two_way">Two-way</option>
          <option value="three_way">Three-way</option>
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <div className="text-4xl mb-3">📁</div>
            <p className="font-medium">No documents found</p>
            <p className="text-sm mt-1">Upload the first document to get started</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Document','Assigned To','Type','Signers','Status','Uploaded','Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(doc => (
                <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 truncate max-w-48">{doc.title}</p>
                    <p className="text-xs text-gray-400">{doc.file_name}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {doc.candidate_name && <div className="text-xs">👤 {doc.candidate_name}</div>}
                    {doc.client_name    && <div className="text-xs">🏢 {doc.client_name}</div>}
                    {!doc.candidate_name && !doc.client_name && <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {SIG_TYPE_LABELS[doc.signature_type]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {doc.required_signers
                      ? doc.required_signers.split(',').map((r, i) => (
                          <span key={i} className="text-xs mr-1">{ROLE_ICONS[r]}</span>
                        ))
                      : <span className="text-gray-300 text-xs">—</span>}
                    {doc.signature_type !== 'none' && (
                      <span className="text-xs text-gray-400">{doc.signed_count}/{doc.total_signers}</span>
                    )}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={doc.status} /></td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {new Date(doc.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => setSelected(doc)}
                      className="text-blue-600 hover:text-blue-800 text-xs font-medium hover:underline">
                      View / Sign
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showUpload && (
        <UploadModal
          candidates={candidates}
          clients={clients}
          onClose={() => setShowUpload(false)}
          onUploaded={load}
        />
      )}
      {selected && (
        <DetailModal
          doc={selected}
          onClose={() => setSelected(null)}
          onRefresh={load}
        />
      )}
    </div>
  );
}
