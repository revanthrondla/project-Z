import React, { useState, useEffect, useRef, useCallback } from 'react';
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

  const load = useCallback(() => {
    setLoading(true);
    api.get('/api/settings')
      .then(r => { setSettings(r.data); setForm({ company_name: r.data.company_name||'', contact_email: r.data.contact_email||'', contact_phone: r.data.contact_phone||'', company_logo: r.data.company_logo||'' }); })
      .catch(() => setError('Failed to load settings.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

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

  if (loading) return <div className="flex items-center justify-center h-40"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"/></div>;

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
  balanced: 'bg-blue-100 text-emerald-700',
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

  if (loading) return <div className="flex items-center justify-center h-40"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"/></div>;

  const currentProviderMeta = PROVIDERS[provider];
  const models = currentProviderMeta?.models || [];

  return (
    <div className="space-y-6 max-w-2xl">
      <Banner type="error"   message={error}   onClose={()=>setError('')} />
      <Banner type="success" message={success} />

      {/* Platform fallback info */}
      {platformInfo.has_key && (
        <div className="flex items-start gap-3 bg-emerald-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800">
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
              className={`flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-all ${provider === key ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'}`}
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
              className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${model === m.id ? 'border-blue-400 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'}`}
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
            <a href={currentProviderMeta?.url} target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline">Get a key ↗</a>
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

// ── Tab: Security ─────────────────────────────────────────────────────────────

function SecurityTab() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // MFA setup state
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaStep, setMfaStep] = useState(null); // null | 'qr' | 'verify' | 'backup'
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [backupCodes, setBackupCodes] = useState([]);
  const [mfaLoading, setMfaLoading] = useState(false);
  const [disableMfaCode, setDisableMfaCode] = useState('');
  const [showDisableModal, setShowDisableModal] = useState(false);

  // Organization settings
  const [orgConfig, setOrgConfig] = useState(null);
  const [mfaPolicy, setMfaPolicy] = useState('off');
  const [mfaMethods, setMfaMethods] = useState(['totp']);
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [ssoDomain, setSsoDomain] = useState('');
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [orgLoading, setOrgLoading] = useState(true);
  const [orgSaving, setOrgSaving] = useState(false);

  // Load personal MFA status
  useEffect(() => {
    api.get('/api/auth/mfa/status')
      .then(r => {
        setMfaEnabled(r.data.enabled);
      })
      .catch(() => setError('Failed to load MFA status.'))
      .finally(() => setLoading(false));
  }, []);

  // Load organization config
  useEffect(() => {
    api.get('/api/auth/sso/admin-config')
      .then(r => {
        setOrgConfig(r.data);
        setMfaPolicy(r.data.mfaPolicy || 'off');
        setMfaMethods(r.data.mfaMethods || ['totp']);
        setSsoEnabled(r.data.ssoEnabled);
        setSsoDomain(r.data.ssoDomain || '');
        setGoogleConfigured(r.data.googleConfigured);
      })
      .catch(() => setError('Failed to load organization config.'))
      .finally(() => setOrgLoading(false));
  }, []);

  // Start MFA setup
  const startMfaSetup = async () => {
    setMfaLoading(true);
    setError('');
    try {
      const res = await api.post('/api/auth/mfa/setup');
      setQrCode(res.data.qrCode);
      setSecret(res.data.secret);
      setMfaStep('qr');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to start MFA setup.');
    } finally {
      setMfaLoading(false);
    }
  };

  // Confirm MFA
  const confirmMfa = async () => {
    setMfaLoading(true);
    setError('');
    try {
      const res = await api.post('/api/auth/mfa/confirm', {
        code: verifyCode.replace(/\s/g, ''),
      });
      setBackupCodes(res.data.backupCodes);
      setMfaStep('backup');
      setMfaEnabled(true);
      setVerifyCode('');
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid code. Please try again.');
    } finally {
      setMfaLoading(false);
    }
  };

  // Finish MFA setup
  const finishMfaSetup = () => {
    setSuccess('MFA enabled successfully!');
    setTimeout(() => setSuccess(''), 4000);
    setMfaStep(null);
    setQrCode('');
    setSecret('');
    setVerifyCode('');
    setBackupCodes([]);
  };

  // Disable MFA
  const disableMfa = async () => {
    setMfaLoading(true);
    setError('');
    try {
      await api.delete('/api/auth/mfa/disable', {
        data: { code: disableMfaCode.replace(/\s/g, '') },
      });
      setMfaEnabled(false);
      setShowDisableModal(false);
      setDisableMfaCode('');
      setSuccess('MFA disabled successfully.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to disable MFA.');
    } finally {
      setMfaLoading(false);
    }
  };

  // Update organization config
  const saveOrgConfig = async () => {
    if (mfaMethods.length === 0) {
      setError('At least one MFA method must be selected.');
      return;
    }
    setOrgSaving(true);
    setError('');
    try {
      await api.put('/api/auth/sso/admin-config', {
        mfaPolicy,
        mfaMethods,
        ssoEnabled,
        ssoDomain: ssoDomain || null,
      });
      setSuccess('Security settings saved.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save settings.');
    } finally {
      setOrgSaving(false);
    }
  };

  const toggleMfaMethod = (method) => {
    setMfaMethods(prev =>
      prev.includes(method) ? prev.filter(m => m !== method) : [...prev, method]
    );
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setSuccess('Copied to clipboard!');
    setTimeout(() => setSuccess(''), 2000);
  };

  if (loading || orgLoading) {
    return <div className="flex items-center justify-center h-40"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"/></div>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <Banner type="error" message={error} onClose={() => setError('')} />
      <Banner type="success" message={success} />

      {/* Personal MFA Section */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">Personal MFA</h2>

        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm text-gray-600">Two-Factor Authentication Status</p>
            <div className="mt-2">
              {mfaEnabled ? (
                <span className="inline-block px-3 py-1 bg-green-100 text-green-800 text-xs font-semibold rounded-full">
                  ✅ Enabled
                </span>
              ) : (
                <span className="inline-block px-3 py-1 bg-gray-100 text-gray-800 text-xs font-semibold rounded-full">
                  ⭕ Disabled
                </span>
              )}
            </div>
          </div>
        </div>

        {!mfaStep ? (
          <div className="flex gap-3">
            {mfaEnabled ? (
              <button
                onClick={() => setShowDisableModal(true)}
                className="btn-secondary text-sm py-2"
              >
                Disable MFA
              </button>
            ) : (
              <button
                onClick={startMfaSetup}
                disabled={mfaLoading}
                className="btn-primary text-sm py-2"
              >
                {mfaLoading ? 'Setting up…' : 'Enable MFA'}
              </button>
            )}
          </div>
        ) : mfaStep === 'qr' ? (
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-lg flex flex-col items-center gap-4">
              <img src={qrCode} alt="MFA QR Code" className="w-48 h-48" />
              <div className="w-full">
                <p className="text-xs text-gray-600 mb-2">Manual Entry Code:</p>
                <div className="flex items-center gap-2 bg-white p-3 rounded border border-gray-200">
                  <code className="flex-1 font-mono text-sm text-gray-800 break-all">{secret}</code>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(secret)}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>
            <button
              onClick={() => setMfaStep('verify')}
              className="btn-primary w-full text-sm py-2"
            >
              I've scanned it
            </button>
          </div>
        ) : mfaStep === 'verify' ? (
          <div className="space-y-4">
            <div>
              <label className="label">Enter 6-digit verification code</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength="6"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="text-center text-2xl font-mono tracking-widest border-2 border-gray-300 rounded-xl w-full py-3 focus:border-emerald-500 focus:outline-none"
                autoFocus
              />
            </div>
            <button
              onClick={confirmMfa}
              disabled={mfaLoading || verifyCode.length !== 6}
              className="btn-primary w-full text-sm py-2"
            >
              {mfaLoading ? 'Verifying…' : 'Verify Code'}
            </button>
          </div>
        ) : mfaStep === 'backup' ? (
          <div className="space-y-4">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-yellow-900 mb-3">
                Save your backup codes
              </p>
              <p className="text-xs text-yellow-800 mb-3">
                Keep these codes in a safe place. You can use them if you lose access to your authenticator app.
              </p>
              <div className="grid grid-cols-2 gap-2 bg-white p-3 rounded border border-yellow-200">
                {backupCodes.map((code, i) => (
                  <code key={i} className="font-mono text-sm text-gray-700 break-all">{code}</code>
                ))}
              </div>
            </div>
            <button
              onClick={() => copyToClipboard(backupCodes.join('\n'))}
              className="btn-secondary text-sm py-2 w-full mb-3"
            >
              Copy All Codes
            </button>
            <button
              onClick={finishMfaSetup}
              className="btn-primary w-full text-sm py-2"
            >
              Done
            </button>
          </div>
        ) : null}
      </div>

      {/* Disable MFA Modal */}
      {showDisableModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Disable MFA?</h3>
            <p className="text-sm text-gray-600 mb-4">
              Enter your 6-digit code to disable two-factor authentication.
            </p>
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength="6"
              value={disableMfaCode}
              onChange={(e) => setDisableMfaCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className="text-center text-2xl font-mono tracking-widest border-2 border-gray-300 rounded-xl w-full py-3 mb-4 focus:border-emerald-500 focus:outline-none"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowDisableModal(false);
                  setDisableMfaCode('');
                }}
                className="flex-1 btn-secondary text-sm py-2"
              >
                Cancel
              </button>
              <button
                onClick={disableMfa}
                disabled={mfaLoading || disableMfaCode.length !== 6}
                className="flex-1 btn-primary text-sm py-2 bg-red-600 hover:bg-red-700"
              >
                {mfaLoading ? 'Disabling…' : 'Disable'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Organization Security Section */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-1">Organisation Security</h2>
        <p className="text-xs text-gray-500 mb-5">Configure authentication policy for all members of your organisation.</p>

        {!googleConfigured && (
          <div className="mb-5 flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
            <span className="text-sm shrink-0">ℹ️</span>
            <div>
              Google SSO requires <code className="bg-blue-100 px-1 rounded">GOOGLE_CLIENT_ID</code> to be configured on the server.
            </div>
          </div>
        )}

        <div className="space-y-5">

          {/* ── MFA Policy ── */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1.5">MFA Policy</label>
            <select
              value={mfaPolicy}
              onChange={(e) => setMfaPolicy(e.target.value)}
              className="input"
            >
              <option value="off">Off — MFA is optional for all users</option>
              <option value="optional">Optional — users can enable MFA themselves</option>
              <option value="required">Required — all users must use MFA</option>
              <option value="admin_required">Admins only — only admin accounts require MFA</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              {mfaPolicy === 'off' && 'MFA is not enforced. Users may still enable it personally.'}
              {mfaPolicy === 'optional' && 'Users are encouraged but not required to use MFA.'}
              {mfaPolicy === 'required' && 'All users must authenticate with MFA on every sign-in.'}
              {mfaPolicy === 'admin_required' && 'Only users with the Admin role are required to use MFA.'}
            </p>
          </div>

          {/* ── MFA Methods ── */}
          {mfaPolicy !== 'off' && (
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-2">Allowed MFA Methods</label>
              <div className="space-y-2">
                <label className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 text-emerald-600 rounded border-gray-300 cursor-pointer"
                    checked={mfaMethods.includes('totp')}
                    onChange={() => toggleMfaMethod('totp')}
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900">Authenticator App (TOTP)</p>
                    <p className="text-xs text-gray-500 mt-0.5">Google Authenticator, Authy, 1Password, etc. Works offline.</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 text-emerald-600 rounded border-gray-300 cursor-pointer"
                    checked={mfaMethods.includes('email_otp')}
                    onChange={() => toggleMfaMethod('email_otp')}
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900">Email OTP</p>
                    <p className="text-xs text-gray-500 mt-0.5">A one-time code sent to the user's email. No app required — good for low-friction enforcement.</p>
                  </div>
                </label>
              </div>
              {mfaMethods.length === 0 && (
                <p className="text-xs text-red-500 mt-1">At least one method must be selected.</p>
              )}
            </div>
          )}

          {/* ── SSO Toggle ── */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-gray-900">Enable Google SSO</p>
              <p className="text-xs text-gray-500 mt-0.5">Allow users to sign in with Google</p>
            </div>
            <button
              type="button"
              onClick={() => setSsoEnabled(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                ssoEnabled ? 'bg-emerald-600' : 'bg-gray-300'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                ssoEnabled ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>

          {/* ── Allowed Email Domain ── */}
          {ssoEnabled && (
            <div>
              <label className="label">Allowed email domain (optional)</label>
              <input
                type="text"
                value={ssoDomain}
                onChange={(e) => setSsoDomain(e.target.value)}
                placeholder="e.g. acme.com"
                className="input"
              />
              <p className="text-xs text-gray-500 mt-1">Restrict SSO logins to a specific email domain. Leave blank to allow any domain.</p>
            </div>
          )}

          {/* ── SSO Login URL ── */}
          <div>
            <label className="label text-gray-600">Login URL to share with your team</label>
            <div className="flex items-center gap-2 bg-gray-50 p-3 rounded-lg border border-gray-200">
              <code className="flex-1 font-mono text-sm text-gray-700 break-all">
                {typeof window !== 'undefined' ? `${window.location.origin}/login` : 'https://app.example.com/login'}
              </code>
              <button
                type="button"
                onClick={() => copyToClipboard(`${window.location.origin}/login`)}
                className="text-xs text-gray-500 hover:text-gray-700 shrink-0"
              >
                Copy
              </button>
            </div>
          </div>

          {/* ── Save button ── */}
          <div className="pt-1 border-t border-gray-100">
            <button
              type="button"
              onClick={saveOrgConfig}
              disabled={orgSaving || mfaMethods.length === 0}
              className="btn-primary py-2.5 px-6 text-sm"
            >
              {orgSaving ? 'Saving…' : 'Save Security Settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Tab: Organisation Setup ───────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

// Reference data for dropdowns
const TIMEZONES = [
  'UTC','America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
  'America/Phoenix','America/Anchorage','Pacific/Honolulu',
  'Europe/London','Europe/Paris','Europe/Berlin','Europe/Rome','Europe/Madrid',
  'Europe/Amsterdam','Europe/Stockholm','Europe/Zurich','Europe/Warsaw',
  'Asia/Dubai','Asia/Kolkata','Asia/Dhaka','Asia/Bangkok','Asia/Singapore',
  'Asia/Hong_Kong','Asia/Shanghai','Asia/Tokyo','Asia/Seoul',
  'Australia/Sydney','Australia/Melbourne','Australia/Brisbane','Australia/Perth',
  'Pacific/Auckland','America/Toronto','America/Vancouver','America/Mexico_City',
  'America/Sao_Paulo','America/Buenos_Aires','Africa/Johannesburg','Africa/Lagos',
  'Africa/Nairobi',
];

const CURRENCIES = [
  { code:'USD', symbol:'$',  name:'US Dollar' },
  { code:'GBP', symbol:'£',  name:'British Pound' },
  { code:'EUR', symbol:'€',  name:'Euro' },
  { code:'CAD', symbol:'$',  name:'Canadian Dollar' },
  { code:'AUD', symbol:'$',  name:'Australian Dollar' },
  { code:'NZD', symbol:'$',  name:'New Zealand Dollar' },
  { code:'SGD', symbol:'$',  name:'Singapore Dollar' },
  { code:'HKD', symbol:'$',  name:'Hong Kong Dollar' },
  { code:'JPY', symbol:'¥',  name:'Japanese Yen' },
  { code:'CNY', symbol:'¥',  name:'Chinese Yuan' },
  { code:'INR', symbol:'₹',  name:'Indian Rupee' },
  { code:'AED', symbol:'د.إ',name:'UAE Dirham' },
  { code:'SAR', symbol:'﷼',  name:'Saudi Riyal' },
  { code:'ZAR', symbol:'R',  name:'South African Rand' },
  { code:'BRL', symbol:'R$', name:'Brazilian Real' },
  { code:'MXN', symbol:'$',  name:'Mexican Peso' },
  { code:'CHF', symbol:'₣',  name:'Swiss Franc' },
  { code:'SEK', symbol:'kr', name:'Swedish Krona' },
  { code:'NOK', symbol:'kr', name:'Norwegian Krone' },
  { code:'DKK', symbol:'kr', name:'Danish Krone' },
  { code:'PLN', symbol:'zł', name:'Polish Zloty' },
];

const COUNTRIES = [
  'US','GB','AU','CA','NZ','SG','HK','IE','ZA','IN','AE','SA',
  'DE','FR','IT','ES','NL','SE','NO','DK','FI','CH','PL','AT',
  'BR','MX','AR','JP','CN','KR','TH','MY','PH','ID','VN',
];

const ORG_SECTIONS = [
  { key:'profile',      icon:'🏢', label:'Company Profile' },
  { key:'legal',        icon:'⚖️', label:'Legal & Tax' },
  { key:'locations',    icon:'📍', label:'Locations' },
  { key:'departments',  icon:'🗂️', label:'Departments' },
  { key:'workweek',     icon:'🗓️', label:'Workweek & Time' },
  { key:'invoicing',    icon:'🧾', label:'Invoicing' },
  { key:'payretention', icon:'💰', label:'Pay & Retention' },
  { key:'empnumbers',   icon:'🔢', label:'Employee Numbers' },
];

// ── Shared save hook for the profile singleton ─────────────────────────────
function useOrgProfile() {
  const [profile, setProfile]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');

  useEffect(() => {
    api.get('/api/org-setup/profile')
      .then(r => setProfile(r.data || {}))
      .catch(() => setError('Failed to load organisation profile'))
      .finally(() => setLoading(false));
  }, []);

  const save = async (patch) => {
    setError(''); setSuccess(''); setSaving(true);
    try {
      const r = await api.put('/api/org-setup/profile', { ...(profile || {}), ...patch });
      setProfile(r.data);
      setSuccess('Saved');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return { profile, setProfile, loading, saving, save, error, setError, success };
}

// ── Section: Company Profile ───────────────────────────────────────────────
function CompanyProfileSection() {
  const { profile, loading, saving, save, error, setError, success } = useOrgProfile();
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (profile) setForm({
      trading_name: profile.trading_name || '',
      description:  profile.description  || '',
      industry:     profile.industry     || '',
      website:      profile.website      || '',
    });
  }, [profile]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  if (loading || !form) return <Spinner />;

  return (
    <form onSubmit={e => { e.preventDefault(); save(form); }} className="space-y-5 max-w-2xl">
      <Banner type="error"   message={error}   onClose={() => setError('')} />
      <Banner type="success" message={success} />

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h3 className="font-semibold text-gray-800">Company Profile</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">Trading / Brand Name</label>
            <input className="input" value={form.trading_name} onChange={e => set('trading_name', e.target.value)} placeholder="The name customers see" />
          </div>
          <div>
            <label className="label">Industry</label>
            <input className="input" value={form.industry} onChange={e => set('industry', e.target.value)} placeholder="e.g. Staffing, Technology" />
          </div>
          <div>
            <label className="label">Website</label>
            <input type="url" className="input" value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://www.example.com" />
          </div>
          <div className="col-span-2">
            <label className="label">Company Description</label>
            <textarea rows={3} className="input" value={form.description} onChange={e => set('description', e.target.value)} placeholder="Brief description of what your company does" />
          </div>
        </div>
      </div>
      <div className="flex justify-end"><button type="submit" disabled={saving} className="btn-primary px-6 py-2">{saving ? 'Saving…' : 'Save'}</button></div>
    </form>
  );
}

// ── Section: Legal & Tax ──────────────────────────────────────────────────
function LegalEntityModal({ entity, onSave, onClose }) {
  const isEdit = !!entity?.id;
  const blank  = { legal_name:'', trading_name:'', tax_id_label:'Tax ID', tax_id:'',
                   vat_number:'', registration_number:'', jurisdiction:'', is_primary:false, notes:'',
                   address_line1:'', address_line2:'', city:'', state:'', postcode:'', country:'US' };
  const [form, setForm]   = useState(entity ? { ...blank, ...entity } : blank);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault(); setError(''); setSaving(true);
    try {
      if (isEdit) await api.put(`/api/org-setup/legal-entities/${entity.id}`, form);
      else        await api.post('/api/org-setup/legal-entities', form);
      onSave();
    } catch (err) { setError(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900">{isEdit ? 'Edit Legal Entity' : 'Add Legal Entity'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {error && <Banner type="error" message={error} onClose={() => setError('')} />}

          <div>
            <label className="label">Legal Name <span className="text-red-500">*</span> <span className="text-xs text-gray-400">(as registered)</span></label>
            <input className="input" value={form.legal_name} onChange={e => set('legal_name', e.target.value)} placeholder="Full registered legal name" required />
          </div>
          <div>
            <label className="label">Trading / DBA Name</label>
            <input className="input" value={form.trading_name} onChange={e => set('trading_name', e.target.value)} placeholder="The name customers see" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Tax ID Label</label>
              <input className="input" value={form.tax_id_label} onChange={e => set('tax_id_label', e.target.value)} placeholder="e.g. EIN, ABN, VAT, TRN" />
            </div>
            <div>
              <label className="label">Tax ID / Number</label>
              <input className="input" value={form.tax_id} onChange={e => set('tax_id', e.target.value)} placeholder="e.g. 12-3456789" />
            </div>
            <div>
              <label className="label">VAT Number</label>
              <input className="input" value={form.vat_number} onChange={e => set('vat_number', e.target.value)} placeholder="e.g. GB123456789" />
            </div>
            <div>
              <label className="label">Company Registration No.</label>
              <input className="input" value={form.registration_number} onChange={e => set('registration_number', e.target.value)} placeholder="e.g. 01234567" />
            </div>
          </div>

          <div>
            <label className="label">Jurisdiction</label>
            <input className="input" value={form.jurisdiction} onChange={e => set('jurisdiction', e.target.value)} placeholder="e.g. United States, United Kingdom" />
          </div>

          <div className="border-t border-gray-100 pt-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Registered Address</h4>
            <div className="space-y-3">
              <div>
                <label className="label">Address Line 1</label>
                <input className="input" value={form.address_line1} onChange={e => set('address_line1', e.target.value)} placeholder="Street / Building" />
              </div>
              <div>
                <label className="label">Address Line 2</label>
                <input className="input" value={form.address_line2} onChange={e => set('address_line2', e.target.value)} placeholder="Suite, Floor, etc." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">City</label><input className="input" value={form.city} onChange={e => set('city', e.target.value)} /></div>
                <div><label className="label">State / Region</label><input className="input" value={form.state} onChange={e => set('state', e.target.value)} /></div>
                <div><label className="label">Postcode / ZIP</label><input className="input" value={form.postcode} onChange={e => set('postcode', e.target.value)} /></div>
                <div>
                  <label className="label">Country</label>
                  <select className="input" value={form.country} onChange={e => set('country', e.target.value)}>
                    {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any additional notes…" />
          </div>

          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input type="checkbox" className="w-4 h-4 accent-emerald-600" checked={!!form.is_primary} onChange={e => set('is_primary', e.target.checked)} />
            Set as primary legal entity
          </label>

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="btn-secondary px-4 py-2">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary px-6 py-2">{saving ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LegalTaxSection() {
  const [entities, setEntities] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [modal, setModal]       = useState(null); // null | 'new' | entity obj
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/api/org-setup/legal-entities')
      .then(r => setEntities(Array.isArray(r.data) ? r.data : []))
      .catch(() => setError('Failed to load legal entities'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleSave = () => { setModal(null); setSuccess('Saved'); setTimeout(() => setSuccess(''), 3000); load(); };
  const handleDelete = async (id) => {
    if (!confirm('Delete this legal entity?')) return;
    try { await api.delete(`/api/org-setup/legal-entities/${id}`); load(); }
    catch (err) { setError(err.response?.data?.error || 'Delete failed'); }
  };

  if (loading) return <Spinner />;

  return (
    <div className="max-w-3xl space-y-4">
      <Banner type="error"   message={error}   onClose={() => setError('')} />
      <Banner type="success" message={success} />

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-800">Legal Entities</h3>
            <p className="text-sm text-gray-500 mt-0.5">Add each registered legal entity, subsidiary, or trading company. Mark one as primary.</p>
          </div>
          <button onClick={() => setModal('new')} className="btn-primary px-4 py-2 text-sm">+ Add Entity</button>
        </div>

        {entities.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <div className="text-3xl mb-2">⚖️</div>
            <p className="text-sm">No legal entities added yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {entities.map(e => (
              <div key={e.id} className="flex items-start justify-between py-4 gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900">{e.legal_name}</span>
                    {e.is_primary && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">Primary</span>}
                  </div>
                  {e.trading_name && <p className="text-sm text-gray-500 mt-0.5">DBA: {e.trading_name}</p>}
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-gray-500">
                    {e.tax_id        && <span>{e.tax_id_label || 'Tax ID'}: {e.tax_id}</span>}
                    {e.vat_number    && <span>VAT: {e.vat_number}</span>}
                    {e.registration_number && <span>Reg: {e.registration_number}</span>}
                    {e.jurisdiction  && <span>⚖️ {e.jurisdiction}</span>}
                  </div>
                  {(e.address_line1 || e.city) && (
                    <p className="text-xs text-gray-400 mt-1">
                      📍 {[e.address_line1, e.address_line2, e.city, e.state, e.postcode, e.country].filter(Boolean).join(', ')}
                    </p>
                  )}
                  {e.notes && <p className="text-xs text-gray-400 mt-1 italic">{e.notes}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => setModal(e)} className="text-xs text-emerald-600 hover:text-emerald-700 font-medium px-2 py-1 rounded hover:bg-emerald-50">Edit</button>
                  <button onClick={() => handleDelete(e.id)} className="text-xs text-red-500 hover:text-red-600 font-medium px-2 py-1 rounded hover:bg-red-50">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal && (
        <LegalEntityModal
          entity={modal === 'new' ? null : modal}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

// ── Section: Locations ────────────────────────────────────────────────────
function LocationModal({ loc, onSave, onClose }) {
  const isEdit = !!loc?.id;
  const [form, setForm] = useState(loc ? { ...loc } : {
    name:'', address_line1:'', address_line2:'', city:'', state:'',
    postcode:'', country:'US', timezone:'UTC', phone:'', is_primary: false, is_active: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const set = (k,v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault(); setError(''); setSaving(true);
    try {
      if (isEdit) await api.put(`/api/org-setup/locations/${loc.id}`, form);
      else        await api.post('/api/org-setup/locations', form);
      onSave();
    } catch (err) { setError(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900">{isEdit ? 'Edit Location' : 'Add Location'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {error && <Banner type="error" message={error} onClose={() => setError('')} />}
          <div>
            <label className="label">Location Name <span className="text-red-500">*</span></label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Head Office, Sydney Branch" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="label">Address</label><input className="input" value={form.address_line1 || ''} onChange={e => set('address_line1', e.target.value)} placeholder="Street" /></div>
            <div><label className="label">City</label><input className="input" value={form.city || ''} onChange={e => set('city', e.target.value)} /></div>
            <div><label className="label">State</label><input className="input" value={form.state || ''} onChange={e => set('state', e.target.value)} /></div>
            <div><label className="label">Postcode</label><input className="input" value={form.postcode || ''} onChange={e => set('postcode', e.target.value)} /></div>
            <div>
              <label className="label">Country</label>
              <select className="input" value={form.country || 'US'} onChange={e => set('country', e.target.value)}>
                {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Time Zone</label>
              <select className="input" value={form.timezone || 'UTC'} onChange={e => set('timezone', e.target.value)}>
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
            <div><label className="label">Phone</label><input className="input" value={form.phone || ''} onChange={e => set('phone', e.target.value)} placeholder="+1 555 0100" /></div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input type="checkbox" className="w-4 h-4 accent-emerald-600" checked={!!form.is_primary} onChange={e => set('is_primary', e.target.checked)} />
            Set as primary location
          </label>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="btn-secondary px-4 py-2">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary px-6 py-2">{saving ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LocationsSection() {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [modal, setModal]         = useState(null); // null | 'new' | location obj
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/api/org-setup/locations')
      .then(r => setLocations(Array.isArray(r.data) ? r.data : []))
      .catch(() => setError('Failed to load locations'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleSave = () => { setModal(null); setSuccess('Saved'); setTimeout(() => setSuccess(''), 3000); load(); };
  const handleDelete = async (id) => {
    if (!confirm('Delete this location?')) return;
    try { await api.delete(`/api/org-setup/locations/${id}`); load(); }
    catch (err) { setError(err.response?.data?.error || 'Delete failed'); }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <Banner type="error"   message={error}   onClose={() => setError('')} />
      <Banner type="success" message={success} />
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-800">Office Locations</h3>
            <p className="text-sm text-gray-500 mt-0.5">Define where your business operates. Each employee can be assigned to a location.</p>
          </div>
          <button onClick={() => setModal('new')} className="btn-primary px-4 py-2 text-sm">+ Add Location</button>
        </div>
        {loading ? <Spinner /> : locations.length === 0 ? (
          <div className="text-center py-10 text-gray-400"><div className="text-3xl mb-2">📍</div><p className="text-sm">No locations yet.</p></div>
        ) : (
          <div className="space-y-2">
            {locations.map(loc => (
              <div key={loc.id} className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:border-gray-300">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-gray-800">{loc.name}</span>
                    {loc.is_primary && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Primary</span>}
                    {!loc.is_active && <span className="text-xs text-gray-400">inactive</span>}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {[loc.city, loc.state, loc.country].filter(Boolean).join(', ')}{loc.timezone ? ` · ${loc.timezone}` : ''}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => setModal(loc)} className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg" title="Edit">✏️</button>
                  <button onClick={() => handleDelete(loc.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Delete">🗑️</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {modal && <LocationModal loc={modal === 'new' ? null : modal} onSave={handleSave} onClose={() => setModal(null)} />}
    </div>
  );
}

// ── Section: Departments ──────────────────────────────────────────────────
function DeptModal({ dept, allDepts, onSave, onClose }) {
  const isEdit = !!dept?.id;
  const [form, setForm] = useState(dept ? { name: dept.name, code: dept.code||'', cost_center: dept.cost_center||'', description: dept.description||'', parent_id: dept.parent_id||'', is_active: dept.is_active !== false } : { name:'', code:'', cost_center:'', description:'', parent_id:'', is_active: true });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const set = (k,v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault(); setError(''); setSaving(true);
    try {
      const payload = { ...form, parent_id: form.parent_id || null };
      if (isEdit) await api.put(`/api/org-setup/departments/${dept.id}`, payload);
      else        await api.post('/api/org-setup/departments', payload);
      onSave();
    } catch (err) { setError(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const parentOptions = allDepts.filter(d => !isEdit || d.id !== dept?.id);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900">{isEdit ? 'Edit Department' : 'Add Department'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {error && <Banner type="error" message={error} onClose={() => setError('')} />}
          <div>
            <label className="label">Department Name <span className="text-red-500">*</span></label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Engineering, Finance" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Code</label>
              <input className="input font-mono" value={form.code} onChange={e => set('code', e.target.value.toUpperCase())} placeholder="ENG" maxLength={10} />
            </div>
            <div>
              <label className="label">Cost Centre</label>
              <input className="input" value={form.cost_center} onChange={e => set('cost_center', e.target.value)} placeholder="CC-1001" />
            </div>
          </div>
          <div>
            <label className="label">Parent Department</label>
            <select className="input" value={form.parent_id || ''} onChange={e => set('parent_id', e.target.value)}>
              <option value="">— None (top-level) —</option>
              {parentOptions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Description</label>
            <textarea rows={2} className="input" value={form.description} onChange={e => set('description', e.target.value)} />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="btn-secondary px-4 py-2">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary px-6 py-2">{saving ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DepartmentsSection() {
  const [depts, setDepts]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]     = useState(null);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/api/org-setup/departments')
      .then(r => setDepts(Array.isArray(r.data) ? r.data : []))
      .catch(() => setError('Failed to load departments'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleSave  = () => { setModal(null); setSuccess('Saved'); setTimeout(() => setSuccess(''), 3000); load(); };
  const handleDelete = async (id) => {
    if (!confirm('Delete this department? Sub-departments will become top-level.')) return;
    try { await api.delete(`/api/org-setup/departments/${id}`); load(); }
    catch (err) { setError(err.response?.data?.error || 'Delete failed'); }
  };

  // Build tree display: top-level first, then children indented
  const topLevel   = depts.filter(d => !d.parent_id);
  const childrenOf = (pid) => depts.filter(d => d.parent_id === pid);

  const renderDept = (d, depth = 0) => (
    <React.Fragment key={d.id}>
      <div className={`flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:border-gray-300 ${depth > 0 ? 'ml-6' : ''}`}>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {depth > 0 && <span className="text-gray-300 text-sm">↳</span>}
            <span className="font-medium text-sm text-gray-800">{d.name}</span>
            {d.code && <span className="text-xs font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{d.code}</span>}
            {!d.is_active && <span className="text-xs text-gray-400">inactive</span>}
          </div>
          {(d.cost_center || d.description) && (
            <p className="text-xs text-gray-500 mt-0.5">
              {d.cost_center && <span className="mr-2">Cost centre: {d.cost_center}</span>}
              {d.description && <span>{d.description}</span>}
            </p>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={() => setModal(d)} className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg" title="Edit">✏️</button>
          <button onClick={() => handleDelete(d.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Delete">🗑️</button>
        </div>
      </div>
      {childrenOf(d.id).map(c => renderDept(c, depth + 1))}
    </React.Fragment>
  );

  return (
    <div className="max-w-3xl space-y-4">
      <Banner type="error"   message={error}   onClose={() => setError('')} />
      <Banner type="success" message={success} />
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-800">Departments</h3>
            <p className="text-sm text-gray-500 mt-0.5">Organise your workforce into departments. Supports parent/child hierarchy.</p>
          </div>
          <button onClick={() => setModal('new')} className="btn-primary px-4 py-2 text-sm">+ Add Department</button>
        </div>
        {loading ? <Spinner /> : depts.length === 0 ? (
          <div className="text-center py-10 text-gray-400"><div className="text-3xl mb-2">🗂️</div><p className="text-sm">No departments yet.</p></div>
        ) : (
          <div className="space-y-2">{topLevel.map(d => renderDept(d))}</div>
        )}
      </div>
      {modal && <DeptModal dept={modal === 'new' ? null : modal} allDepts={depts} onSave={handleSave} onClose={() => setModal(null)} />}
    </div>
  );
}

// ── Section: Workweek & Time ───────────────────────────────────────────────
function WorkweekSection() {
  const { profile, loading, saving, save, error, setError, success } = useOrgProfile();
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (profile) setForm({
      week_start_day:          profile.week_start_day          || 'monday',
      standard_hours_per_day:  profile.standard_hours_per_day  ?? 8,
      standard_hours_per_week: profile.standard_hours_per_week ?? 40,
      default_timezone:        profile.default_timezone        || 'UTC',
      date_format:             profile.date_format             || 'YYYY-MM-DD',
    });
  }, [profile]);

  const set = (k,v) => setForm(f => ({ ...f, [k]: v }));
  if (loading || !form) return <Spinner />;

  return (
    <form onSubmit={e => { e.preventDefault(); save(form); }} className="space-y-5 max-w-2xl">
      <Banner type="error"   message={error}   onClose={() => setError('')} />
      <Banner type="success" message={success} />

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h3 className="font-semibold text-gray-800">Work Schedule</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Week Starts On</label>
            <select className="input" value={form.week_start_day} onChange={e => set('week_start_day', e.target.value)}>
              <option value="monday">Monday</option>
              <option value="sunday">Sunday</option>
              <option value="saturday">Saturday</option>
            </select>
          </div>
          <div>
            <label className="label">Default Timezone</label>
            <select className="input" value={form.default_timezone} onChange={e => set('default_timezone', e.target.value)}>
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Standard Hours / Day</label>
            <input type="number" min="1" max="24" step="0.5" className="input" value={form.standard_hours_per_day} onChange={e => set('standard_hours_per_day', e.target.value)} />
          </div>
          <div>
            <label className="label">Standard Hours / Week</label>
            <input type="number" min="1" max="168" step="0.5" className="input" value={form.standard_hours_per_week} onChange={e => set('standard_hours_per_week', e.target.value)} />
          </div>
          <div>
            <label className="label">Date Format</label>
            <select className="input" value={form.date_format} onChange={e => set('date_format', e.target.value)}>
              <option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="DD-MM-YYYY">DD-MM-YYYY</option>
            </select>
          </div>
        </div>
        <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
          Preview: <strong>{new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric' }).replace(/\//g, form.date_format.includes('/') ? '/' : '-')}</strong>
          &nbsp;· Timezone: <strong>{form.default_timezone}</strong>
          &nbsp;· Week starts: <strong className="capitalize">{form.week_start_day}</strong>
        </div>
      </div>
      <div className="flex justify-end"><button type="submit" disabled={saving} className="btn-primary px-6 py-2">{saving ? 'Saving…' : 'Save'}</button></div>
    </form>
  );
}

// ── Section: Invoicing ────────────────────────────────────────────────────
function InvoicingSection() {
  const { profile, loading, saving, save, error, setError, success } = useOrgProfile();
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (profile) setForm({
      default_currency:    profile.default_currency    || 'USD',
      currency_symbol:     profile.currency_symbol     || '$',
      currency_position:   profile.currency_position   || 'before',
      invoice_prefix:      profile.invoice_prefix      || 'INV',
      invoice_separator:   profile.invoice_separator   || '-',
      invoice_next_number: profile.invoice_next_number ?? 1001,
      invoice_padding:     profile.invoice_padding     ?? 4,
    });
  }, [profile]);

  const set = (k,v) => setForm(f => ({ ...f, [k]: v }));

  // Auto-fill symbol when currency changes
  const onCurrencyChange = (code) => {
    const cur = CURRENCIES.find(c => c.code === code);
    setForm(f => ({ ...f, default_currency: code, currency_symbol: cur?.symbol || f.currency_symbol }));
  };

  if (loading || !form) return <Spinner />;

  // Live invoice number preview
  const padded  = String(form.invoice_next_number || 1001).padStart(parseInt(form.invoice_padding) || 4, '0');
  const preview = `${form.invoice_prefix || 'INV'}${form.invoice_separator || '-'}${padded}`;
  const exampleAmt = form.currency_position === 'before'
    ? `${form.currency_symbol}1,250.00`
    : `1,250.00${form.currency_symbol}`;

  return (
    <form onSubmit={e => { e.preventDefault(); save(form); }} className="space-y-5 max-w-2xl">
      <Banner type="error"   message={error}   onClose={() => setError('')} />
      <Banner type="success" message={success} />

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h3 className="font-semibold text-gray-800">Currency</h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">Default Currency</label>
            <select className="input" value={form.default_currency} onChange={e => onCurrencyChange(e.target.value)}>
              {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Symbol</label>
            <input className="input" value={form.currency_symbol} onChange={e => set('currency_symbol', e.target.value)} maxLength={5} />
          </div>
          <div>
            <label className="label">Position</label>
            <select className="input" value={form.currency_position} onChange={e => set('currency_position', e.target.value)}>
              <option value="before">Before amount ({form.currency_symbol}100)</option>
              <option value="after">After amount (100{form.currency_symbol})</option>
            </select>
          </div>
        </div>
        <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-600">
          Example: <strong>{exampleAmt}</strong>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h3 className="font-semibold text-gray-800">Invoice Numbering</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Prefix</label>
            <input className="input font-mono" value={form.invoice_prefix} onChange={e => set('invoice_prefix', e.target.value.toUpperCase())} placeholder="INV" maxLength={10} />
          </div>
          <div>
            <label className="label">Separator</label>
            <input className="input font-mono" value={form.invoice_separator} onChange={e => set('invoice_separator', e.target.value)} placeholder="-" maxLength={3} />
          </div>
          <div>
            <label className="label">Next Number</label>
            <input type="number" min="1" className="input" value={form.invoice_next_number} onChange={e => set('invoice_next_number', e.target.value)} />
          </div>
          <div>
            <label className="label">Zero Padding (digits)</label>
            <select className="input" value={form.invoice_padding} onChange={e => set('invoice_padding', e.target.value)}>
              {[3,4,5,6].map(n => <option key={n} value={n}>{n} digits</option>)}
            </select>
          </div>
        </div>
        <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-600">
          Next invoice: <strong className="font-mono text-emerald-700">{preview}</strong>
        </div>
      </div>
      <div className="flex justify-end"><button type="submit" disabled={saving} className="btn-primary px-6 py-2">{saving ? 'Saving…' : 'Save'}</button></div>
    </form>
  );
}

// ── Section: Pay & Retention ──────────────────────────────────────────────
function PayRetentionSection() {
  const { profile, loading, saving, save, error, setError, success } = useOrgProfile();
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (profile) setForm({
      default_pay_period:     profile.default_pay_period     || 'weekly',
      pay_period_anchor_date: profile.pay_period_anchor_date ? profile.pay_period_anchor_date.split('T')[0] : '',
      doc_retention_years:    profile.doc_retention_years    ?? 7,
      doc_retention_policy:   profile.doc_retention_policy   || '',
    });
  }, [profile]);

  const set = (k,v) => setForm(f => ({ ...f, [k]: v }));
  if (loading || !form) return <Spinner />;

  const PAY_LABELS = { weekly:'Weekly (every 7 days)', fortnightly:'Fortnightly (every 2 weeks)', semi_monthly:'Semi-monthly (1st & 15th)', monthly:'Monthly' };

  return (
    <form onSubmit={e => { e.preventDefault(); save(form); }} className="space-y-5 max-w-2xl">
      <Banner type="error"   message={error}   onClose={() => setError('')} />
      <Banner type="success" message={success} />

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h3 className="font-semibold text-gray-800">Default Pay Period</h3>
        <p className="text-sm text-gray-500">Sets the default schedule for new employees. Individual records can override this.</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Pay Frequency</label>
            <select className="input" value={form.default_pay_period} onChange={e => set('default_pay_period', e.target.value)}>
              {Object.entries(PAY_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="label">First Pay Period Start Date</label>
            <input type="date" className="input" value={form.pay_period_anchor_date} onChange={e => set('pay_period_anchor_date', e.target.value)} />
            <p className="text-xs text-gray-400 mt-1">Used to calculate all subsequent pay period boundaries.</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h3 className="font-semibold text-gray-800">Document Retention</h3>
        <p className="text-sm text-gray-500">How long employee records, timesheets, contracts and invoices must be kept.</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Retention Period (years)</label>
            <select className="input" value={form.doc_retention_years} onChange={e => set('doc_retention_years', e.target.value)}>
              {[1,2,3,5,7,10,15,20].map(y => <option key={y} value={y}>{y} year{y > 1 ? 's' : ''}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Retention Policy Notes</label>
          <textarea rows={4} className="input" value={form.doc_retention_policy} onChange={e => set('doc_retention_policy', e.target.value)}
            placeholder="Describe your document retention policy, regulatory requirements, deletion procedures, etc." />
        </div>
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
          Records older than <strong>{form.doc_retention_years} years</strong> may be scheduled for deletion in accordance with your policy.
          Always verify local regulatory requirements (e.g. GDPR, HMRC, ATO, IRS) before reducing this value.
        </div>
      </div>
      <div className="flex justify-end"><button type="submit" disabled={saving} className="btn-primary px-6 py-2">{saving ? 'Saving…' : 'Save'}</button></div>
    </form>
  );
}

// ── Employee Number & Duplicate Detection config ───────────────────────────
function EmployeeNumberSection() {
  const [form, setForm]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState('');
  const [preview, setPreview] = useState('');

  useEffect(() => {
    api.get('/api/org-setup/employee-number-config')
      .then(r => {
        setForm({
          emp_num_mode:      r.data.emp_num_mode      || 'auto',
          emp_num_format:    r.data.emp_num_format    || 'numeric',
          emp_num_prefix:    r.data.emp_num_prefix    ?? '',
          emp_num_suffix:    r.data.emp_num_suffix    ?? '',
          emp_num_padding:   r.data.emp_num_padding   ?? 4,
          emp_num_next_seq:  r.data.emp_num_next_seq  ?? 1,
          dup_check_enabled: r.data.dup_check_enabled ?? true,
          dup_check_ssn:     r.data.dup_check_ssn     ?? true,
          dup_check_dob:     r.data.dup_check_dob     ?? false,
          dup_check_name:    r.data.dup_check_name    ?? false,
        });
        setLoading(false);
      })
      .catch(() => { setError('Failed to load config'); setLoading(false); });
  }, []);

  // Live preview
  useEffect(() => {
    if (!form) return;
    if (form.emp_num_mode !== 'auto') { setPreview('—'); return; }
    const seq     = parseInt(form.emp_num_next_seq) || 1;
    const padding = parseInt(form.emp_num_padding)  || 4;
    let seqStr;
    if (form.emp_num_format === 'alphanumeric') {
      seqStr = seq.toString(36).toUpperCase().padStart(padding, '0');
    } else {
      seqStr = String(seq).padStart(padding, '0');
    }
    setPreview(`${form.emp_num_prefix || ''}${seqStr}${form.emp_num_suffix || ''}`);
  }, [form]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true); setError(''); setSuccess('');
    try {
      await api.put('/api/org-setup/employee-number-config', form);
      setSuccess('Employee number settings saved.');
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !form) return <Spinner />;

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-2xl">
      <Banner type="error"   message={error}   onClose={() => setError('')} />
      <Banner type="success" message={success} />

      {/* ── Employee Number Generation ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div>
          <h3 className="font-semibold text-gray-800">Employee Number Generation</h3>
          <p className="text-sm text-gray-500 mt-1">Configure how employee IDs are assigned when a new hire is created.</p>
        </div>

        {/* Mode */}
        <div>
          <label className="label">Mode</label>
          <div className="flex gap-6 mt-1">
            {[['auto','Automatic — generated on hire'],['manual','Manual — entered by admin']].map(([v,l]) => (
              <label key={v} className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="radio" name="emp_num_mode" value={v} checked={form.emp_num_mode === v}
                  onChange={() => set('emp_num_mode', v)} />
                {l}
              </label>
            ))}
          </div>
        </div>

        {form.emp_num_mode === 'auto' && (
          <>
            {/* Format */}
            <div>
              <label className="label">Format</label>
              <div className="flex gap-6 mt-1">
                {[['numeric','Numeric (e.g. 0001)'],['alphanumeric','Alphanumeric base-36 (e.g. A001)']].map(([v,l]) => (
                  <label key={v} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input type="radio" name="emp_num_format" value={v} checked={form.emp_num_format === v}
                      onChange={() => set('emp_num_format', v)} />
                    {l}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Prefix</label>
                <input className="input font-mono" value={form.emp_num_prefix}
                  onChange={e => set('emp_num_prefix', e.target.value.toUpperCase())}
                  placeholder="e.g. EMP-" maxLength={10} />
              </div>
              <div>
                <label className="label">Suffix</label>
                <input className="input font-mono" value={form.emp_num_suffix}
                  onChange={e => set('emp_num_suffix', e.target.value.toUpperCase())}
                  placeholder="e.g. -UK" maxLength={10} />
              </div>
              <div>
                <label className="label">Sequence Padding (digits)</label>
                <select className="input" value={form.emp_num_padding}
                  onChange={e => set('emp_num_padding', parseInt(e.target.value))}>
                  {[2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n} digits</option>)}
                </select>
              </div>
              <div>
                <label className="label">Next Sequence Number</label>
                <input type="number" min="1" className="input" value={form.emp_num_next_seq}
                  onChange={e => set('emp_num_next_seq', parseInt(e.target.value) || 1)} />
              </div>
            </div>

            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">
              Next employee number: <strong className="font-mono text-base">{preview}</strong>
            </div>
          </>
        )}
      </div>

      {/* ── Duplicate Detection ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <h3 className="font-semibold text-gray-800">Duplicate Employee Detection</h3>
          <p className="text-sm text-gray-500 mt-1">Automatically check for potential duplicate hires before a new employee record is saved.</p>
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={form.dup_check_enabled}
            onChange={e => set('dup_check_enabled', e.target.checked)}
            className="w-4 h-4 rounded" />
          <span className="text-sm font-medium">Enable duplicate detection</span>
        </label>

        {form.dup_check_enabled && (
          <div className="pl-6 space-y-3 border-l-2 border-emerald-100">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Match on any of the following:</p>
            {[
              ['dup_check_ssn',  'SSN (Social Security Number)', 'Stored as a secure hash — only the last 4 digits are visible'],
              ['dup_check_dob',  'Date of Birth',                'Match on exact date of birth'],
              ['dup_check_name', 'Full Name',                    'Case-insensitive full name match (generates more false positives)'],
            ].map(([key, label, hint]) => (
              <label key={key} className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={form[key]}
                  onChange={e => set(key, e.target.checked)}
                  className="w-4 h-4 rounded mt-0.5" />
                <div>
                  <span className="text-sm font-medium">{label}</span>
                  <p className="text-xs text-gray-400">{hint}</p>
                </div>
              </label>
            ))}
          </div>
        )}

        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
          When a potential duplicate is detected, admins will be shown the existing employee and offered the option to continue as a new hire or <strong>rehire</strong> the existing employee.
        </div>
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={saving} className="btn-primary px-6 py-2">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

// ── Spinner helper ─────────────────────────────────────────────────────────
function Spinner() {
  return <div className="flex items-center justify-center h-40"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"/></div>;
}

// ── Main OrgSetupTab — sidebar + section switcher ─────────────────────────
function OrgSetupTab() {
  const [section, setSection] = useState('profile');

  const SECTION_COMPONENTS = {
    profile:      CompanyProfileSection,
    legal:        LegalTaxSection,
    locations:    LocationsSection,
    departments:  DepartmentsSection,
    workweek:     WorkweekSection,
    invoicing:    InvoicingSection,
    payretention: PayRetentionSection,
    empnumbers:   EmployeeNumberSection,
  };

  const ActiveSection = SECTION_COMPONENTS[section] || CompanyProfileSection;

  return (
    <div className="flex gap-6">
      {/* Sidebar nav */}
      <aside className="w-52 shrink-0">
        <nav className="space-y-1">
          {ORG_SECTIONS.map(s => (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={`w-full text-left flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                section === s.key
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800'
              }`}
            >
              <span className="text-base">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Section content */}
      <div className="flex-1 min-w-0">
        <div className="mb-5">
          <h2 className="text-base font-semibold text-gray-800">
            {ORG_SECTIONS.find(s => s.key === section)?.label}
          </h2>
        </div>
        <ActiveSection />
      </div>
    </div>
  );
}

// ── Tab: Custom Fields ────────────────────────────────────────────────────────

const FIELD_TYPES = [
  { value: 'text',           label: 'Text' },
  { value: 'rich_text',      label: 'Rich Text' },
  { value: 'number',         label: 'Number' },
  { value: 'date',           label: 'Date' },
  { value: 'select',         label: 'Dropdown (Select)' },
  { value: 'radio',          label: 'Radio Buttons' },
  { value: 'checkbox',       label: 'Single Checkbox' },
  { value: 'multi_checkbox', label: 'Multiple Checkboxes' },
];
const OPTION_TYPES = ['select', 'radio', 'multi_checkbox'];
const MAX_CUSTOM_FIELDS = 10;

const EMPTY_FIELD_FORM = {
  label: '', field_key: '', field_type: 'text',
  options: [],
  placeholder: '', help_text: '', formula: '',
  validation: { required: false, minLength: '', maxLength: '', min: '', max: '', pattern: '', patternMsg: '' },
};

function CustomFieldModal({ field, onSave, onClose }) {
  const isEdit = !!field?.id;
  const [form, setForm]   = useState(() => {
    if (!field) return EMPTY_FIELD_FORM;
    return {
      label:       field.label       || '',
      field_key:   field.field_key   || '',
      field_type:  field.field_type  || 'text',
      options:     Array.isArray(field.options) ? field.options : [],
      placeholder: field.placeholder || '',
      help_text:   field.help_text   || '',
      formula:     field.formula     || '',
      validation: {
        required:   field.validation?.required   || false,
        minLength:  field.validation?.minLength  || '',
        maxLength:  field.validation?.maxLength  || '',
        min:        field.validation?.min        || '',
        max:        field.validation?.max        || '',
        pattern:    field.validation?.pattern    || '',
        patternMsg: field.validation?.patternMsg || '',
      },
    };
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setValidation = (k, v) => setForm(f => ({ ...f, validation: { ...f.validation, [k]: v } }));

  // Options management
  const addOption = () => setForm(f => ({ ...f, options: [...f.options, { label: '', value: '' }] }));
  const removeOption = (i) => setForm(f => ({ ...f, options: f.options.filter((_,idx) => idx !== i) }));
  const updateOption = (i, key, val) => setForm(f => ({
    ...f,
    options: f.options.map((o, idx) => idx === i ? { ...o, [key]: val } : o),
  }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      // Build clean validation object (omit empty strings)
      const validation = {};
      const v = form.validation;
      if (v.required)              validation.required   = true;
      if (v.minLength !== '')      validation.minLength  = parseInt(v.minLength);
      if (v.maxLength !== '')      validation.maxLength  = parseInt(v.maxLength);
      if (v.min       !== '')      validation.min        = parseFloat(v.min);
      if (v.max       !== '')      validation.max        = parseFloat(v.max);
      if (v.pattern   !== '')      validation.pattern    = v.pattern;
      if (v.patternMsg!== '')      validation.patternMsg = v.patternMsg;

      const payload = {
        label:       form.label.trim(),
        field_key:   form.field_key.trim() || undefined,
        field_type:  form.field_type,
        options:     OPTION_TYPES.includes(form.field_type) ? form.options : [],
        placeholder: form.placeholder.trim() || null,
        help_text:   form.help_text.trim()   || null,
        formula:     form.formula.trim()     || null,
        validation,
      };

      if (isEdit) {
        await api.put(`/api/custom-fields/${field.id}`, payload);
      } else {
        await api.post('/api/custom-fields', payload);
      }
      onSave();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const needsOptions = OPTION_TYPES.includes(form.field_type);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900 text-lg">
            {isEdit ? 'Edit Custom Field' : 'Add Custom Field'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && <Banner type="error" message={error} onClose={() => setError('')} />}

          {/* Label & Field Type */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Field Label <span className="text-red-500">*</span></label>
              <input className="input" value={form.label} onChange={e => set('label', e.target.value)} placeholder="e.g. Crew / Badge Number" required />
            </div>
            <div>
              <label className="label">Field Type <span className="text-red-500">*</span></label>
              <select className="input" value={form.field_type} onChange={e => set('field_type', e.target.value)}>
                {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>

          {/* Field Key */}
          <div>
            <label className="label">
              Field Key
              <span className="text-xs text-gray-400 font-normal ml-1">(auto-generated if empty — used in CSV column headers)</span>
            </label>
            <input className="input font-mono" value={form.field_key} onChange={e => set('field_key', e.target.value.toLowerCase())}
              placeholder="auto_generated_from_label" pattern="[a-z][a-z0-9_]*" title="Lowercase letters, numbers, underscores only" />
          </div>

          {/* Options (for select, radio, multi_checkbox) */}
          {needsOptions && (
            <div>
              <label className="label">Options <span className="text-red-500">*</span></label>
              <div className="space-y-2">
                {form.options.map((opt, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input className="input flex-1" placeholder="Label (shown to user)" value={opt.label}
                      onChange={e => updateOption(i, 'label', e.target.value)} />
                    <input className="input flex-1 font-mono text-sm" placeholder="value (stored)" value={opt.value}
                      onChange={e => updateOption(i, 'value', e.target.value.toLowerCase().replace(/\s+/g,'_'))} />
                    <button type="button" onClick={() => removeOption(i)} className="text-red-400 hover:text-red-600 text-lg shrink-0">✕</button>
                  </div>
                ))}
                <button type="button" onClick={addOption} className="text-sm text-emerald-600 hover:text-emerald-700 font-medium">+ Add Option</button>
              </div>
            </div>
          )}

          {/* Placeholder & Help text */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Placeholder</label>
              <input className="input" value={form.placeholder} onChange={e => set('placeholder', e.target.value)} placeholder="Hint shown inside the field" />
            </div>
            <div>
              <label className="label">Help Text</label>
              <input className="input" value={form.help_text} onChange={e => set('help_text', e.target.value)} placeholder="Shown below the field" />
            </div>
          </div>

          {/* Formula */}
          <div>
            <label className="label">
              Formula
              <span className="text-xs text-gray-400 font-normal ml-1">(makes field computed / read-only)</span>
            </label>
            <input className="input font-mono text-sm" value={form.formula} onChange={e => set('formula', e.target.value)}
              placeholder="e.g. {hours} * {hourly_rate}" />
            <p className="text-xs text-gray-400 mt-1">Reference other field keys inside curly braces. Supports + − × ÷ and parentheses.</p>
          </div>

          {/* Validation */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
            <h4 className="text-sm font-semibold text-gray-700">Validation Rules</h4>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input type="checkbox" className="w-4 h-4 accent-emerald-600" checked={form.validation.required}
                onChange={e => setValidation('required', e.target.checked)} />
              Required field
            </label>

            {['text','rich_text'].includes(form.field_type) && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs">Min Length</label>
                  <input type="number" className="input" value={form.validation.minLength} onChange={e => setValidation('minLength', e.target.value)} min="0" placeholder="0" />
                </div>
                <div>
                  <label className="label text-xs">Max Length</label>
                  <input type="number" className="input" value={form.validation.maxLength} onChange={e => setValidation('maxLength', e.target.value)} min="0" placeholder="500" />
                </div>
              </div>
            )}
            {form.field_type === 'number' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs">Min Value</label>
                  <input type="number" className="input" value={form.validation.min} onChange={e => setValidation('min', e.target.value)} placeholder="e.g. 0" />
                </div>
                <div>
                  <label className="label text-xs">Max Value</label>
                  <input type="number" className="input" value={form.validation.max} onChange={e => setValidation('max', e.target.value)} placeholder="e.g. 999" />
                </div>
              </div>
            )}
            {['text','rich_text'].includes(form.field_type) && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs">Pattern (regex)</label>
                  <input className="input font-mono text-sm" value={form.validation.pattern} onChange={e => setValidation('pattern', e.target.value)} placeholder="e.g. ^\d{4}$" />
                </div>
                <div>
                  <label className="label text-xs">Pattern Error Message</label>
                  <input className="input" value={form.validation.patternMsg} onChange={e => setValidation('patternMsg', e.target.value)} placeholder="e.g. Must be 4 digits" />
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="btn-secondary px-4 py-2">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary px-6 py-2">
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Field'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CustomFieldsTab() {
  const [fields, setFields]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');
  const [dragging, setDragging] = useState(null); // id being dragged

  const load = useCallback(() => {
    setLoading(true);
    api.get('/api/custom-fields')
      .then(r => setFields(Array.isArray(r.data) ? r.data : []))
      .catch(() => setError('Failed to load custom fields'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setShowModal(true); };
  const openEdit   = (f) => { setEditing(f);    setShowModal(true); };

  const handleSave = () => {
    setShowModal(false);
    setSuccess('Custom field saved successfully');
    setTimeout(() => setSuccess(''), 4000);
    load();
  };

  const handleToggle = async (field) => {
    try {
      await api.put(`/api/custom-fields/${field.id}`, { is_active: !field.is_active });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update field');
    }
  };

  const handleDelete = async (field) => {
    if (!confirm(`Deactivate "${field.label}"? Existing employee data for this field is preserved.`)) return;
    try {
      await api.delete(`/api/custom-fields/${field.id}`);
      setSuccess('Field deactivated');
      setTimeout(() => setSuccess(''), 3000);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to deactivate field');
    }
  };

  // Drag-and-drop reorder
  const handleDragStart = (e, id) => { setDragging(id); e.dataTransfer.effectAllowed = 'move'; };
  const handleDragOver  = (e, id) => {
    e.preventDefault();
    if (dragging == null || dragging === id) return;
    setFields(prev => {
      const from = prev.findIndex(f => f.id === dragging);
      const to   = prev.findIndex(f => f.id === id);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };
  const handleDragEnd = async () => {
    setDragging(null);
    try {
      const order = fields.map((f, i) => ({ id: f.id, display_order: i }));
      await api.patch('/api/custom-fields/reorder', { order });
    } catch {
      setError('Failed to save new order');
      load();
    }
  };

  const activeCount   = fields.filter(f => f.is_active).length;
  const canAddMore    = activeCount < MAX_CUSTOM_FIELDS;

  if (loading) return <div className="flex items-center justify-center h-40"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"/></div>;

  return (
    <div className="max-w-3xl space-y-4">
      <Banner type="error"   message={error}   onClose={() => setError('')} />
      <Banner type="success" message={success} />

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-800">Custom Employee Fields</h2>
            <p className="text-sm text-gray-500 mt-1">
              Add up to {MAX_CUSTOM_FIELDS} custom fields that appear on all employee forms and in CSV import templates.
              Drag rows to reorder.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-sm font-medium px-2.5 py-1 rounded-full ${activeCount >= MAX_CUSTOM_FIELDS ? 'bg-amber-100 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
              {activeCount} / {MAX_CUSTOM_FIELDS} active
            </span>
            <button
              onClick={openCreate}
              disabled={!canAddMore}
              className="btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              title={!canAddMore ? `Maximum ${MAX_CUSTOM_FIELDS} active fields reached` : ''}
            >
              + Add Field
            </button>
          </div>
        </div>

        {fields.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <div className="text-4xl mb-2">🗂️</div>
            <p className="text-sm">No custom fields yet. Click "Add Field" to create your first one.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {fields.map(f => (
              <div
                key={f.id}
                draggable
                onDragStart={e => handleDragStart(e, f.id)}
                onDragOver={e  => handleDragOver(e, f.id)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-all cursor-grab active:cursor-grabbing ${
                  dragging === f.id ? 'opacity-40 border-dashed' : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                } ${!f.is_active ? 'bg-gray-50 opacity-60' : 'bg-white'}`}
              >
                {/* Drag handle */}
                <span className="text-gray-300 text-lg select-none">⠿</span>

                {/* Field info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-gray-800 truncate">{f.label}</span>
                    {!f.is_active && <span className="text-xs text-gray-400 shrink-0">inactive</span>}
                    {f.formula && <span className="text-xs text-blue-500 shrink-0">ƒ formula</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-gray-400 font-mono">{f.field_key}</span>
                    <span className="text-xs text-gray-500 capitalize">{FIELD_TYPES.find(t=>t.value===f.field_type)?.label || f.field_type}</span>
                    {f.validation?.required && <span className="text-xs text-red-400">required</span>}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {/* Toggle active */}
                  <button
                    type="button"
                    onClick={() => handleToggle(f)}
                    title={f.is_active ? 'Deactivate' : 'Activate'}
                    className={`px-2 py-1 text-xs rounded-full border font-medium transition-colors ${
                      f.is_active
                        ? 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                        : 'border-gray-200  text-gray-500     hover:bg-gray-50'
                    }`}
                  >
                    {f.is_active ? 'Active' : 'Inactive'}
                  </button>
                  <button type="button" onClick={() => openEdit(f)}
                    className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors" title="Edit">
                    ✏️
                  </button>
                  <button type="button" onClick={() => handleDelete(f)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Deactivate">
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Usage hint */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
        <strong>How custom fields work:</strong> these fields appear in the Add/Edit Employee form and in the CSV download template.
        Multi-checkbox values are stored as pipe-separated values in CSV (e.g. <code className="bg-blue-100 px-1 rounded">value1|value2</code>).
        Fields with a formula are automatically calculated and shown as read-only.
      </div>

      {showModal && (
        <CustomFieldModal
          field={editing}
          onSave={handleSave}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

// ── Root Settings page with tabs ──────────────────────────────────────────────

const TABS = [
  { key: 'general',       label: '⚙️ General',           component: GeneralTab       },
  { key: 'ai',            label: '🤖 AI Assistant',      component: AITab            },
  { key: 'security',      label: '🔒 Security',          component: SecurityTab      },
  { key: 'org-setup',     label: '🏢 Organisation Setup', component: OrgSetupTab      },
  { key: 'custom-fields', label: '🗂️ Custom Fields',     component: CustomFieldsTab  },
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
                ? 'text-emerald-600 border-b-2 border-emerald-600 bg-white'
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
