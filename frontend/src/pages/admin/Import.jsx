import React, { useState, useRef } from 'react';
import api from '../../api';

const SECTIONS = [
  {
    key: 'candidates',
    label: 'Employees',
    icon: '👥',
    description: 'Import new employees with their roles, hourly rates, client assignments, and extended contact info.',
    columns: ['name*', 'email*', 'role*', 'hourly_rate*', 'phone', 'alt_phone', 'personal_email', 'home_street', 'home_city', 'home_state', 'home_postcode', 'home_country', 'client_name', 'start_date', 'end_date', 'status', 'contract_type', 'password'],
    accent: 'blue',
  },
  {
    key: 'timesheets',
    label: 'Timesheets',
    icon: '⏱️',
    description: 'Bulk-load time entries for employees by date.',
    columns: ['candidate_email*', 'date*', 'hours*', 'description', 'project', 'status'],
    accent: 'green',
  },
  {
    key: 'absences',
    label: 'Absences',
    icon: '🏖️',
    description: 'Import absence records (vacation, sick leave, etc.)',
    columns: ['candidate_email*', 'start_date*', 'end_date*', 'type*', 'status', 'notes'],
    accent: 'orange',
  },
  {
    key: 'jobs',
    label: 'Jobs',
    icon: '💼',
    description: 'Upload job postings in bulk.',
    columns: ['title*', 'description', 'skills', 'client_name', 'location', 'contract_type', 'hourly_rate_min', 'hourly_rate_max', 'status'],
    accent: 'purple',
  },
  {
    key: 'emergency_contacts',
    label: 'Emergency Contacts',
    icon: '🆘',
    description: 'Bulk-import emergency contacts for existing employees.',
    columns: ['employee_email*', 'name*', 'phone1*', 'relationship', 'phone2'],
    accent: 'red',
    uploadPath: '/api/upload/emergency-contacts',
  },
  {
    key: 'employment_history',
    label: 'Employment History',
    icon: '📋',
    description: 'Import position and salary history for existing employees.',
    columns: ['employee_email*', 'position_title*', 'start_date*', 'end_date', 'remuneration', 'currency', 'frequency', 'notes'],
    accent: 'indigo',
    uploadPath: '/api/upload/employment-history',
  },
  {
    key: 'training_records',
    label: 'Training Records',
    icon: '🎓',
    description: 'Import completed training and certifications for existing employees.',
    columns: ['employee_email*', 'training_date*', 'name*', 'content', 'results'],
    accent: 'teal',
    uploadPath: '/api/upload/training-records',
  },
];

const ACCENT_CLASSES = {
  blue:   { bg: 'bg-blue-50',   border: 'border-blue-200',   icon: 'bg-blue-100 text-emerald-700',   badge: 'bg-emerald-600',   bar: 'bg-emerald-500' },
  green:  { bg: 'bg-green-50',  border: 'border-green-200',  icon: 'bg-green-100 text-green-700',  badge: 'bg-green-600',  bar: 'bg-green-500' },
  orange: { bg: 'bg-orange-50', border: 'border-orange-200', icon: 'bg-orange-100 text-orange-700', badge: 'bg-orange-600', bar: 'bg-orange-500' },
  purple: { bg: 'bg-purple-50', border: 'border-purple-200', icon: 'bg-purple-100 text-purple-700', badge: 'bg-purple-600', bar: 'bg-purple-500' },
  red:    { bg: 'bg-red-50',    border: 'border-red-200',    icon: 'bg-red-100 text-red-700',    badge: 'bg-red-600',    bar: 'bg-red-500' },
  indigo: { bg: 'bg-emerald-50', border: 'border-emerald-200', icon: 'bg-emerald-100 text-emerald-700', badge: 'bg-emerald-600', bar: 'bg-emerald-500' },
  teal:   { bg: 'bg-teal-50',   border: 'border-teal-200',   icon: 'bg-teal-100 text-teal-700',   badge: 'bg-teal-600',   bar: 'bg-teal-500' },
};

