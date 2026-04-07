import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';

const STATUS_STYLES = {
  draft:           { bg: 'bg-gray-100',    text: 'text-gray-700',   label: 'Draft' },
  sent:            { bg: 'bg-blue-100',    text: 'text-blue-700',   label: 'Sent' },
  client_approved: { bg: 'bg-green-100',   text: 'text-green-700',  label: '✅ Approved' },
  paid:            { bg: 'bg-emerald-100', text: 'text-emerald-700',label: 'Paid' },
  overdue:         { bg: 'bg-red-100',     text: 'text-red-700',    label: 'Overdue' },
  cancelled:       { bg: 'bg-gray-100',    text: 'text-gray-500',   label: 'Cancelled' },
};

function StatusBadge({ status }) {
  const s = STATUS_STYLES[status] || { bg: 'bg-gray-100', text: 'text-gray-600', label: status };
  return <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${s.bg} ${s.text}`}>{s.label}</span>;
}

function Modal({ title, onClose, children, wide = false }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} my-8`}>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900 text-lg">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function InvoiceDetail({ invoiceId, onClose, onApproved }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingRow, setEditingRow] = useState(null); // line item id being edited
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState('');
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [actionMsg, setActionMsg] = useState('');
  const [downloading, setDownloading] = useState(false);

  const downloadPdf = async (inv) => {
    setDownloading(true);
    try {
      const res = await api.get(`/api/invoices/${inv.id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${inv.invoice_number}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Failed to download PDF. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/api/client-portal/invoices/${invoiceId}`)
      .then(r => {
        setData(r.data);
        setNotes(r.data.invoice.client_notes || '');
      })
      .catch(() => setError('Failed to load invoice'))
      .finally(() => setLoading(false));
  }, [invoiceId]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (item) => {
    setEditingRow(item.id);
    setEditForm({ date: item.date, description: item.description || '', hours: item.hours });
  };

  const cancelEdit = () => { setEditingRow(null); setEditForm({}); };

  const saveEdit = async (item) => {
    setSaving(true);
    try {
      await api.put(`/api/client-portal/invoices/${invoiceId}/line-items/${item.id}`, editForm);
      setEditingRow(null);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const saveNotes = async () => {
    try {
      await api.put(`/api/client-portal/invoices/${invoiceId}/notes`, { client_notes: notes });
      setActionMsg('Notes saved.');
      setTimeout(() => setActionMsg(''), 2000);
    } catch { /* silent */ }
  };

  const handleApprove = async () => {
    if (!window.confirm('Approve this invoice? This will notify the admin.')) return;
    setApproving(true);
    try {
      await api.post(`/api/client-portal/invoices/${invoiceId}/approve`, { client_notes: notes });
      setActionMsg('Invoice approved!');
      load();
      onApproved();
    } catch (err) {
      alert(err.response?.data?.error || 'Approval failed');
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    const reason = window.prompt('Please provide a reason for requesting a revision:');
    if (reason === null) return;
    setRejecting(true);
    try {
      await api.post(`/api/client-portal/invoices/${invoiceId}/reject`, { client_notes: reason || notes });
      setActionMsg('Revision requested.');
      load();
      onApproved();
    } catch (err) {
      alert(err.response?.data?.error || 'Action failed');
    } finally {
      setRejecting(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"/></div>;
  if (error) return <p className="text-red-600 py-8 text-center">{error}</p>;

  const { invoice, lineItems } = data;
  const canEdit = ['sent', 'draft'].includes(invoice.status);
  const canApprove = ['sent', 'draft'].includes(invoice.status);

  return (
    <>
      {/* Invoice header */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Invoice</p>
          <p className="font-bold text-xl text-gray-900">{invoice.invoice_number}</p>
          <p className="text-sm text-gray-600 mt-1">{invoice.candidate_name} · {invoice.candidate_role}</p>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-2 mb-1">
            <StatusBadge status={invoice.status} />
            <button
              onClick={() => downloadPdf(invoice)}
              disabled={downloading}
              className="text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium transition-colors"
            >
              {downloading ? '…' : '⬇️ PDF'}
            </button>
          </div>
          <p className="text-2xl font-bold text-gray-900 mt-2">
            ${Number(invoice.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </p>
          <p className="text-sm text-gray-400">{invoice.total_hours}h @ ${invoice.hourly_rate}/hr</p>
          <p className="text-xs text-gray-400 mt-1">Period: {invoice.period_start} → {invoice.period_end}</p>
          {invoice.due_date && <p className="text-xs text-gray-400">Due: {invoice.due_date}</p>}
        </div>
      </div>

      {/* Line items table */}
      <div className="mb-5">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">
          Line Items
          {canEdit && <span className="ml-2 text-xs font-normal text-blue-600">Click ✏️ to edit dates or hours</span>}
        </h4>
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Date</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Description</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Hours</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Rate</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Amount</th>
                {canEdit && <th className="px-4 py-3"/>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lineItems.map(item => (
                <tr key={item.id} className="hover:bg-gray-50">
                  {editingRow === item.id ? (
                    <>
                      <td className="px-4 py-2">
                        <input type="date" className="input text-sm py-1 w-36"
                          value={editForm.date} onChange={e => setEditForm(f => ({ ...f, date: e.target.value }))} />
                      </td>
                      <td className="px-4 py-2">
                        <input type="text" className="input text-sm py-1 w-full"
                          value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
                      </td>
                      <td className="px-4 py-2">
                        <input type="number" step="0.25" min="0.25" max="24" className="input text-sm py-1 w-20 text-right"
                          value={editForm.hours} onChange={e => setEditForm(f => ({ ...f, hours: e.target.value }))} />
                      </td>
                      <td className="px-4 py-2 text-right text-gray-500">${item.rate}</td>
                      <td className="px-4 py-2 text-right text-gray-500">
                        ${(parseFloat(editForm.hours || 0) * item.rate).toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => saveEdit(item)} disabled={saving} className="text-xs bg-blue-600 text-white px-2 py-1 rounded mr-1 hover:bg-blue-700 disabled:opacity-50">Save</button>
                        <button onClick={cancelEdit} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded border">×</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-gray-700">{item.date}</td>
                      <td className="px-4 py-3 text-gray-600">{item.description || '—'}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{item.hours}h</td>
                      <td className="px-4 py-3 text-right text-gray-500">${item.rate}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">${Number(item.amount).toFixed(2)}</td>
                      {canEdit && (
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => startEdit(item)} className="text-gray-400 hover:text-blue-600 text-base" title="Edit">✏️</button>
                        </td>
                      )}
                    </>
                  )}
                </tr>
              ))}
              {lineItems.length === 0 && (
                <tr><td colSpan="6" className="px-4 py-8 text-center text-gray-400 text-sm">No line items</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50">
                <td colSpan="2" className="px-4 py-3 font-semibold text-gray-700">Total</td>
                <td className="px-4 py-3 text-right font-bold text-gray-900">{invoice.total_hours}h</td>
                <td/>
                <td className="px-4 py-3 text-right font-bold text-gray-900">${Number(invoice.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                {canEdit && <td/>}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Notes */}
      <div className="mb-5">
        <label className="text-sm font-semibold text-gray-700 block mb-2">Your Notes / Comments</label>
        <textarea
          rows={3}
          className="input w-full resize-none"
          placeholder="Add any comments or notes for the admin…"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          disabled={invoice.status === 'paid' || invoice.status === 'cancelled'}
        />
        {invoice.status !== 'paid' && invoice.status !== 'cancelled' && (
          <button onClick={saveNotes} className="mt-2 text-xs text-blue-600 hover:underline">Save notes</button>
        )}
        {actionMsg && <p className="mt-1 text-xs text-green-600">{actionMsg}</p>}
      </div>

      {/* Actions */}
      {canApprove && (
        <div className="flex items-center gap-3 justify-end border-t pt-4">
          <button
            onClick={handleReject}
            disabled={rejecting}
            className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {rejecting ? 'Sending…' : '↩ Request Revision'}
          </button>
          <button
            onClick={handleApprove}
            disabled={approving}
            className="px-5 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
          >
            {approving ? 'Approving…' : '✅ Approve Invoice'}
          </button>
        </div>
      )}
      {invoice.status === 'client_approved' && (
        <div className="border-t pt-4">
          <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm">
            <span className="text-lg">✅</span>
            <span>You have approved this invoice. The admin will process payment.</span>
          </div>
          <button
            onClick={handleReject}
            disabled={rejecting}
            className="mt-3 text-xs text-gray-500 hover:text-orange-600 underline"
          >
            Withdraw approval / request revision
          </button>
        </div>
      )}
    </>
  );
}

export default function ClientInvoices() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState('all');

  const load = () => {
    api.get('/api/client-portal/invoices')
      .then(r => setInvoices(r.data.invoices))
      .catch(() => setError('Failed to load invoices.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filtered = filter === 'all' ? invoices : invoices.filter(i => i.status === filter);

  const totals = {
    total: invoices.reduce((s, i) => s + i.total_amount, 0),
    approved: invoices.filter(i => i.status === 'client_approved').reduce((s, i) => s + i.total_amount, 0),
    pending: invoices.filter(i => ['sent', 'draft'].includes(i.status)).reduce((s, i) => s + i.total_amount, 0),
    paid: invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.total_amount, 0),
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"/></div>;
  if (error) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <p className="text-gray-500">⚠️ {error}</p>
      <button onClick={load} className="btn-primary">Retry</button>
    </div>
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
        <p className="text-gray-500 mt-1">Review, edit, and approve invoices from your team</p>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total', value: totals.total, color: 'text-gray-900' },
          { label: 'Awaiting Approval', value: totals.pending, color: 'text-blue-600' },
          { label: 'Approved', value: totals.approved, color: 'text-green-600' },
          { label: 'Paid', value: totals.paid, color: 'text-emerald-600' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className={`text-xl font-bold ${k.color}`}>
              ${Number(k.value).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4 border-b border-gray-200 pb-3">
        {['all', 'sent', 'client_approved', 'paid', 'draft'].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
              filter === s ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {s === 'all' ? 'All' : STATUS_STYLES[s]?.label || s}
            <span className="ml-1.5 text-xs opacity-70">
              {s === 'all' ? invoices.length : invoices.filter(i => i.status === s).length}
            </span>
          </button>
        ))}
      </div>

      {/* Invoice cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">No invoices found</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(inv => (
            <div
              key={inv.id}
              className="bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 transition-colors cursor-pointer"
              onClick={() => setSelectedId(inv.id)}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-gray-900">{inv.invoice_number}</p>
                    <StatusBadge status={inv.status} />
                    {['sent', 'draft'].includes(inv.status) && (
                      <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
                        ⚡ Action Required
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 mt-1">{inv.candidate_name} · {inv.candidate_role}</p>
                  <p className="text-xs text-gray-400 mt-1">{inv.period_start} → {inv.period_end}</p>
                  {inv.due_date && (
                    <p className="text-xs text-gray-400">Due: {inv.due_date}</p>
                  )}
                  {inv.client_notes && (
                    <p className="text-xs text-gray-500 mt-2 italic">Note: {inv.client_notes}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xl font-bold text-gray-900">
                    ${Number(inv.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-sm text-gray-400">{inv.total_hours}h @ ${inv.hourly_rate}/hr</p>
                  <button className="mt-2 text-xs text-blue-600 font-medium hover:underline">
                    View & Review →
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail modal */}
      {selectedId && (
        <Modal
          title={`Invoice Detail`}
          onClose={() => { setSelectedId(null); load(); }}
          wide
        >
          <InvoiceDetail
            invoiceId={selectedId}
            onClose={() => { setSelectedId(null); load(); }}
            onApproved={load}
          />
        </Modal>
      )}
    </div>
  );
}
