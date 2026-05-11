import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (d) => d ? new Date(d).toLocaleDateString() : '—';
const fmtDateTime = (d) => d ? new Date(d).toLocaleString() : 'Never';

const EVENT_LABELS = {
  'employee.created':    'Employee Created',
  'employee.updated':    'Employee Updated',
  'employee.deleted':    'Employee Deleted',
  'timesheet.submitted': 'Timesheet Submitted',
  'timesheet.approved':  'Timesheet Approved',
  'timesheet.rejected':  'Timesheet Rejected',
  'invoice.created':     'Invoice Created',
  'invoice.sent':        'Invoice Sent',
  'invoice.paid':        'Invoice Paid',
  'absence.requested':   'Absence Requested',
  'absence.approved':    'Absence Approved',
  'absence.rejected':    'Absence Rejected',
  'expense.submitted':   'Expense Submitted',
  'expense.approved':    'Expense Approved',
};

const ALL_EVENTS = Object.keys(EVENT_LABELS);

// ═══════════════════════════════════════════════════════════════════════════
// API KEYS TAB
// ═══════════════════════════════════════════════════════════════════════════

function NewKeyModal({ onClose, onCreated }) {
  const [name, setName]         = useState('');
  const [scopes, setScopes]     = useState(['read']);
  const [expires, setExpires]   = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [revealed, setRevealed] = useState(null); // plaintext key after creation

  const SCOPE_OPTIONS = ['read', 'write', 'admin'];

  function toggleScope(s) {
    setScopes(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  }

  async function handleCreate() {
    if (!name.trim()) { setError('Name is required'); return; }
    if (scopes.length === 0) { setError('Select at least one scope'); return; }
    setSaving(true); setError('');
    try {
      const { data } = await axios.post('/api/integrations/api-keys', {
        name: name.trim(),
        scopes,
        expires_at: expires || undefined,
      });
      setRevealed(data.key);
      onCreated(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create API key');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <h3 style={{ margin: 0 }}>Create API Key</h3>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        {revealed ? (
          <div style={{ padding: '1.5rem' }}>
            <div style={{ ...styles.alertSuccess, marginBottom: '1rem' }}>
              ✅ API key created successfully. <strong>Copy it now — it won't be shown again.</strong>
            </div>
            <label style={styles.label}>Your API Key</label>
            <div style={styles.keyRevealBox}>
              <code style={{ wordBreak: 'break-all', fontSize: '0.85rem' }}>{revealed}</code>
            </div>
            <button
              style={styles.btnPrimary}
              onClick={() => { navigator.clipboard.writeText(revealed); }}
            >
              📋 Copy to Clipboard
            </button>
            <button style={{ ...styles.btnSecondary, marginLeft: '0.5rem' }} onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <div style={{ padding: '1.5rem' }}>
            {error && <div style={styles.alertError}>{error}</div>}

            <div style={styles.formGroup}>
              <label style={styles.label}>Key Name *</label>
              <input
                style={styles.input}
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. CI/CD Pipeline, Zapier Integration"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Scopes *</label>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {SCOPE_OPTIONS.map(s => (
                  <label key={s} style={styles.checkLabel}>
                    <input
                      type="checkbox"
                      checked={scopes.includes(s)}
                      onChange={() => toggleScope(s)}
                    />
                    <span style={{ marginLeft: '0.35rem', textTransform: 'capitalize' }}>{s}</span>
                  </label>
                ))}
              </div>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Expiry Date (optional)</label>
              <input
                type="date"
                style={styles.input}
                value={expires}
                onChange={e => setExpires(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem' }}>
              <button style={styles.btnPrimary} onClick={handleCreate} disabled={saving}>
                {saving ? 'Creating…' : 'Create Key'}
              </button>
              <button style={styles.btnSecondary} onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ApiKeysTab() {
  const [keys, setKeys]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [error, setError]         = useState('');
  const [revoking, setRevoking]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/integrations/api-keys');
      setKeys(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function revoke(id) {
    if (!window.confirm('Revoke this API key? Any integrations using it will stop working immediately.')) return;
    setRevoking(id);
    try {
      await axios.delete(`/api/integrations/api-keys/${id}`);
      setKeys(prev => prev.filter(k => k.id !== id));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to revoke key');
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div>
      {showModal && (
        <NewKeyModal
          onClose={() => setShowModal(false)}
          onCreated={(k) => { setKeys(prev => [k, ...prev]); setShowModal(false); }}
        />
      )}

      <div style={styles.sectionHeader}>
        <div>
          <h2 style={styles.sectionTitle}>API Keys</h2>
          <p style={styles.sectionDesc}>
            Personal access tokens for programmatic access to the HireIQ API.
          </p>
        </div>
        <button style={styles.btnPrimary} onClick={() => setShowModal(true)}>+ New API Key</button>
      </div>

      {error && <div style={styles.alertError}>{error}</div>}

      {loading ? (
        <div style={styles.loading}>Loading API keys…</div>
      ) : keys.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>🔑</div>
          <p>No API keys yet. Create one to enable programmatic access.</p>
        </div>
      ) : (
        <div style={styles.tableWrapper}>
          <table style={styles.table}>
            <thead>
              <tr>
                {['Name', 'Prefix', 'Scopes', 'Last Used', 'Expires', 'Created', ''].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keys.map(k => (
                <tr key={k.id} style={styles.tr}>
                  <td style={styles.td}><strong>{k.name}</strong></td>
                  <td style={styles.td}><code style={styles.code}>{k.key_prefix}…</code></td>
                  <td style={styles.td}>
                    {(typeof k.scopes === 'string' ? k.scopes.split(',') : k.scopes ?? []).map(s => (
                      <span key={s} style={{ ...styles.badge, ...scopeBadge(s) }}>{s}</span>
                    ))}
                  </td>
                  <td style={styles.td}>{fmtDateTime(k.last_used_at)}</td>
                  <td style={styles.td}>{k.expires_at ? fmt(k.expires_at) : 'Never'}</td>
                  <td style={styles.td}>{fmt(k.created_at)}</td>
                  <td style={styles.td}>
                    <button
                      style={styles.btnDanger}
                      onClick={() => revoke(k.id)}
                      disabled={revoking === k.id}
                    >
                      {revoking === k.id ? 'Revoking…' : 'Revoke'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={styles.infoBox}>
        <strong>How to use your API key</strong>
        <p style={{ margin: '0.5rem 0 0' }}>
          Pass the key in the <code>Authorization</code> header: <code>Authorization: Bearer hiq_&lt;your-key&gt;</code>
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOKS TAB
// ═══════════════════════════════════════════════════════════════════════════

function WebhookModal({ webhook, onClose, onSaved }) {
  const isEdit = !!webhook;

  const [name, setName]               = useState(webhook?.name || '');
  const [url, setUrl]                 = useState(webhook?.url || '');
  const [events, setEvents]           = useState(
    Array.isArray(webhook?.events) ? webhook.events : []
  );
  const [isActive, setIsActive]       = useState(webhook?.is_active ?? true);
  const [genSecret, setGenSecret]     = useState(false);
  const [regenSecret, setRegenSecret] = useState(false);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');
  const [newSecret, setNewSecret]     = useState(null);

  function toggleEvent(e) {
    setEvents(prev => prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e]);
  }

  function toggleAll() {
    setEvents(prev => prev.length === ALL_EVENTS.length ? [] : [...ALL_EVENTS]);
  }

  async function handleSave() {
    if (!name.trim())  { setError('Name is required'); return; }
    if (!url.trim())   { setError('URL is required'); return; }
    if (events.length === 0) { setError('Select at least one event'); return; }

    setSaving(true); setError('');
    try {
      let res;
      if (isEdit) {
        res = await axios.put(`/api/integrations/webhooks/${webhook.id}`, {
          name: name.trim(), url: url.trim(), events, is_active: isActive,
          regenerate_secret: regenSecret,
        });
      } else {
        res = await axios.post('/api/integrations/webhooks', {
          name: name.trim(), url: url.trim(), events,
          generate_secret: genSecret,
        });
      }
      if (res.data.secret) setNewSecret(res.data.secret);
      else onSaved(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save webhook');
    } finally {
      setSaving(false);
    }
  }

  if (newSecret) {
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={styles.modalHeader}>
            <h3 style={{ margin: 0 }}>Webhook Signing Secret</h3>
          </div>
          <div style={{ padding: '1.5rem' }}>
            <div style={{ ...styles.alertSuccess, marginBottom: '1rem' }}>
              ✅ Webhook saved. <strong>Copy the secret now — it won't be shown again.</strong>
            </div>
            <label style={styles.label}>Signing Secret (HMAC-SHA256)</label>
            <div style={styles.keyRevealBox}>
              <code style={{ wordBreak: 'break-all', fontSize: '0.85rem' }}>{newSecret}</code>
            </div>
            <button style={styles.btnPrimary} onClick={() => navigator.clipboard.writeText(newSecret)}>
              📋 Copy
            </button>
            <button style={{ ...styles.btnSecondary, marginLeft: '0.5rem' }} onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.overlay}>
      <div style={{ ...styles.modal, maxWidth: '560px' }}>
        <div style={styles.modalHeader}>
          <h3 style={{ margin: 0 }}>{isEdit ? 'Edit Webhook' : 'New Webhook'}</h3>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>
        <div style={{ padding: '1.5rem', overflowY: 'auto', maxHeight: '75vh' }}>
          {error && <div style={styles.alertError}>{error}</div>}

          <div style={styles.formGroup}>
            <label style={styles.label}>Name *</label>
            <input style={styles.input} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Slack Notifications" />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Endpoint URL *</label>
            <input style={styles.input} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://your-server.com/webhook" />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>
              Events * &nbsp;
              <button
                type="button"
                onClick={toggleAll}
                style={{ fontSize: '0.75rem', color: '#4f46e5', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                {events.length === ALL_EVENTS.length ? 'Deselect all' : 'Select all'}
              </button>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
              {ALL_EVENTS.map(e => (
                <label key={e} style={styles.checkLabel}>
                  <input type="checkbox" checked={events.includes(e)} onChange={() => toggleEvent(e)} />
                  <span style={{ marginLeft: '0.35rem', fontSize: '0.85rem' }}>{EVENT_LABELS[e]}</span>
                </label>
              ))}
            </div>
          </div>

          {!isEdit && (
            <div style={styles.formGroup}>
              <label style={styles.checkLabel}>
                <input type="checkbox" checked={genSecret} onChange={e => setGenSecret(e.target.checked)} />
                <span style={{ marginLeft: '0.35rem' }}>Generate signing secret (HMAC-SHA256)</span>
              </label>
            </div>
          )}

          {isEdit && (
            <>
              <div style={styles.formGroup}>
                <label style={styles.checkLabel}>
                  <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
                  <span style={{ marginLeft: '0.35rem' }}>Active</span>
                </label>
              </div>
              <div style={styles.formGroup}>
                <label style={styles.checkLabel}>
                  <input type="checkbox" checked={regenSecret} onChange={e => setRegenSecret(e.target.checked)} />
                  <span style={{ marginLeft: '0.35rem' }}>Regenerate signing secret</span>
                </label>
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem' }}>
            <button style={styles.btnPrimary} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Webhook'}
            </button>
            <button style={styles.btnSecondary} onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function WebhooksTab() {
  const [webhooks, setWebhooks]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [editing, setEditing]         = useState(null);  // webhook obj or true (new)
  const [testing, setTesting]         = useState(null);
  const [testResult, setTestResult]   = useState({});   // { [id]: { status, error } }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/integrations/webhooks');
      setWebhooks(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load webhooks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleSaved(wh) {
    setWebhooks(prev => {
      const idx = prev.findIndex(w => w.id === wh.id);
      return idx >= 0 ? prev.map(w => w.id === wh.id ? wh : w) : [wh, ...prev];
    });
    setEditing(null);
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this webhook permanently?')) return;
    try {
      await axios.delete(`/api/integrations/webhooks/${id}`);
      setWebhooks(prev => prev.filter(w => w.id !== id));
    } catch (err) {
      setError(err.response?.data?.error || 'Delete failed');
    }
  }

  async function handleTest(id) {
    setTesting(id);
    setTestResult(prev => ({ ...prev, [id]: null }));
    try {
      const { data } = await axios.post(`/api/integrations/webhooks/${id}/test`);
      setTestResult(prev => ({ ...prev, [id]: data }));
    } catch (err) {
      setTestResult(prev => ({
        ...prev,
        [id]: { status: 'failed', error: err.response?.data?.error || 'Request failed' },
      }));
    } finally {
      setTesting(null);
    }
  }

  return (
    <div>
      {editing && (
        <WebhookModal
          webhook={editing === true ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      <div style={styles.sectionHeader}>
        <div>
          <h2 style={styles.sectionTitle}>Webhooks</h2>
          <p style={styles.sectionDesc}>
            Get real-time HTTP notifications when events happen in HireIQ.
          </p>
        </div>
        <button style={styles.btnPrimary} onClick={() => setEditing(true)}>+ New Webhook</button>
      </div>

      {error && <div style={styles.alertError}>{error}</div>}

      {loading ? (
        <div style={styles.loading}>Loading webhooks…</div>
      ) : webhooks.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>🔔</div>
          <p>No webhooks yet. Add one to receive event notifications.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {webhooks.map(wh => (
            <div key={wh.id} style={styles.webhookCard}>
              <div style={styles.webhookCardHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: wh.is_active ? '#22c55e' : '#e5e7eb',
                    display: 'inline-block', flexShrink: 0,
                  }} />
                  <div>
                    <strong>{wh.name}</strong>
                    <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 2 }}>
                      <code style={styles.code}>{wh.url}</code>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  {wh.failure_count > 0 && (
                    <span style={{ ...styles.badge, background: '#fee2e2', color: '#991b1b' }}>
                      {wh.failure_count} failures
                    </span>
                  )}
                  <button
                    style={styles.btnOutline}
                    onClick={() => handleTest(wh.id)}
                    disabled={testing === wh.id}
                  >
                    {testing === wh.id ? 'Sending…' : '▶ Test'}
                  </button>
                  <button style={styles.btnOutline} onClick={() => setEditing(wh)}>Edit</button>
                  <button style={styles.btnDanger} onClick={() => handleDelete(wh.id)}>Delete</button>
                </div>
              </div>

              {testResult[wh.id] && (
                <div style={{
                  padding: '0.5rem 0.75rem',
                  background: testResult[wh.id].status === 'delivered' ? '#f0fdf4' : '#fef2f2',
                  borderTop: '1px solid #e5e7eb',
                  fontSize: '0.82rem',
                  color: testResult[wh.id].status === 'delivered' ? '#166534' : '#991b1b',
                }}>
                  {testResult[wh.id].status === 'delivered'
                    ? `✅ Test delivered (HTTP ${testResult[wh.id].response_code})`
                    : `❌ Test failed: ${testResult[wh.id].error || 'Unknown error'}`}
                </div>
              )}

              <div style={styles.webhookCardFooter}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                  {(Array.isArray(wh.events) ? wh.events : []).map(e => (
                    <span key={e} style={styles.eventTag}>{EVENT_LABELS[e] || e}</span>
                  ))}
                </div>
                <span style={{ fontSize: '0.78rem', color: '#6b7280', whiteSpace: 'nowrap' }}>
                  Last fired: {fmtDateTime(wh.last_fired_at)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════

export default function Integrations() {
  const [tab, setTab] = useState('api-keys');

  const tabs = [
    { key: 'api-keys',  label: '🔑 API Keys' },
    { key: 'webhooks',  label: '🔔 Webhooks' },
  ];

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <h1 style={styles.pageTitle}>Integrations</h1>
        <p style={styles.pageSubtitle}>Manage API access and outbound event notifications.</p>
      </div>

      <div style={styles.tabs}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{ ...styles.tabBtn, ...(tab === t.key ? styles.tabBtnActive : {}) }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={styles.tabContent}>
        {tab === 'api-keys' && <ApiKeysTab />}
        {tab === 'webhooks' && <WebhooksTab />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════════

function scopeBadge(s) {
  const map = {
    read:  { background: '#dbeafe', color: '#1e40af' },
    write: { background: '#fef9c3', color: '#854d0e' },
    admin: { background: '#fce7f3', color: '#9d174d' },
  };
  return map[s] || {};
}

const styles = {
  page:         { padding: '2rem', maxWidth: 900, margin: '0 auto' },
  pageHeader:   { marginBottom: '1.5rem' },
  pageTitle:    { fontSize: '1.75rem', fontWeight: 700, margin: 0, color: '#111' },
  pageSubtitle: { margin: '0.25rem 0 0', color: '#6b7280', fontSize: '0.95rem' },

  tabs:         { display: 'flex', borderBottom: '2px solid #e5e7eb', marginBottom: '1.5rem' },
  tabBtn: {
    padding: '0.6rem 1.25rem', border: 'none', background: 'none',
    cursor: 'pointer', fontSize: '0.95rem', color: '#6b7280',
    borderBottom: '2px solid transparent', marginBottom: '-2px',
  },
  tabBtnActive: { color: '#4f46e5', borderBottomColor: '#4f46e5', fontWeight: 600 },
  tabContent:   { minHeight: 200 },

  sectionHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    marginBottom: '1.25rem',
  },
  sectionTitle: { fontSize: '1.2rem', fontWeight: 600, margin: 0 },
  sectionDesc:  { margin: '0.25rem 0 0', color: '#6b7280', fontSize: '0.9rem' },

  tableWrapper: { overflowX: 'auto', marginBottom: '1rem' },
  table:        { width: '100%', borderCollapse: 'collapse' },
  th: {
    textAlign: 'left', padding: '0.6rem 0.75rem',
    borderBottom: '2px solid #e5e7eb', fontSize: '0.82rem',
    textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280',
  },
  tr:           { borderBottom: '1px solid #f3f4f6' },
  td:           { padding: '0.65rem 0.75rem', fontSize: '0.9rem', verticalAlign: 'middle' },

  badge: {
    display: 'inline-block', padding: '0.15rem 0.5rem',
    borderRadius: 4, fontSize: '0.75rem', fontWeight: 600, marginRight: 3,
  },
  code:         { background: '#f3f4f6', padding: '0.15rem 0.4rem', borderRadius: 3, fontSize: '0.82rem' },

  webhookCard: {
    border: '1px solid #e5e7eb', borderRadius: 8,
    background: '#fff', overflow: 'hidden',
  },
  webhookCardHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '0.85rem 1rem',
  },
  webhookCardFooter: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '0.6rem 1rem', borderTop: '1px solid #f3f4f6',
    background: '#fafafa',
  },
  eventTag: {
    background: '#f0f4ff', color: '#3730a3',
    padding: '0.1rem 0.45rem', borderRadius: 4, fontSize: '0.75rem',
  },

  emptyState: { textAlign: 'center', padding: '3rem 1rem', color: '#6b7280' },
  emptyIcon:  { fontSize: '2.5rem', marginBottom: '0.5rem' },
  loading:    { padding: '2rem', textAlign: 'center', color: '#6b7280' },

  infoBox: {
    marginTop: '1.5rem', padding: '1rem 1.25rem',
    background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8,
    fontSize: '0.88rem', color: '#1e40af',
  },

  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#fff', borderRadius: 10, width: '90%', maxWidth: 480,
    boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
  },
  modalHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '1rem 1.25rem', borderBottom: '1px solid #e5e7eb',
  },
  closeBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: '1.1rem', color: '#6b7280',
  },

  formGroup:    { marginBottom: '1rem' },
  label:        { display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem', color: '#374151' },
  input: {
    width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db',
    borderRadius: 6, fontSize: '0.9rem', boxSizing: 'border-box',
  },
  checkLabel:   { display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '0.9rem' },

  keyRevealBox: {
    background: '#f9fafb', border: '1px solid #d1d5db',
    borderRadius: 6, padding: '0.75rem', marginBottom: '0.75rem',
  },

  btnPrimary: {
    padding: '0.5rem 1rem', background: '#4f46e5', color: '#fff',
    border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600,
  },
  btnSecondary: {
    padding: '0.5rem 1rem', background: '#fff', color: '#374151',
    border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: '0.9rem',
  },
  btnOutline: {
    padding: '0.3rem 0.7rem', background: '#fff', color: '#4f46e5',
    border: '1px solid #c7d2fe', borderRadius: 5, cursor: 'pointer', fontSize: '0.82rem',
  },
  btnDanger: {
    padding: '0.3rem 0.7rem', background: '#fee2e2', color: '#991b1b',
    border: '1px solid #fca5a5', borderRadius: 5, cursor: 'pointer', fontSize: '0.82rem',
  },

  alertError: {
    background: '#fef2f2', border: '1px solid #fca5a5',
    color: '#991b1b', padding: '0.6rem 0.9rem', borderRadius: 6,
    marginBottom: '1rem', fontSize: '0.9rem',
  },
  alertSuccess: {
    background: '#f0fdf4', border: '1px solid #86efac',
    color: '#166534', padding: '0.6rem 0.9rem', borderRadius: 6, fontSize: '0.9rem',
  },
};
