import React, { useState, useEffect, useRef } from 'react';
import api from '../../api';

// ── Shared helpers ────────────────────────────────────────────────────────────

function Banner({ type, message, onClose }) {
  if (!message) return null;
  const styles = {
    success: 'bg-green-50 border-green-200 text-green-700',
    error:   'bg-red-50   border-red-200   text-red-700',
  };
  return (
    <div className={`mb-4 p-3 border rounded-lg text-sm flex items-center justify-between ${styles[type]}`}>
      <span>{message}</span>
      {onClose && <button onClick={onClose} className="ml-3 opacity-60 hover:opacity-100">✕</button>}
    </div>
  );
}

// ── Tab: General ──────────────────────────────────────────────────────────────

function GeneralTab() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');
  const [form, setForm] = useState({ company_name:'', contact_email:'', contact_phone:'', company_logo:'' });
  const fileRef = useRef(null);

  const load = () => {
    setLoading(true);
    api.get('/api/settings')
      .then(r => { setSettings(r.data); setForm({ company_name: r.data.company_name||'', contact_email: r.data.contact_email||'', contact_phone: r.data.contact_phone||'', company_logo: r.data.company_logo||'' }); })
      .catch(() => setError('Failed to load settings.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 512 * 1024) { setError('Logo must be under 512 KB.'); return; }
    const reader = new FileReader();
    reader.onload = ev => setForm(f => ({ ...f, company_logo: ev.target.result }));
    reader.readAsDataURL(file);
  };

  const removeLogo = async () => {
    try { await api.delete('/api/settings/logo'); setForm(f => ({ ...f, company_logo:'' })); setSuccess('Logo removed.'); setTimeout(()=>setSuccess(''),3000); }
    catch { setError('Failed to remove logo.'); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); setError(''); setSuccess(''); setSaving(true);
    try { await api.put('/api/settings', form); setSuccess('Settings saved.'); setTimeout(()=>setSuccess(''),4000); load(); }
    catch (err) { setError(err.response?.data?.error||'Failed to save.'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-40"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"/></div>;

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      <Banner type="error"   message={error}   onClose={()=>setError('')} />
      <Banner type="success" message={success} />

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">Company Logo</h2>
        <div className="flex items-center gap-6">
          <div className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center bg-gray-50 overflow-hidden shrink-0">
            {form.company_logo ? <img src={form.company_logo} alt="Logo" className="w-full h-full object-contain"/> : <span className="text-3xl text-gray-400">🏢</span>}
          </div>
          <div className="flex flex-col gap-2">
            <input type="file" accept="image/*" className="hidden" ref={fileRef} onChange={handleLogoUpload}/>
            <button type="button" onClick={()=>fileRef.current.click()} className="btn-secondary text-sm py-2">{form.company_logo?'Change Logo':'Upload Logo'}</button>
            {form.company_logo && <button type="button" onClick={removeLogo} className="text-xs text-red-500 hover:text-red-700 underline">Remove logo</button>}
            <p className="text-xs text-gray-400">PNG, JPG, SVG · Max 512 KB</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">Company Details</h2>
        <div className="space-y-4">
          <div>
            <label className="label">Organisation Name <span className="text-red-500">*</span></label>
            <input type="text" className="input" value={form.company_name} onChange={e=>setForm(f=>({...f,company_name:e.target.value}))} required placeholder="Acme Corp"/>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Contact Email</label><input type="email" className="input" value={form.contact_email} onChange={e=>setForm(f=>({...f,contact_email:e.target.value}))} placeholder="billing@company.com"/></div>
            <div><label className="label">Contact Phone</label><input type="tel" className="input" value={form.contact_phone} onChange={e=>setForm(f=>({...f,contact_phone:e.target.value}))} placeholder="+1 555 000 0000"/></div>
          </div>
        </div>
      </div>

      {settings && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Account Info</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {[
              ['Organisation Code', <span className="font-mono font-medium">{settings.slug}</span>],
              ['Plan',              <span className="font-medium capitalize">{settings.plan}</span>],
              ['Status',            <span className={`font-medium capitalize ${settings.status==='active'?'text-green-600':settings.status==='suspended'?'text-red-600':'text-yellow-600'}`}>{settings.status}</span>],
              ['Member Since',      new Date(settings.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})],
              ['Max Employees',     settings.max_candidates],
              ['Max Clients',       settings.max_clients],
            ].map(([label,val],i)=>(
              <div key={i} className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">{label}</p>
                <p className="text-gray-800">{val}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={saving} className="btn-primary px-6 py-2.5">{saving?'Saving…':'Save Settings'}</button>
      </div>
    </form>
  );
}

// ── Provider / model data (mirrors backend PROVIDER_MODELS) ──────────────────

const PROVIDERS = {
  anthropic: {
    label: 'Anthropic (Claude)',
    icon:  '🧠',
    hint:  'Get your key at console.anthropic.com',
    url:   'https://console.anthropic.com',
    models: [
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5  — fast & efficient',   tier: 'fast'     },
      { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6 — balanced',            tier: 'balanced' },
      { id: 'claude-opus-4-6',           label: 'Claude Opus 4.6   — most capable',        tier: 'powerful' },
    ],
  },
  openai: {
    label: 'OpenAI (GPT)',
    icon:  '🤖',
    hint:  'Get your key at platform.openai.com',
    url:   'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini — fast & cheap',   tier: 'fast'     },
      { id: 'gpt-4o',      label: 'GPT-4o      — balanced',        tier: 'balanced' },
      { id: 'o1-mini',     label: 'o1 Mini     — reasoning',       tier: 'powerful' },
    ],
  },
};

const TIER_BADGE = {
  fast:     'bg-green-100 text-green-700',
  balanced: 'bg-blue-100 text-blue-700',
  powerful: 'bg-purple-100 text-purple-700',
};

// ── Tab: AI Assistant ─────────────────────────────────────────────────────────

function AITab() {
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [testing, setTesting]     = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState('');
  const [testResult, setTestResult] = useState(null);

  const [provider, setProvider]   = useState('anthropic');
  const [model, setModel]         = useState('claude-haiku-4-5-20251001');
  const [apiKey, setApiKey]       = useState('');
  const [showKey, setShowKey]     = useState(false);
  const [promptSuffix, setPromptSuffix] = useState('');
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [platformInfo, setPlatformInfo] = useState({ has_key: false, provider: null, model: null });

  useEffect(() => {
    api.get('/api/ai-chat/settings')
      .then(r => {
        setProvider(r.data.provider);
        setModel(r.data.model);
        setPromptSuffix(r.data.system_prompt_suffix || '');
        setHasExistingKey(r.data.has_api_key);
        setPlatformInfo({ has_key: r.data.platform_has_key, provider: r.data.platform_provider, model: r.data.platform_model, allow: r.data.allow_tenant_keys });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // When provider changes, select the first model for that provider
  const handleProviderChange = (p) => {
    setProvider(p);
    setModel(PROVIDERS[p].models[0].id);
    setTestResult(null);
  };

  const handleSave = async () => {
    setSaving(true); setError(''); setSuccess('');
    try {
      const body = { provider, model, system_prompt_suffix: promptSuffix };
      if (apiKey)           body.api_key      = apiKey;
      await api.put('/api/ai-chat/settings', body);
      setSuccess('AI settings saved successfully.');
      setHasExistingKey(prev => prev || !!apiKey);
      setApiKey('');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save AI settings.');
    } finally { setSaving(false); }
  };

  const handleClearKey = async () => {
    if (!window.confirm('Remove the saved API key? The AI will fall back to the platform key if available.')) return;
    try {
      await api.put('/api/ai-chat/settings', { clear_api_key: true });
      setHasExistingKey(false);
      setSuccess('API key removed.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) { setError(err.response?.data?.error || 'Failed to remove key.'); }
  };

  const testConnection = async () => {
    if (!hasExistingKey && !apiKey) { setError('Enter an API key first.'); return; }
    setTesting(true); setTestResult(null); setError('');
    try {
      // Save first, then ping the chat endpoint with a simple test message
      if (apiKey) await api.put('/api/ai-chat/settings', { provider, model, api_key: apiKey });
      const r = await api.post('/api/ai-chat/message', { message: 'Reply with just "OK" — this is a connectivity test.' });
      setTestResult({ ok: true, text: r.data.message?.slice(0, 100), model: r.data.model });
      if (apiKey) { setHasExistingKey(true); setApiKey(''); }
    } catch (err) {
      setTestResult({ ok: false, text: err.response?.data?.error || err.message });
    } finally { setTesting(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-40"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"/></div>;

  const currentProviderMeta = PROVIDERS[provider];
  const models = currentProviderMeta?.models || [];

  return (
    <div className="space-y-6 max-w-2xl">
      <Banner type="error"   message={error}   onClose={()=>setError('')} />
      <Banner type="success" message={success} />

      {/* Platform fallback info */}
      {platformInfo.has_key && (
        <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800">
          <span className="text-lg shrink-0">ℹ️</span>
          <div>
            <strong>Platform key available</strong> — your platform administrator has configured a default AI key
            ({platformInfo.provider}/{platformInfo.model}). Your settings below override it.
            {!platformInfo.allow && <span className="ml-1 text-amber-700">(Tenant custom keys are currently disabled by the platform admin.)</span>}
          </div>
        </div>
      )}

      {/* Provider selection */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-1">AI Provider</h2>
        <p className="text-xs text-gray-500 mb-4">Choose which AI service powers your assistant.</p>
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(PROVIDERS).map(([key, meta]) => (
            <button
              key={key}
              type="button"
              onClick={() => handleProviderChange(key)}
              className={`flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-all ${provider === key ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
            >
              <span className="text-2xl">{meta.icon}</span>
              <div>
                <p className="font-medium text-sm text-gray-900">{meta.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{meta.hint}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Model selection */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-1">Model</h2>
        <p className="text-xs text-gray-500 mb-4">Select the model that best fits your speed and capability needs.</p>
        <div className="space-y-2">
          {models.map(m => (
            <label key={m.id}
              className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${model === m.id ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
            >
              <input type="radio" name="model" value={m.id} checked={model===m.id} onChange={()=>setModel(m.id)} className="accent-blue-600"/>
              <div className="flex-1">
                <span className="font-medium text-sm text-gray-900 font-mono">{m.id}</span>
                <span className="text-xs text-gray-500 ml-2">{m.label.split(' — ')[1]}</span>
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${TIER_BADGE[m.tier]}`}>{m.tier}</span>
            </label>
          ))}
        </div>
      </div>

      {/* API Key */}
      {platformInfo.allow !== false && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-1">API Key</h2>
          <p className="text-xs text-gray-500 mb-4">
            Enter your own key to use your account's quota and billing.{' '}
            <a href={currentProviderMeta?.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Get a key ↗</a>
          </p>

          {hasExistingKey && !apiKey && (
            <div className="flex items-center gap-3 mb-3 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-700">
              <span>✅ API key saved</span>
              <button onClick={handleClearKey} className="ml-auto text-xs text-red-500 hover:underline">Remove</button>
            </div>
          )}

          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={hasExistingKey ? 'Enter new key to replace existing…' : `${provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}`}
              className="input pr-20"
              autoComplete="new-password"
            />
            <button type="button" onClick={()=>setShowKey(s=>!s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600">
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">Your key is stored in your tenant database and never shared externally.</p>
        </div>
      )}

      {/* System prompt suffix */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-1">Custom Instructions <span className="text-gray-400 font-normal text-sm">(optional)</span></h2>
        <p className="text-xs text-gray-500 mb-3">Add custom instructions appended to the AI's system prompt — e.g. company tone, specific rules, or domain context.</p>
        <textarea
          value={promptSuffix}
          onChange={e => setPromptSuffix(e.target.value)}
          rows={4}
          placeholder="e.g. Always respond in British English. Refer to employees as 'team members'. When creating invoices always add GST at 10%."
          className="input font-mono text-xs"
        />
      </div>

      {/* Test connection result */}
      {testResult && (
        <div className={`rounded-xl border p-4 text-sm ${testResult.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
          {testResult.ok
            ? <><strong>✅ Connection successful</strong> <span className="text-xs opacity-70 ml-1">{testResult.model}</span><p className="mt-1 font-mono text-xs">{testResult.text}</p></>
            : <><strong>❌ Connection failed</strong><p className="mt-1">{testResult.text}</p></>
          }
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button onClick={handleSave} disabled={saving} className="btn-primary px-6 py-2.5">
          {saving ? 'Saving…' : '💾 Save AI Settings'}
        </button>
        <button onClick={testConnection} disabled={testing || saving} className="btn-secondary px-4 py-2.5 flex items-center gap-2">
          {testing ? <><span className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"/>Testing…</> : '🔌 Test Connection'}
        </button>
      </div>
    </div>
  );
}

// ── Root Settings page with tabs ──────────────────────────────────────────────

const TABS = [
  { key: 'general', label: '⚙️ General',      component: GeneralTab },
  { key: 'ai',      label: '🤖 AI Assistant', component: AITab      },
];

export default function Settings() {
  const [tab, setTab] = useState('general');
  const ActiveTab = TABS.find(t => t.key === tab)?.component || GeneralTab;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">Manage your organisation and AI configuration</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors -mb-px ${
              tab === t.key
                ? 'text-blue-600 border-b-2 border-blue-600 bg-white'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ActiveTab />
    </div>
  );
}
