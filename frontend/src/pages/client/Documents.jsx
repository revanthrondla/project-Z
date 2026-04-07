import { useState, useEffect } from 'react';
import api from '../../api';
import SignaturePad from '../../components/SignaturePad';

const STATUS_META = {
  pending:   { label: 'Pending',   cls: 'bg-yellow-100 text-yellow-800', icon: '⏳' },
  partial:   { label: 'Partial',   cls: 'bg-blue-100   text-blue-800',   icon: '🔄' },
  completed: { label: 'Completed', cls: 'bg-green-100  text-green-800',  icon: '✅' },
  voided:    { label: 'Voided',    cls: 'bg-red-100    text-red-800',    icon: '❌' },
};
const SIG_TYPE_LABELS = {
  none:      'No signature required',
  single:    'Single signature',
  two_way:   'Two-party signature',
  three_way: 'Three-party signature',
};
const ROLE_ICONS = { candidate: '👤', client: '🏢', admin: '🔑' };

/* ── Document Detail + Sign Modal ── */
function DetailModal({ doc, onClose, onRefresh }) {
  const [detail, setDetail] = useState(null);
  const [signing, setSigning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const loadDetail = async () => {
    try {
      const { data } = await api.get(`/api/documents/${doc.id}`);
      setDetail(data);
    } finally { setLoading(false); }
  };
  useEffect(() => { loadDetail(); }, [doc.id]);

  const mySlot = detail?.signatures?.find(s => s.signer_role === 'client' && s.status === 'pending');
  const mySigned = detail?.signatures?.find(s => s.signer_role === 'client' && s.status === 'signed');

  const handleSign = async (dataURL) => {
    setErr('');
    try {
      await api.post(`/api/documents/${doc.id}/sign`, { signature_data: dataURL });
      setSigning(false); onRefresh(); loadDetail();
    } catch (e) { setErr(e.response?.data?.error || 'Could not sign'); }
  };

  const handleReject = async () => {
    if (!confirm('Decline to sign this document? This will void it.')) return;
    try {
      await api.post(`/api/documents/${doc.id}/reject`, { reason: 'Client declined' });
      onRefresh(); onClose();
    } catch (e) { setErr(e.response?.data?.error || 'Could not reject'); }
  };

  if (loading || !detail) return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white" />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">{detail.title}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {detail.file_name} · {SIG_TYPE_LABELS[detail.signature_type]}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl ml-4">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-5">
          {err && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">{err}</div>}

          {/* Status row */}
          <div className="flex items-center gap-3">
            {(() => { const m = STATUS_META[detail.status]; return (
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${m.cls}`}>{m.icon} {m.label}</span>
            );})()}
            <a href={`/api/documents/${doc.id}/file`} target="_blank" rel="noreferrer"
              className="ml-auto text-sm text-blue-600 hover:underline">📄 Open File</a>
          </div>

          {detail.description && <p className="text-sm text-gray-600">{detail.description}</p>}

          {/* Signature chain */}
          {detail.signatures?.length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Signature Chain</p>
              <div className="space-y-2">
                {detail.signatures.map((s, i) => (
                  <div key={i} className={`flex items-center gap-3 rounded-xl p-3 border
                    ${s.status === 'signed'   ? 'bg-green-50 border-green-200' :
                      s.status === 'rejected' ? 'bg-red-50   border-red-200'  :
                                                'bg-gray-50  border-gray-200'}`}>
                    <span className="text-2xl">{ROLE_ICONS[s.signer_role]}</span>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-800 capitalize">{s.signer_role}</p>
                      {s.status === 'signed' && (
                        <p className="text-xs text-gray-500">{s.signer_name} · {new Date(s.signed_at).toLocaleString()}</p>
                      )}
                      {s.status === 'pending'  && <p className="text-xs text-gray-400">Awaiting signature</p>}
                      {s.status === 'rejected' && <p className="text-xs text-red-600">Declined</p>}
                    </div>
                    <span>{s.status === 'signed' ? '✅' : s.status === 'rejected' ? '❌' : '⏳'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Already signed */}
          {mySigned && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-green-800 mb-2">✅ You have signed this document</p>
              <p className="text-xs text-green-700">Signed: {new Date(mySigned.signed_at).toLocaleString()}</p>
              {mySigned.signature_data && (
                <img src={mySigned.signature_data} alt="Your signature"
                  className="mt-3 border border-green-200 rounded-lg max-h-20 bg-white p-1" />
              )}
            </div>
          )}

          {/* Sign prompt */}
          {mySlot && detail.status !== 'voided' && (
            <div className="border border-blue-100 rounded-xl p-5 bg-blue-50">
              <p className="text-sm font-semibold text-blue-800 mb-1">Your signature is required</p>
              <p className="text-xs text-blue-700 mb-4">
                By signing, you confirm you have read and agree to the contents of this document.
              </p>
              {!signing ? (
                <div className="flex gap-2">
                  <button onClick={() => setSigning(true)}
                    className="px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
                    ✍️ Sign Now
                  </button>
                  <button onClick={handleReject}
                    className="px-4 py-2 rounded-lg border border-red-200 text-red-600 text-sm hover:bg-red-50">
                    Decline
                  </button>
                </div>
              ) : (
                <SignaturePad onSave={handleSign} onCancel={() => setSigning(false)} />
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex justify-end">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm hover:bg-gray-200">Close</button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Client Documents Page ── */
export default function ClientDocuments() {
  const [docs, setDocs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [tab, setTab]           = useState('all');

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/documents');
      setDocs(data);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const pendingCount = docs.filter(d =>
    (d.status === 'pending' || d.status === 'partial') &&
    d.required_signers?.includes('client')
  ).length;

  const filtered = docs.filter(d => {
    if (tab === 'needs_signing')
      return (d.status === 'pending' || d.status === 'partial') && d.required_signers?.includes('client');
    if (tab === 'completed') return d.status === 'completed';
    return true;
  });

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
        <p className="text-gray-500 mt-1">Review and sign documents shared with you</p>
      </div>

      {/* Pending banner */}
      {pendingCount > 0 && (
        <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <span className="text-2xl">✍️</span>
          <div>
            <p className="text-sm font-semibold text-amber-800">
              {pendingCount} document{pendingCount > 1 ? 's' : ''} awaiting your signature
            </p>
            <p className="text-xs text-amber-700">Click to review and sign</p>
          </div>
          <button onClick={() => setTab('needs_signing')}
            className="ml-auto text-xs text-amber-700 underline">View</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-xl w-fit">
        {[['all','All'],['needs_signing','Needs Signing'],['completed','Completed']].map(([val, lbl]) => (
          <button key={val} onClick={() => setTab(val)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors
              ${tab === val ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {lbl}
            {val === 'needs_signing' && pendingCount > 0 && (
              <span className="ml-1.5 bg-amber-500 text-white text-xs rounded-full px-1.5">{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card py-16 text-center text-gray-400">
          <div className="text-4xl mb-3">📄</div>
          <p className="font-medium">No documents here</p>
          <p className="text-sm mt-1">Documents shared with you by the agency will appear here</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(doc => {
            const m = STATUS_META[doc.status] || {};
            const needsMySign = (doc.status === 'pending' || doc.status === 'partial')
              && doc.required_signers?.includes('client');
            return (
              <div key={doc.id} onClick={() => setSelected(doc)}
                className="card p-4 cursor-pointer hover:shadow-md transition-shadow flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0
                  ${doc.status === 'completed' ? 'bg-green-50' :
                    doc.status === 'voided'    ? 'bg-red-50'   :
                    needsMySign                ? 'bg-amber-50' : 'bg-blue-50'}`}>
                  {doc.status === 'completed' ? '✅' :
                   doc.status === 'voided'    ? '❌' :
                   needsMySign                ? '✍️' : '📄'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900 truncate">{doc.title}</p>
                    {needsMySign && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium flex-shrink-0">
                        Action required
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {doc.file_name} · {SIG_TYPE_LABELS[doc.signature_type]}
                    {doc.required_signers && doc.signature_type !== 'none' && (
                      <> · {doc.signed_count}/{doc.total_signers} signed</>
                    )}
                  </p>
                </div>
                <div className="flex-shrink-0 text-right">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${m.cls}`}>{m.icon} {m.label}</span>
                  <p className="text-xs text-gray-400 mt-1">{new Date(doc.created_at).toLocaleDateString()}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && <DetailModal doc={selected} onClose={() => setSelected(null)} onRefresh={load} />}
    </div>
  );
}
