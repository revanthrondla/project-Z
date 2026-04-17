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
  const [requireMfa, setRequireMfa] = useState(false);
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
        setRequireMfa(r.data.mfaRequired);
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
  const updateOrgConfig = async (updates) => {
    setOrgSaving(true);
    setError('');
    try {
      await api.put('/api/auth/sso/admin-config', updates);
      setSuccess('Security settings saved.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save settings.');
    } finally {
      setOrgSaving(false);
    }
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
        <h2 className="text-base font-semibold text-gray-800 mb-4">Organisation Security</h2>

        {!googleConfigured && (
          <div className="mb-4 flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
            <span className="text-sm shrink-0">ℹ️</span>
            <div>
              Google SSO requires <code className="bg-blue-100 px-1 rounded">GOOGLE_CLIENT_ID</code> to be configured on the server.
            </div>
          </div>
        )}

        <div className="space-y-4">
          {/* Require MFA Toggle */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-gray-900">Require MFA for all users</p>
              <p className="text-xs text-gray-500 mt-0.5">All users must enable two-factor authentication</p>
            </div>
            <button
              onClick={() => {
                setRequireMfa(!requireMfa);
                updateOrgConfig({ mfaRequired: !requireMfa });
              }}
              disabled={orgSaving}
              className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                requireMfa
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              {requireMfa ? 'On' : 'Off'}
            </button>
          </div>

          {/* SSO Toggle */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-gray-900">Enable Google SSO</p>
              <p className="text-xs text-gray-500 mt-0.5">Allow users to sign in with Google</p>
            </div>
            <button
              onClick={() => {
                setSsoEnabled(!ssoEnabled);
                updateOrgConfig({ ssoEnabled: !ssoEnabled });
              }}
              disabled={orgSaving}
              className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                ssoEnabled
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              {ssoEnabled ? 'On' : 'Off'}
            </button>
          </div>

          {/* Allowed Email Domain */}
          {ssoEnabled && (
            <div>
              <label className="label">Allowed email domain (optional)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={ssoDomain}
                  onChange={(e) => setSsoDomain(e.target.value)}
                  placeholder="e.g. acme.com"
                  className="input flex-1"
                />
                <button
                  onClick={() => updateOrgConfig({ ssoDomain })}
                  disabled={orgSaving}
                  className="btn-secondary px-4 py-2"
                >
                  Save
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">Leave blank to allow any email domain</p>
            </div>
          )}

          {/* SSO Login URL */}
          <div>
            <label className="label text-gray-600">SSO Login URL</label>
            <div className="flex items-center gap-2 bg-gray-50 p-3 rounded-lg border border-gray-200">
              <code className="flex-1 font-mono text-sm text-gray-700 break-all">
                {typeof window !== 'undefined' ? `${window.location.origin}/login` : 'https://app.example.com/login'}
              </code>
              <button
                onClick={() => copyToClipboard(`${window.location.origin}/login`)}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Copy
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Root Settings page with tabs ──────────────────────────────────────────────

const TABS = [
  { key: 'general',   label: '⚙️ General',      component: GeneralTab    },
  { key: 'ai',        label: '🤖 AI Assistant', component: AITab         },
  { key: 'security',  label: '🔒 Security',     component: SecurityTab   },
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
