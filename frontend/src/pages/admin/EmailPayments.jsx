import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';

// ── tiny helpers ──────────────────────────────────────────────────────────────
const money = n => n != null ? `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—';
const METHODS = ['bank_transfer', 'cash', 'cheque', 'credit_card', 'other'];
const METHOD_LABELS = { bank_transfer: 'Bank Transfer', cash: 'Cash', cheque: 'Cheque', credit_card: 'Credit Card', other: 'Other' };

// ── Confidence badge ──────────────────────────────────────────────────────────
function ConfidenceBadge({ level }) {
  const cfg = {
    high:   { cls: 'bg-emerald-100 text-emerald-700', label: '✅ High match' },
    medium: { cls: 'bg-yellow-100  text-yellow-700',  label: '⚠️ Medium match' },
    low:    { cls: 'bg-orange-100  text-orange-700',  label: '🔸 Low match' },
    none:   { cls: 'bg-gray-100    text-gray-500',    label: '❓ No match' },
  }[level] || { cls: 'bg-gray-100 text-gray-500', label: level };
  return <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${cfg.cls}`}>{cfg.label}</span>;
}

// ── Status chip ───────────────────────────────────────────────────────────────
function StatusChip({ status }) {
  const cfg = {
    pending:   { cls: 'bg-yellow-100 text-yellow-700', label: '⏳ Pending Review' },
    confirmed: { cls: 'bg-emerald-100 text-emerald-700', label: '✅ Confirmed' },
    rejected:  { cls: 'bg-gray-100    text-gray-500',   label: '✕ Dismissed' },
  }[status] || { cls: 'bg-gray-100 text-gray-500', label: status };
  return <span className={`inline-flex items-center text-xs px-2.5 py-1 rounded-full font-medium ${cfg.cls}`}>{cfg.label}</span>;
}