function ImportSection({ section }) {
  const { key, label, icon, description, columns, accent, uploadPath } = section;
  const cls = ACCENT_CLASSES[accent] || ACCENT_CLASSES.blue;
  const apiUploadPath = uploadPath || `/api/upload/${key}`;
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [showErrors, setShowErrors] = useState(false);

  const downloadTemplate = () => {
    const token = localStorage.getItem('flow_token');
    const a = document.createElement('a');
    a.href = `/api/upload/template/${key}`;
    // Need auth header — use fetch + blob
    fetch(`/api/upload/template/${key}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `flow_${key}_template.csv`;
        link.click();
        URL.revokeObjectURL(url);
      });
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) { setFile(f); setResult(null); }
  };

  const handleFileChange = (e) => {
    setFile(e.target.files[0] || null);
    setResult(null);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post(apiUploadPath, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(res.data);
      setShowErrors(false);
    } catch (err) {
      setResult({ error: err.response?.data?.error || 'Upload failed' });
    } finally {
      setUploading(false);
    }
  };

  const reset = () => { setFile(null); setResult(null); if (fileRef.current) fileRef.current.value = ''; };

  const successRate = result && !result.error
    ? Math.round((result.imported / Math.max(result.total, 1)) * 100)
    : 0;

  return (
    <div className={`rounded-2xl border ${cls.border} ${cls.bg} p-5`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3">
          <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ${cls.icon}`}>{icon}</span>
          <div>
            <h3 className="font-semibold text-gray-900">{label}</h3>
            <p className="text-sm text-gray-500 mt-0.5">{description}</p>
          </div>
        </div>
        <button
          onClick={downloadTemplate}
          className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-gray-600 border border-gray-300 bg-white rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
        >
          ⬇ Template
        </button>
      </div>

      {/* Column hints */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {columns.map(col => (
          <span
            key={col}
            className={`text-xs px-2 py-0.5 rounded-full font-mono ${
              col.endsWith('*') ? `${cls.badge} text-white` : 'bg-white text-gray-500 border border-gray-200'
            }`}
          >
            {col.replace('*', '')}
            {col.endsWith('*') && <span className="ml-0.5 opacity-70">*</span>}
          </span>
        ))}
        <span className="text-xs text-gray-400 self-center ml-1">* required</span>
      </div>

      {/* Drop zone */}
      {!result && (
        <div
          className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${
            dragOver ? 'border-gray-400 bg-white/80' : 'border-gray-300 bg-white/50 hover:bg-white/80'
          }`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
        >
          {file ? (
            <div className="flex items-center justify-center gap-2">
              <span className="text-2xl">📄</span>
              <div className="text-left">
                <p className="text-sm font-medium text-gray-800">{file.name}</p>
                <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
              <button
                className="ml-2 text-gray-400 hover:text-red-500 text-lg"
                onClick={e => { e.stopPropagation(); reset(); }}
              >×</button>
            </div>
          ) : (
            <>
              <p className="text-2xl mb-1">📂</p>
              <p className="text-sm font-medium text-gray-700">Drop CSV file here or click to browse</p>
              <p className="text-xs text-gray-400 mt-1">Max 5 MB · CSV format only</p>
            </>
          )}
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
        </div>
      )}

      {/* Upload button */}
      {file && !result && (
        <button
          onClick={handleUpload}
          disabled={uploading}
          className={`mt-3 w-full py-2 rounded-lg text-white text-sm font-medium transition-opacity ${cls.badge} ${uploading ? 'opacity-60 cursor-not-allowed' : 'hover:opacity-90'}`}
        >
          {uploading ? '⏳ Importing…' : `Import ${label}`}
        </button>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-3">
          {result.error ? (
            <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
              ⚠️ {result.error}
            </div>
          ) : (
            <>
              {/* Progress bar */}
              <div className="bg-gray-200 rounded-full h-2 overflow-hidden">
                <div className={`h-2 rounded-full transition-all ${cls.bar}`} style={{ width: `${successRate}%` }} />
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-white rounded-lg p-2 border border-gray-100">
                  <p className="text-lg font-bold text-gray-900">{result.total}</p>
                  <p className="text-xs text-gray-500">Total rows</p>
                </div>
                <div className="bg-white rounded-lg p-2 border border-green-100">
                  <p className="text-lg font-bold text-green-600">{result.imported}</p>
                  <p className="text-xs text-gray-500">Imported</p>
                </div>
                <div className={`bg-white rounded-lg p-2 border ${result.failed > 0 ? 'border-red-100' : 'border-gray-100'}`}>
                  <p className={`text-lg font-bold ${result.failed > 0 ? 'text-red-600' : 'text-gray-400'}`}>{result.failed}</p>
                  <p className="text-xs text-gray-500">Failed</p>
                </div>
              </div>

              {/* Error detail toggle */}
              {result.errors?.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowErrors(!showErrors)}
                    className="text-xs text-red-600 underline"
                  >
                    {showErrors ? 'Hide' : 'Show'} {result.errors.length} error{result.errors.length !== 1 ? 's' : ''}
                  </button>
                  {showErrors && (
                    <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-red-200 bg-red-50 divide-y divide-red-100">
                      {result.errors.map((e, idx) => (
                        <div key={idx} className="px-3 py-2 text-xs">
                          <span className="font-semibold text-red-700">Row {e.row}:</span>{' '}
                          <span className="text-red-600">{e.error}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <button onClick={reset} className="text-xs text-gray-500 hover:text-gray-700 underline">
            Upload another file
          </button>
        </div>
      )}
    </div>
  );
}

export default function AdminImport() {
  return (
    <div className="max-w-5xl mx-auto">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Bulk Import</h1>
        <p className="text-gray-500 mt-1">
          Upload CSV files to import candidates, timesheets, absences, or job postings in bulk.
          Download a template first to see the required column format with sample data.
        </p>
      </div>

      {/* Tip banner */}
      <div className="mb-6 flex items-start gap-3 bg-emerald-50 border border-blue-200 rounded-xl px-4 py-3">
        <span className="text-blue-500 text-lg mt-0.5">💡</span>
        <div className="text-sm text-blue-800">
          <strong>Tips:</strong> Lines starting with <code className="bg-blue-100 px-1 rounded">#</code> are treated as comments and ignored.
          Required columns are highlighted in colour. Extra columns are ignored. Failed rows are reported with the exact error so you can fix and re-upload.
        </div>
      </div>

      {/* 2×2 grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {SECTIONS.map(s => <ImportSection key={s.key} section={s} />)}
      </div>
    </div>
  );
}
