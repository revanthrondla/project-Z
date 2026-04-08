import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';

function Modal({ title, onClose, children, wide = false }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-xl shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900 text-lg">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ── Payment Reader Panel ─────────────────────────────────────────────────────
const PAYMENT_METHODS = ['bank_transfer', 'cash', 'cheque', 'credit_card', 'other'];
const METHOD_LABELS = { bank_transfer: 'Bank Transfer', cash: 'Cash', cheque: 'Cheque', credit_card: 'Credit Card', other: 'Other' };

function PaymentsPanel({ invoice, onPaymentChange }) {
  const [payments, setPayments]   = useState([]);
  const [totalPaid, setTotalPaid] = useState(0);
  const [balance, setBalance]     = useState(0);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [form, setForm]           = useState({
    amount: '',
    payment_date: new Date().toISOString().slice(0, 10),
    payment_method: 'bank_transfer',
    reference_number: '',
    notes: '',
  });

  const loadPayments = useCallback(() => {
    setLoading(true);
    api.get(`/api/invoices/${invoice.id}/payments`)
      .then(r => {
        setPayments(r.data.payments || []);
        setTotalPaid(r.data.totalPaid || 0);
        setBalance(r.data.balance ?? invoice.total_amount);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [invoice.id, invoice.total_amount]);

  useEffect(() => { loadPayments(); }, [loadPayments]);

  const recordPayment = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.amount || parseFloat(form.amount) <= 0) { setError('Enter a valid amount'); return; }
    setSaving(true);
    try {
      await api.post(`/api/invoices/${invoice.id}/payments`, {
        ...form,
        amount: parseFloat(form.amount),
      });
      setForm({ amount: '', payment_date: new Date().toISOString().slice(0, 10), payment_method: 'bank_transfer', reference_number: '', notes: '' });
      setShowForm(false);
      loadPayments();
      onPaymentChange();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  };

  const deletePayment = async (paymentId) => {
    if (!confirm('Remove this payment record?')) return;
    try {
      await api.delete(`/api/invoices/${invoice.id}/payments/${paymentId}`);
      loadPayments();
      onPaymentChange();
    } catch { /* ignore */ }
  };

  const fmtMoney = n => `$${Number(n).toFixed(2)}`;
  const paidPct  = invoice.total_amount > 0 ? Math.min(100, (totalPaid / invoice.total_amount) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div className="bg-emerald-50 rounded-lg p-3">
          <p className="text-xs text-blue-500 mb-0.5">Invoice Total</p>
          <p className="font-bold text-emerald-700">{fmtMoney(invoice.total_amount)}</p>
        </div>
        <div className="bg-green-50 rounded-lg p-3">
          <p className="text-xs text-green-500 mb-0.5">Total Paid</p>
          <p className="font-bold text-green-700">{fmtMoney(totalPaid)}</p>
        </div>
        <div className={`rounded-lg p-3 ${balance <= 0 ? 'bg-emerald-50' : 'bg-amber-50'}`}>
          <p className={`text-xs mb-0.5 ${balance <= 0 ? 'text-emerald-500' : 'text-amber-500'}`}>Balance Due</p>
          <p className={`font-bold ${balance <= 0 ? 'text-emerald-700' : 'text-amber-700'}`}>{balance <= 0 ? '✅ Paid in Full' : fmtMoney(balance)}</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-100 rounded-full h-2">
        <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${paidPct}%` }} />
      </div>

      {/* Payment history */}
      {loading ? (
        <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-600" /></div>
      ) : payments.length === 0 ? (
        <div className="text-center py-8 text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
          <p className="text-2xl mb-1">💳</p>
          <p className="text-sm">No payments recorded yet</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-3 py-2.5 text-gray-500 font-medium text-xs">Date</th>
                <th className="text-left px-3 py-2.5 text-gray-500 font-medium text-xs">Method</th>
                <th className="text-left px-3 py-2.5 text-gray-500 font-medium text-xs">Reference</th>
                <th className="text-right px-3 py-2.5 text-gray-500 font-medium text-xs">Amount</th>
                <th className="px-3 py-2.5 text-xs" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {payments.map(p => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2.5 text-gray-700">{p.payment_date}</td>
                  <td className="px-3 py-2.5">
                    <span className="bg-blue-100 text-emerald-700 text-xs px-2 py-0.5 rounded-full font-medium">
                      {METHOD_LABELS[p.payment_method] || p.payment_method}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-500 text-xs font-mono">{p.reference_number || '—'}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-green-700">{fmtMoney(p.amount)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button onClick={() => deletePayment(p.id)} className="text-gray-300 hover:text-red-400 text-lg leading-none" title="Remove">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Record Payment form */}
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          disabled={balance <= 0}
          className="w-full py-2 border-2 border-dashed border-green-200 text-green-600 rounded-lg text-sm font-medium hover:border-green-400 hover:bg-green-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + Record Payment
        </button>
      ) : (
        <form onSubmit={recordPayment} className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-3">
          <h4 className="font-semibold text-gray-800 text-sm">Record New Payment</h4>
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Amount *</label>
              <input type="number" step="0.01" min="0.01" className="input text-sm" placeholder="0.00"
                value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Payment Date *</label>
              <input type="date" className="input text-sm"
                value={form.payment_date} onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))} required />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Method</label>
              <select className="input text-sm" value={form.payment_method} onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}>
                {PAYMENT_METHODS.map(m => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Reference #</label>
              <input type="text" className="input text-sm" placeholder="TXN-001234"
                value={form.reference_number} onChange={e => setForm(f => ({ ...f, reference_number: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-500 block mb-1">Notes</label>
              <input type="text" className="input text-sm" placeholder="Optional notes…"
                value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="btn-primary text-sm py-1.5 flex-1">{saving ? 'Saving…' : '💾 Save Payment'}</button>
            <button type="button" onClick={() => { setShowForm(false); setError(''); }} className="btn-secondary text-sm py-1.5">Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── Invoice Detail Modal ─────────────────────────────────────────────────────

function InvoiceDetail({ invoice: initialInvoice, onClose, onStatusChange }) {
  const [invoice, setInvoice] = useState(initialInvoice);
  const [tab, setTab]         = useState('details');
  const [status, setStatus]   = useState(initialInvoice.status);
  const [saving, setSaving]   = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Reload invoice after a payment (status may have auto-changed to 'paid')
  const reloadInvoice = useCallback(() => {
    api.get(`/api/invoices/${invoice.id}`).then(r => {
      setInvoice(r.data);
      setStatus(r.data.status);
    }).catch(() => {});
    onStatusChange();
  }, [invoice.id, onStatusChange]);

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const res = await api.get(`/api/invoices/${invoice.id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${invoice.invoice_number}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Failed to download PDF. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const handleStatusChange = async () => {
    setSaving(true);
    try {
      await api.put(`/api/invoices/${invoice.id}`, { status });
      onStatusChange();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const printInvoice = () => {
    const win = window.open('', '_blank');
    win.document.write(`
      <html><head><title>Invoice ${invoice.invoice_number}</title>
      <style>
        body { font-family: sans-serif; padding: 40px; color: #111; }
        .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
        .logo { font-size: 24px; font-weight: bold; color: #2563eb; }
        h2 { color: #6b7280; font-weight: normal; font-size: 14px; }
        table { width: 100%; border-collapse: collapse; margin-top: 24px; }
        th { text-align: left; border-bottom: 2px solid #e5e7eb; padding: 8px; font-size: 13px; color: #6b7280; }
        td { padding: 8px; border-bottom: 1px solid #f3f4f6; font-size: 13px; }
        .total { text-align: right; margin-top: 20px; font-size: 18px; font-weight: bold; }
        .meta { margin-bottom: 20px; }
        .meta p { margin: 4px 0; font-size: 13px; color: #374151; }
      </style></head>
      <body>
        <div class="header">
          <div><div class="logo">Flow</div><p style="color:#6b7280;font-size:13px">Workforce Platform</p></div>
          <div style="text-align:right">
            <div style="font-size:20px;font-weight:bold">${invoice.invoice_number}</div>
            <p style="color:#6b7280;font-size:13px">Status: ${invoice.status.toUpperCase()}</p>
            ${invoice.due_date ? `<p style="color:#6b7280;font-size:13px">Due: ${invoice.due_date}</p>` : ''}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:30px">
          <div><h2>BILL FROM</h2><p style="font-weight:bold">${invoice.candidate_name}</p><p>${invoice.candidate_email || ''}</p></div>
          <div><h2>BILL TO</h2><p style="font-weight:bold">${invoice.client_name || 'N/A'}</p><p>${invoice.client_email || ''}</p><p>${invoice.client_address || ''}</p></div>
        </div>
        <div class="meta">
          <p><strong>Period:</strong> ${invoice.period_start} to ${invoice.period_end}</p>
          <p><strong>Hourly Rate:</strong> $${invoice.hourly_rate}/hr</p>
        </div>
        <table>
          <thead><tr><th>Date</th><th>Description</th><th>Hours</th><th>Rate</th><th>Amount</th></tr></thead>
          <tbody>
            ${(invoice.line_items || []).map(li => `
              <tr><td>${li.date}</td><td>${li.description || ''}</td><td>${li.hours}</td><td>$${li.rate}</td><td>$${li.amount.toFixed(2)}</td></tr>
            `).join('')}
          </tbody>
        </table>
        <div class="total">Total: $${invoice.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
      </body></html>
    `);
    win.document.close();
    win.print();
  };

  const TABS = [
    { id: 'details',  label: '📋 Details' },
    { id: 'payments', label: '💳 Payments' },
  ];

  return (
    <Modal title={`Invoice ${invoice.invoice_number}`} onClose={onClose} wide>
      {/* Tab bar */}
      <div className="flex gap-1 mb-5 border-b border-gray-100 -mt-2">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t.id ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'details' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="bg-gray-50 p-3 rounded-lg">
              <p className="text-gray-500 text-xs mb-1">Employee</p>
              <p className="font-medium">{invoice.candidate_name}</p>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg">
              <p className="text-gray-500 text-xs mb-1">Client</p>
              <p className="font-medium">{invoice.client_name || 'N/A'}</p>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg">
              <p className="text-gray-500 text-xs mb-1">Period</p>
              <p className="font-medium">{invoice.period_start} — {invoice.period_end}</p>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg">
              <p className="text-gray-500 text-xs mb-1">Due Date</p>
              <p className="font-medium">{invoice.due_date || 'Not set'}</p>
            </div>
            <div className="bg-emerald-50 p-3 rounded-lg">
              <p className="text-blue-500 text-xs mb-1">Total Hours</p>
              <p className="font-bold text-emerald-700">{invoice.total_hours}h @ ${invoice.hourly_rate}/hr</p>
            </div>
            <div className="bg-green-50 p-3 rounded-lg">
              <p className="text-green-500 text-xs mb-1">Total Amount</p>
              <p className="font-bold text-green-700 text-lg">${invoice.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
            </div>
          </div>

          {invoice.line_items?.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Line Items</h4>
              <div className="border border-gray-100 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50"><tr>
                    <th className="text-left px-3 py-2 text-gray-500">Date</th>
                    <th className="text-left px-3 py-2 text-gray-500">Description</th>
                    <th className="text-right px-3 py-2 text-gray-500">Hrs</th>
                    <th className="text-right px-3 py-2 text-gray-500">Amount</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {invoice.line_items.map((li, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2">{li.date}</td>
                        <td className="px-3 py-2 text-gray-500">{li.description}</td>
                        <td className="px-3 py-2 text-right font-medium">{li.hours}</td>
                        <td className="px-3 py-2 text-right font-medium">${li.amount.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">Update Status</label>
              <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="client_approved">Client Approved</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="flex gap-2 pt-5">
              <button onClick={handleStatusChange} disabled={saving} className="btn-primary text-sm py-2">Save</button>
              <button onClick={printInvoice} className="btn-secondary text-sm py-2">🖨️ Print</button>
              <button onClick={downloadPdf} disabled={downloading} className="btn-secondary text-sm py-2">
                {downloading ? '…' : '⬇️ PDF'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'payments' && (
        <PaymentsPanel invoice={invoice} onPaymentChange={reloadInvoice} />
      )}
    </Modal>
  );
}

function GenerateModal({ candidates, clients, onClose, onGenerated }) {
  const [mode, setMode]                 = useState('employee'); // 'employee' | 'client'
  const [selectedIds, setSelectedIds]   = useState([]);         // candidate IDs checked
  const [selectedClient, setSelectedClient] = useState('');
  const [search, setSearch]             = useState('');
  const [period_start, setPeriodStart]  = useState('');
  const [period_end, setPeriodEnd]      = useState('');
  const [due_date, setDueDate]          = useState('');
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');
  const [results, setResults]           = useState(null); // bulk results after generation

  // When client changes in client mode, pre-select all their employees
  useEffect(() => {
    if (mode === 'client' && selectedClient) {
      const ids = candidates
        .filter(c => String(c.client_id) === String(selectedClient))
        .map(c => c.id);
      setSelectedIds(ids);
    }
  }, [selectedClient, mode, candidates]);

  // When switching modes, reset selection
  useEffect(() => {
    setSelectedIds([]);
    setSelectedClient('');
    setSearch('');
  }, [mode]);

  // Visible candidates list
  const visibleCandidates = candidates.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase());
    if (mode === 'client' && selectedClient) {
      return String(c.client_id) === String(selectedClient) && matchesSearch;
    }
    return matchesSearch;
  });

  const toggleCandidate = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    const allIds = visibleCandidates.map(c => c.id);
    const allSelected = allIds.every(id => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds(prev => prev.filter(id => !allIds.includes(id)));
    } else {
      setSelectedIds(prev => [...new Set([...prev, ...allIds])]);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!period_start || !period_end) { setError('Period start and end are required'); return; }
    if (selectedIds.length === 0) { setError('Select at least one employee'); return; }
    setLoading(true);
    try {
      const payload = { candidate_ids: selectedIds, period_start, period_end, due_date: due_date || undefined };
      const r = await api.post('/api/invoices/generate', payload);
      // Bulk response
      if (r.data.results) {
        setResults(r.data);
        onGenerated();
      } else {
        // Single-invoice legacy response
        onGenerated();
        onClose();
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  if (results) {
    return (
      <Modal title="Generation Results" onClose={onClose} wide>
        <div className="space-y-3">
          <div className="flex gap-4 text-sm font-medium">
            <span className="text-emerald-600">✅ {results.generated} generated</span>
            <span className="text-yellow-600">⏭ {results.skipped} skipped</span>
            {results.errors > 0 && <span className="text-red-600">❌ {results.errors} errors</span>}
          </div>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-2 text-gray-500 font-medium">Employee</th>
                  <th className="text-left px-4 py-2 text-gray-500 font-medium">Status</th>
                  <th className="text-left px-4 py-2 text-gray-500 font-medium">Invoice #</th>
                  <th className="text-right px-4 py-2 text-gray-500 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {results.results.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-900">{r.candidate_name || `Employee #${r.candidate_id}`}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${
                        r.status === 'generated' ? 'bg-emerald-100 text-emerald-700' :
                        r.status === 'skipped'   ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {r.status === 'generated' ? '✅ Generated' : r.status === 'skipped' ? '⏭ Skipped' : '❌ Error'}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-emerald-600">{r.invoice_number || '—'}</td>
                    <td className="px-4 py-2 text-right font-bold">
                      {r.total_amount != null ? `$${Number(r.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : r.reason || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end pt-2">
            <button onClick={onClose} className="btn-primary">Done</button>
          </div>
        </div>
      </Modal>
    );
  }

  const allVisible = visibleCandidates.length > 0 && visibleCandidates.every(c => selectedIds.includes(c.id));

  return (
    <Modal title="Generate Invoices" onClose={onClose} wide>
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

      {/* Mode switcher */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-lg mb-4 w-fit">
        <button
          type="button"
          onClick={() => setMode('employee')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === 'employee' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
        >
          👤 By Employee
        </button>
        <button
          type="button"
          onClick={() => setMode('client')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === 'client' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
        >
          🏢 By Client
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Client selector (client mode only) */}
        {mode === 'client' && (
          <div>
            <label className="label">Client *</label>
            <select
              className="input"
              value={selectedClient}
              onChange={e => setSelectedClient(e.target.value)}
              required={mode === 'client'}
            >
              <option value="">Select client...</option>
              {clients.map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
            </select>
          </div>
        )}

        {/* Employee picker */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="label mb-0">
              {mode === 'client' ? 'Employees under selected client' : 'Select Employees *'}
            </label>
            {visibleCandidates.length > 0 && (
              <button type="button" onClick={toggleAll} className="text-xs text-emerald-600 hover:underline">
                {allVisible ? 'Deselect all' : 'Select all'}
              </button>
            )}
          </div>
          <input
            type="text"
            className="input mb-2"
            placeholder="Search employees..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="border rounded-lg max-h-48 overflow-y-auto divide-y divide-gray-50">
            {visibleCandidates.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">
                {mode === 'client' && !selectedClient ? 'Select a client first' : 'No employees found'}
              </p>
            ) : visibleCandidates.map(c => (
              <label key={c.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(c.id)}
                  onChange={() => toggleCandidate(c.id)}
                  className="rounded border-gray-300 text-emerald-600"
                />
                <span className="flex-1 text-sm font-medium text-gray-900">{c.name}</span>
                <span className="text-xs text-gray-400">${c.hourly_rate}/hr</span>
                {c.client_name && <span className="text-xs text-gray-400">{c.client_name}</span>}
              </label>
            ))}
          </div>
          {selectedIds.length > 0 && (
            <p className="text-xs text-emerald-600 mt-1.5 font-medium">
              {selectedIds.length} employee{selectedIds.length !== 1 ? 's' : ''} selected — will generate {selectedIds.length} invoice{selectedIds.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        {/* Period dates */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Period Start *</label>
            <input type="date" className="input" value={period_start} onChange={e => setPeriodStart(e.target.value)} required />
          </div>
          <div>
            <label className="label">Period End *</label>
            <input type="date" className="input" value={period_end} onChange={e => setPeriodEnd(e.target.value)} required />
          </div>
        </div>
        <div>
          <label className="label">Due Date</label>
          <input type="date" className="input" value={due_date} onChange={e => setDueDate(e.target.value)} />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={loading || selectedIds.length === 0} className="btn-primary flex-1">
            {loading ? 'Generating…' : `Generate ${selectedIds.length > 1 ? `${selectedIds.length} Invoices` : 'Invoice'}`}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

export default function AdminInvoices() {
  const [invoices, setInvoices]     = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [clients, setClients]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [filters, setFilters]       = useState({ status: '', candidate_id: '' });
  const [viewInvoice, setViewInvoice]   = useState(null);
  const [invoiceDetail, setInvoiceDetail] = useState(null);
  const [showGenerate, setShowGenerate]   = useState(false);

  const load = () => {
    const params = {};
    if (filters.status) params.status = filters.status;
    if (filters.candidate_id) params.candidate_id = filters.candidate_id;
    return api.get('/api/invoices', { params })
      .then(r => setInvoices(r.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    api.get('/api/candidates').then(r => setCandidates(r.data));
    api.get('/api/clients').then(r => setClients(r.data));
  }, []);
  useEffect(() => { load(); }, [filters]);

  const handleView = async (inv) => {
    const r = await api.get(`/api/invoices/${inv.id}`);
    setInvoiceDetail(r.data);
  };

  const totalRevenue = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.total_amount, 0);
  const totalPending = invoices.filter(i => ['sent', 'draft'].includes(i.status)).reduce((s, i) => s + i.total_amount, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
          <p className="text-gray-500 mt-1">{invoices.length} invoices · ${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })} paid · ${totalPending.toLocaleString('en-US', { minimumFractionDigits: 2 })} pending</p>
        </div>
        <button onClick={() => setShowGenerate(true)} className="btn-primary">⚡ Generate Invoice</button>
      </div>

      <div className="flex gap-3 mb-4">
        <select className="input max-w-[160px]" value={filters.status} onChange={e => setFilters({...filters, status: e.target.value})}>
          <option value="">All Status</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="client_approved">Client Approved</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select className="input max-w-[200px]" value={filters.candidate_id} onChange={e => setFilters({...filters, candidate_id: e.target.value})}>
          <option value="">All Employees</option>
          {candidates.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div></div>
        ) : invoices.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-2">📄</div>
            <p>No invoices found</p>
            <button onClick={() => setShowGenerate(true)} className="mt-4 btn-primary text-sm">Generate your first invoice</button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Invoice #</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Employee</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Client</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Period</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Hours</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Amount</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Due</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
                <th className="text-right px-4 py-3 text-gray-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {invoices.map(inv => (
                <tr key={inv.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-emerald-600 font-medium">{inv.invoice_number}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{inv.candidate_name}</td>
                  <td className="px-4 py-3 text-gray-500">{inv.client_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{inv.period_start}<br />{inv.period_end}</td>
                  <td className="px-4 py-3 text-gray-700">{inv.total_hours}h</td>
                  <td className="px-4 py-3 font-bold text-gray-900">${inv.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-gray-500">{inv.due_date || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center text-xs px-2.5 py-1 rounded-full font-medium ${
                      inv.status === 'paid' ? 'bg-emerald-100 text-emerald-700' :
                      inv.status === 'client_approved' ? 'bg-green-100 text-green-700' :
                      inv.status === 'sent' ? 'bg-blue-100 text-emerald-700' :
                      inv.status === 'overdue' ? 'bg-red-100 text-red-700' :
                      inv.status === 'cancelled' ? 'bg-gray-100 text-gray-400' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {inv.status === 'client_approved' ? '✅ Client Approved' : inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleView(inv)} className="text-emerald-600 hover:underline text-xs">View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {invoiceDetail && (
        <InvoiceDetail invoice={invoiceDetail} onClose={() => setInvoiceDetail(null)} onStatusChange={load} />
      )}
      {showGenerate && (
        <GenerateModal candidates={candidates} clients={clients} onClose={() => setShowGenerate(false)} onGenerated={load} />
      )}
    </div>
  );
}
