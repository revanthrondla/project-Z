/**
 * AI Knowledge Base — Admin Document Management
 *
 * Admins upload company documents (PDF, TXT, plain text) that the AI assistant
 * uses as context when answering questions. Content is stored in the tenant DB
 * and indexed via FTS5 for semantic search.
 */
import React, { useState, useEffect, useRef } from 'react';
import api from '../../api';

function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(d) {
  return d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}

const FILE_ICONS = {
  'application/pdf':  '📄',
  'text/plain':       '📝',
  'text/markdown':    '📝',
  'text/csv':         '📊',
  default:            '📁',
};

export default function AIChatDocuments() {
  const [docs, setDocs]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [uploading, setUploading] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState('');
  const [deleteId, setDeleteId]   = useState(null);

  // Form state
  const [title, setTitle]         = useState('');
  const [textContent, setTextContent] = useState('');
  const [file, setFile]           = useState(null);
  const [inputMode, setInputMode] = useState('file'); // 'file' | 'text'
  const fileRef = useRef(null);

  useEffect(() => {
    loadDocs();
    api.get('/api/ai-chat/config').then(r => setConfigured(r.data.configured)).catch(() => setConfigured(false));
  }, []);

  async function loadDocs() {
    setLoading(true);
    try {
      const r = await api.get('/api/ai-chat/documents');
      setDocs(r.data);
    } catch { setDocs([]); } finally { setLoading(false); }
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required'); return; }
    if (inputMode === 'file' && !file) { setError('Please select a file'); return; }
    if (inputMode === 'text' && !textContent.trim()) { setError('Please enter document content'); return; }

    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('title', title.trim());
      if (inputMode === 'file') {
        fd.append('file', file);
      } else {
        fd.append('content', textContent.trim());
      }
      await api.post('/api/ai-chat/documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setSuccess('Document added to knowledge base successfully.');
      setTitle(''); setTextContent(''); setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      setShowForm(false);
      loadDocs();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id) {
    try {
      await api.delete(`/api/ai-chat/documents/${id}`);
      setDeleteId(null);
      loadDocs();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete document.');
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI Knowledge Base</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Upload company documents that the AI assistant will reference when answering questions.
          </p>
        </div>
        <button
          onClick={() => { setShowForm(s => !s); setError(''); }}
          className="btn-primary flex items-center gap-2"
        >
          <span>➕</span> Add Document
        </button>
      </div>

      {/* API key warning */}
      {!configured && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          <strong>⚠️ AI Assistant not configured</strong>
          <p className="mt-1">Set <code className="font-mono bg-amber-100 px-1 rounded">ANTHROPIC_API_KEY</code> in your server's environment variables to enable the AI Assistant. Documents can still be uploaded and will be used once the key is configured.</p>
        </div>
      )}

      {/* Success / error banners */}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-700 flex items-center gap-2">
          ✅ {success}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-center justify-between">
          ⚠️ {error}
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 ml-2">✕</button>
        </div>
      )}

      {/* Upload form */}
      {showForm && (
        <div className="card p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Add Document to Knowledge Base</h2>

          {/* Mode switcher */}
          <div className="flex gap-2 mb-4">
            {['file', 'text'].map(mode => (
              <button key={mode}
                onClick={() => setInputMode(mode)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${inputMode === mode ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {mode === 'file' ? '📎 Upload File' : '✍️ Paste Text'}
              </button>
            ))}
          </div>

          <form onSubmit={handleUpload} className="space-y-4">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Document Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Company Holiday Policy 2025, Employee Handbook"
                className="input w-full"
                required
              />
            </div>

            {inputMode === 'file' ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  File <span className="text-red-500">*</span>
                  <span className="text-gray-400 font-normal ml-1">(PDF, TXT, MD — max 10 MB)</span>
                </label>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.txt,.md,.csv"
                  onChange={e => setFile(e.target.files[0] || null)}
                  className="block w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 file:font-medium hover:file:bg-blue-100 cursor-pointer"
                />
                {file && (
                  <p className="text-xs text-gray-500 mt-1">{file.name} ({formatBytes(file.size)})</p>
                )}
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Document Content <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={textContent}
                  onChange={e => setTextContent(e.target.value)}
                  rows={8}
                  placeholder="Paste your document content here…"
                  className="input w-full font-mono text-xs"
                />
                <p className="text-xs text-gray-400 mt-1">{textContent.length.toLocaleString()} characters</p>
              </div>
            )}

            <div className="flex gap-3">
              <button type="submit" disabled={uploading} className="btn-primary flex items-center gap-2">
                {uploading ? (
                  <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Uploading…</>
                ) : '⬆️ Upload & Index'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setError(''); }} className="btn-secondary">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Document list */}
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Indexed Documents ({docs.length})</h2>
          {docs.length > 0 && (
            <p className="text-xs text-gray-400">The AI searches these automatically when relevant to a question.</p>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue-600" />
          </div>
        ) : docs.length === 0 ? (
          <div className="text-center py-14 text-gray-400">
            <div className="text-4xl mb-3">📭</div>
            <p className="font-medium text-gray-600 mb-1">No documents yet</p>
            <p className="text-sm">Upload company policies, FAQs, or any reference documents<br />so the AI can include them when answering questions.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {docs.map(doc => (
              <div key={doc.id} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50">
                <div className="text-2xl shrink-0">
                  {FILE_ICONS[doc.file_type] || FILE_ICONS.default}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm">{doc.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {doc.file_name && <span className="mr-2">{doc.file_name}</span>}
                    {formatBytes(doc.file_size)} · Uploaded {formatDate(doc.created_at)} by {doc.uploaded_by_name}
                  </p>
                </div>
                <div className="shrink-0">
                  {deleteId === doc.id ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-gray-500">Delete?</span>
                      <button onClick={() => handleDelete(doc.id)} className="text-red-600 font-medium hover:underline">Yes</button>
                      <button onClick={() => setDeleteId(null)} className="text-gray-400 hover:text-gray-600">No</button>
                    </div>
                  ) : (
                    <button onClick={() => setDeleteId(doc.id)}
                      className="text-gray-300 hover:text-red-500 transition-colors p-1.5 rounded-lg hover:bg-red-50"
                      title="Delete document">
                      🗑️
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-5">
        <h3 className="font-semibold text-blue-900 text-sm mb-2">💡 How the AI Knowledge Base works</h3>
        <div className="text-xs text-blue-800 space-y-1">
          <p>• Documents are indexed with full-text search and retrieved automatically when relevant to a user's question.</p>
          <p>• Supported formats: PDF (text extracted), plain text (.txt), Markdown (.md), or paste directly.</p>
          <p>• Good candidates: HR policies, onboarding guides, payroll FAQs, client SOPs, company handbooks.</p>
          <p>• The AI combines document context with live tenant data (employees, timesheets, invoices) to answer questions.</p>
        </div>
      </div>
    </div>
  );
}