// ── Settings panel ────────────────────────────────────────────────────────────
function SettingsPanel({ onClose }) {
  const [form, setForm]     = useState(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saved, setSaved]   = useState(false);

  useEffect(() => {
    api.get('/api/email-payments/settings').then(r => {
      setForm({
        provider:       r.data.provider || 'gmail',
        imap_host:      r.data.imap_host || '',
        imap_port:      r.data.imap_port || 993,
        imap_user:      r.data.imap_user || '',
        imap_password:  '',                       // always blank in form
        imap_folder:    r.data.imap_folder || 'INBOX',
        search_subject: r.data.search_subject || 'payment',
        poll_interval:  r.data.poll_interval || 30,
        enabled:        !!r.data.enabled,
        last_polled_at: r.data.last_polled_at,
      });
    });
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/api/email-payments/settings', form);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      alert(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const r = await api.post('/api/email-payments/test');
      setTestResult(r.data);
    } catch (err) {
      setTestResult({ ok: false, message: err.response?.data?.message || 'Connection failed' });
    } finally {
      setTesting(false);
    }
  };

  if (!form) return <div className="p-8 text-center text-gray-400">Loading settings…</div>;

  const providerInfo = {
    gmail:   { label: 'Gmail / Google Workspace', host: 'imap.gmail.com',        tip: 'Use a Gmail App Password (16-char) — not your regular password. Generate one at myaccount.google.com → Security → 2-Step Verification → App passwords.' },
    outlook: { label: 'Outlook / Microsoft 365',  host: 'outlook.office365.com', tip: 'Use your Microsoft 365 email and password, or an app password if MFA is enabled.' },
    imap:    { label: 'Custom IMAP',              host: '',                       tip: 'Enter your IMAP server hostname and port manually.' },
  };
  const info = providerInfo[form.provider];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h3 className="font-semibold text-gray-900 text-lg">📧 Email Payment Settings</h3>
            <p className="text-xs text-gray-500 mt-0.5">Connect your inbox to auto-import payment confirmation emails</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <form onSubmit={handleSave} className="p-6 space-y-4">
          {/* Provider */}
          <div>
            <label className="label">Email Provider</label>
            <div className="flex gap-2">
              {Object.entries(providerInfo).map(([key, v]) => (
                <button
                  key={key} type="button"
                  onClick={() => setForm(f => ({ ...f, provider: key, imap_host: v.host, imap_port: 993 }))}
                  className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                    form.provider === key
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {key === 'gmail' ? '📨 Gmail' : key === 'outlook' ? '📬 Outlook' : '🔧 Custom'}
                </button>
              ))}
            </div>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-2">{info.tip}</p>
          </div>

          {/* Host (custom IMAP only) */}
          {form.provider === 'imap' && (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="label">IMAP Host</label>
                <input className="input" value={form.imap_host} onChange={e => setForm(f => ({...f, imap_host: e.target.value}))} placeholder="mail.example.com" />
              </div>
              <div>
                <label className="label">Port</label>
                <input className="input" type="number" value={form.imap_port} onChange={e => setForm(f => ({...f, imap_port: parseInt(e.target.value)}))} />
              </div>
            </div>
          )}
          {form.provider !== 'imap' && (
            <p className="text-xs text-gray-500">IMAP server: <code className="bg-gray-100 px-1 rounded">{info.host}:993 (TLS)</code></p>
          )}

          {/* Credentials */}
          <div>
            <label className="label">Email Address *</label>
            <input className="input" type="email" value={form.imap_user} onChange={e => setForm(f => ({...f, imap_user: e.target.value}))} placeholder="yourname@gmail.com" required />
          </div>
          <div>
            <label className="label">{form.provider === 'gmail' ? 'App Password *' : 'Password *'}</label>
            <input className="input" type="password" value={form.imap_password} onChange={e => setForm(f => ({...f, imap_password: e.target.value}))} placeholder={form.imap_password ? 'Leave blank to keep current' : 'Enter password'} />
          </div>

          {/* Search settings */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Mailbox Folder</label>
              <input className="input" value={form.imap_folder} onChange={e => setForm(f => ({...f, imap_folder: e.target.value}))} placeholder="INBOX" />
            </div>
            <div>
              <label className="label">Subject Filter (keyword)</label>
              <input className="input" value={form.search_subject} onChange={e => setForm(f => ({...f, search_subject: e.target.value}))} placeholder="payment" />
            </div>
          </div>

          <div>
            <label className="label">Poll Interval (minutes)</label>
            <select className="input" value={form.poll_interval} onChange={e => setForm(f => ({...f, poll_interval: parseInt(e.target.value)}))}>
              {[15, 30, 60, 120, 360].map(v => <option key={v} value={v}>Every {v} minutes</option>)}
            </select>
          </div>

          {/* Enable toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div
              onClick={() => setForm(f => ({...f, enabled: !f.enabled}))}
              className={`relative w-10 h-5 rounded-full transition-colors ${form.enabled ? 'bg-blue-600' : 'bg-gray-300'}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-sm font-medium text-gray-700">Auto-poll enabled</span>
          </label>

          {form.last_polled_at && (
            <p className="text-xs text-gray-400">Last polled: {new Date(form.last_polled_at).toLocaleString()}</p>
          )}

          {/* Test result */}
          {testResult && (
            <div className={`p-3 rounded-lg text-sm ${testResult.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              {testResult.ok ? '✅' : '❌'} {testResult.message}
            </div>
          )}

          {saved && (
            <div className="p-3 rounded-lg text-sm bg-emerald-50 text-emerald-700 border border-emerald-200">✅ Settings saved successfully</div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Saving…' : 'Save Settings'}</button>
            <button type="button" onClick={handleTest} disabled={testing} className="btn-secondary">
              {testing ? 'Testing…' : '🔌 Test Connection'}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">Close</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Review / Confirm Modal ────────────────────────────────────────────────────
function ReviewModal({ imp, invoices, onClose, onConfirmed, onRejected }) {
  const [form, setForm] = useState({
    invoice_id:      imp.matched_invoice_id || '',
    amount:          imp.parsed_amount != null ? String(imp.parsed_amount) : '',
    payment_date:    imp.parsed_payment_date || new Date().toISOString().slice(0, 10),
    payment_method:  'bank_transfer',
    reference_number: imp.parsed_reference || '',
    notes:           '',
  });
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [rejecting, setRejecting] = useState(false);

  const selectedInvoice = invoices.find(i => String(i.id) === String(form.invoice_id));
  const amountMismatch  = selectedInvoice && form.amount &&
    Math.abs(selectedInvoice.total_amount - parseFloat(form.amount)) > 0.01;

  const handleConfirm = async (e) => {
    e.preventDefault();
    setError(''); setSaving(true);
    try {
      const r = await api.post(`/api/email-payments/imports/${imp.id}/confirm`, {
        ...form,
        invoice_id: parseInt(form.invoice_id),
        amount:     parseFloat(form.amount),
      });
      onConfirmed(r.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Confirm failed');
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async () => {
    setRejecting(true);
    try {
      await api.post(`/api/email-payments/imports/${imp.id}/reject`);
      onRejected(imp.id);
    } catch { /* ignore */ } finally { setRejecting(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h3 className="font-semibold text-gray-900 text-lg">📧 Review Payment Email</h3>
            <p className="text-xs text-gray-500 mt-0.5 truncate max-w-sm">{imp.email_subject}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="p-6 space-y-5">
          {/* Parsed data summary */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-semibold text-blue-800">Extracted from email{imp.has_attachment ? ' + PDF attachment' : ''}</span>
              <ConfidenceBadge level={imp.match_confidence} />
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="From"            value={imp.email_from} />
              <Field label="Email date"      value={imp.email_date} />
              <Field label="Amount detected" value={money(imp.parsed_amount)} highlight={!!imp.parsed_amount} />
              <Field label="Payment date"    value={imp.parsed_payment_date || '—'} />
              <Field label="Client"          value={imp.parsed_client_name || '—'} />
              <Field label="Invoice #"       value={imp.parsed_invoice_number || '—'} />
              <Field label="Reference"       value={imp.parsed_reference || '—'} />
              <Field label="Period"
                value={imp.parsed_period_start && imp.parsed_period_end
                  ? `${imp.parsed_period_start} → ${imp.parsed_period_end}` : '—'} />
              {imp.parsed_employee_names?.length > 0 && (
                <Field label="Employees" value={imp.parsed_employee_names.join(', ')} className="col-span-2" />
              )}
            </div>
          </div>

          {/* Mismatch alerts */}
          {imp.mismatch_flags?.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm font-semibold text-red-700 mb-1">⚠️ Discrepancy Alerts</p>
              {imp.mismatch_flags.map((f, i) => (
                <p key={i} className="text-xs text-red-600">• {f}</p>
              ))}
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
          )}

          {/* Confirmation form */}
          <form onSubmit={handleConfirm} className="space-y-4">
            <div>
              <label className="label">Match to Invoice *</label>
              <select
                className="input"
                value={form.invoice_id}
                onChange={e => setForm(f => ({...f, invoice_id: e.target.value}))}
                required
              >
                <option value="">— Select invoice —</option>
                {invoices.map(inv => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoice_number} · {inv.candidate_name} · {money(inv.total_amount)} · {inv.period_start}→{inv.period_end}
                  </option>
                ))}
              </select>
              {selectedInvoice && (
                <div className="mt-2 p-3 bg-gray-50 rounded-lg text-xs text-gray-600 grid grid-cols-3 gap-2">
                  <span>Status: <strong>{selectedInvoice.status}</strong></span>
                  <span>Total: <strong>{money(selectedInvoice.total_amount)}</strong></span>
                  <span>Employee: <strong>{selectedInvoice.candidate_name}</strong></span>
                  <span>Client: <strong>{selectedInvoice.client_name || '—'}</strong></span>
                  <span>Period: <strong>{selectedInvoice.period_start} → {selectedInvoice.period_end}</strong></span>
                  <span>Hours: <strong>{selectedInvoice.total_hours}h @ ${selectedInvoice.hourly_rate}/hr</strong></span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Payment Amount *</label>
                <input
                  type="number" step="0.01" min="0.01"
                  className={`input ${amountMismatch ? 'border-red-400 focus:ring-red-400' : ''}`}
                  value={form.amount}
                  onChange={e => setForm(f => ({...f, amount: e.target.value}))}
                  required
                />
                {amountMismatch && (
                  <p className="text-xs text-red-600 mt-1">
                    ⚠️ Invoice total is {money(selectedInvoice.total_amount)} — amounts differ
                  </p>
                )}
              </div>
              <div>
                <label className="label">Payment Date *</label>
                <input
                  type="date" className="input"
                  value={form.payment_date}
                  onChange={e => setForm(f => ({...f, payment_date: e.target.value}))}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Payment Method</label>
                <select className="input" value={form.payment_method} onChange={e => setForm(f => ({...f, payment_method: e.target.value}))}>
                  {METHODS.map(m => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Reference / Transaction ID</label>
                <input className="input" value={form.reference_number} onChange={e => setForm(f => ({...f, reference_number: e.target.value}))} placeholder="Bank ref, wire ID…" />
              </div>
            </div>

            <div>
              <label className="label">Notes</label>
              <textarea className="input h-16 resize-none" value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} placeholder="Optional notes about this payment…" />
            </div>

            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={saving || !form.invoice_id} className="btn-primary flex-1">
                {saving ? 'Confirming…' : '✅ Confirm & Record Payment'}
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={rejecting}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                {rejecting ? '…' : 'Dismiss'}
              </button>
              <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, highlight, className = '' }) {
  return (
    <div className={className}>
      <p className="text-gray-500 text-xs">{label}</p>
      <p className={`font-medium ${highlight ? 'text-blue-700 text-base' : 'text-gray-800'}`}>{value}</p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function EmailPayments() {
  const [imports, setImports]       = useState([]);
  const [invoices, setInvoices]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [polling, setPolling]       = useState(false);
  const [pollResult, setPollResult] = useState(null);
  const [filter, setFilter]         = useState('pending');
  const [showSettings, setShowSettings] = useState(false);
  const [reviewImport, setReviewImport] = useState(null);

  const loadImports = useCallback(() => {
    const params = filter ? { status: filter } : {};
    return api.get('/api/email-payments/imports', { params })
      .then(r => setImports(r.data))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { loadImports(); }, [loadImports]);

  useEffect(() => {
    // Load open invoices for the confirm modal dropdown
    api.get('/api/invoices', { params: { status: 'sent' } })
      .then(r => setInvoices(r.data))
      .catch(() => {});
    // Also include client_approved and overdue
    Promise.all([
      api.get('/api/invoices', { params: {} }),
    ]).then(([r]) => {
      setInvoices(r.data.filter(i => ['sent', 'client_approved', 'overdue', 'draft'].includes(i.status)));
    }).catch(() => {});
  }, []);

  const handlePoll = async () => {
    setPolling(true); setPollResult(null);
    try {
      const r = await api.post('/api/email-payments/poll');
      setPollResult(r.data);
      if (r.data.processed > 0) await loadImports();
    } catch (err) {
      setPollResult({ processed: 0, errors: [err.response?.data?.error || 'Poll failed'] });
    } finally {
      setPolling(false);
    }
  };

  const pending   = imports.filter(i => i.status === 'pending').length;
  const confirmed = imports.filter(i => i.status === 'confirmed').length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Email Payment Imports</h1>
          <p className="text-gray-500 mt-1">
            Auto-read payment confirmation emails · {pending} pending review · {confirmed} confirmed
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handlePoll} disabled={polling} className="btn-secondary flex items-center gap-2 text-sm">
            {polling ? <span className="animate-spin">↻</span> : '📬'} {polling ? 'Checking…' : 'Check Inbox Now'}
          </button>
          <button onClick={() => setShowSettings(true)} className="btn-primary flex items-center gap-2 text-sm">
            ⚙️ Email Settings
          </button>
        </div>
      </div>

      {/* Poll result banner */}
      {pollResult && (
        <div className={`mb-4 p-3 rounded-lg text-sm border ${
          pollResult.errors?.length ? 'bg-red-50 border-red-200 text-red-700' :
          pollResult.processed > 0   ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
          'bg-blue-50 border-blue-200 text-blue-700'
        }`}>
          {pollResult.errors?.length ? (
            <>❌ Poll error: {pollResult.errors.join('; ')}</>
          ) : pollResult.processed > 0 ? (
            <>✅ Imported {pollResult.processed} new payment email{pollResult.processed !== 1 ? 's' : ''}!</>
          ) : (
            <>📭 No new payment emails found.</>
          )}
          <button onClick={() => setPollResult(null)} className="ml-3 text-xs opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Info banner if no settings configured yet */}
      <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm">
        <p className="font-semibold text-amber-800 mb-1">📧 How it works</p>
        <p className="text-amber-700">
          Flow polls your inbox for emails matching the subject keyword (e.g. "payment").
          It reads the email body and any <strong>PDF attachments</strong>, extracts the amount, client, dates, and
          reference number, then auto-matches to an open invoice. You review and confirm before the payment is recorded.
          Works with <strong>Gmail</strong> (use an App Password) and <strong>Outlook / Microsoft 365</strong>.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-lg mb-4 w-fit">
        {[
          { key: 'pending',   label: '⏳ Pending', count: imports.filter(i => i.status === 'pending').length },
          { key: 'confirmed', label: '✅ Confirmed', count: null },
          { key: 'rejected',  label: '✕ Dismissed', count: null },
          { key: '',          label: 'All',          count: null },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
              filter === t.key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            {t.count != null && t.count > 0 && (
              <span className="inline-flex items-center justify-center w-5 h-5 text-xs bg-blue-600 text-white rounded-full">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Imports table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : imports.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <div className="text-5xl mb-3">📭</div>
            <p className="font-medium">No {filter} payment emails</p>
            {filter === 'pending' && (
              <div className="mt-4 space-y-2">
                <p className="text-sm">Set up your inbox connection, then click <strong>Check Inbox Now</strong></p>
                <button onClick={() => setShowSettings(true)} className="mt-2 btn-primary text-sm">⚙️ Configure Email</button>
              </div>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Email</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Extracted Amount</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Client</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Matched Invoice</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Match</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
                <th className="text-right px-4 py-3 text-gray-500 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {imports.map(imp => (
                <tr key={imp.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="max-w-xs">
                      <p className="font-medium text-gray-900 truncate">{imp.email_subject || '(no subject)'}</p>
                      <p className="text-xs text-gray-400 truncate">{imp.email_from}</p>
                      <p className="text-xs text-gray-400">{imp.email_date}</p>
                      {imp.has_attachment ? <span className="text-xs text-blue-500">📎 PDF</span> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {imp.parsed_amount != null ? (
                      <span className="text-lg font-bold text-gray-900">{money(imp.parsed_amount)}</span>
                    ) : (
                      <span className="text-gray-400 text-xs">Not detected</span>
                    )}
                    {imp.parsed_payment_date && <p className="text-xs text-gray-400">{imp.parsed_payment_date}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-800">{imp.parsed_client_name || '—'}</p>
                    {imp.parsed_invoice_number && (
                      <p className="text-xs text-gray-400">Invoice: {imp.parsed_invoice_number}</p>
                    )}
                    {imp.parsed_employee_names?.length > 0 && (
                      <p className="text-xs text-gray-400 truncate">{imp.parsed_employee_names.join(', ')}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {imp.invoice_number ? (
                      <div>
                        <p className="font-mono text-blue-600 text-xs font-medium">{imp.invoice_number}</p>
                        <p className="text-xs text-gray-500">{imp.invoice_candidate_name}</p>
                        <p className="text-xs text-gray-500">{money(imp.invoice_amount)}</p>
                      </div>
                    ) : (
                      <span className="text-gray-400 text-xs">No match</span>
                    )}
                    {imp.mismatch_flags?.length > 0 && (
                      <span className="inline-flex items-center text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-600 mt-1">
                        ⚠️ {imp.mismatch_flags.length} mismatch
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ConfidenceBadge level={imp.match_confidence} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip status={imp.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {imp.status === 'pending' ? (
                      <button
                        onClick={() => setReviewImport(imp)}
                        className="text-blue-600 hover:underline text-xs font-medium"
                      >
                        Review →
                      </button>
                    ) : (
                      <button
                        onClick={() => setReviewImport(imp)}
                        className="text-gray-400 hover:text-gray-600 text-xs"
                      >
                        View
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modals */}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {reviewImport && (
        <ReviewModal
          imp={reviewImport}
          invoices={invoices}
          onClose={() => setReviewImport(null)}
          onConfirmed={() => { setReviewImport(null); loadImports(); }}
          onRejected={() => { setReviewImport(null); loadImports(); }}
        />
      )}
    </div>
  );
}
