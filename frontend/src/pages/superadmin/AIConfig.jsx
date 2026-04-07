/**
 * Super-Admin Platform AI Configuration
 *
 * Sets the platform-level default AI provider, model, and API key.
 * Tenants inherit these defaults unless they configure their own (if allowed).
 */
import React, { useState, useEffect } from 'react';
import api from '../../api';

const TIER_BADGE = {
  fast:     'bg-green-100 text-green-700',
  balanced: 'bg-blue-100  text-blue-700',
  powerful: 'bg-purple-100 text-purple-700',
};

const PROVIDER_ICONS = { anthropic: '🧠', openai: '🤖' };
const PROVIDER_HINTS = {
  anthropic: 'console.anthropic.com',
  openai:    'platform.openai.com/api-keys',
};

export default function PlatformAIConfig() {
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [testing, setTesting]   = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');
  const [testResult, setTestResult] = useState(null);

  const [provider, setProvider]       = useState('anthropic');
  const [model, setModel]             = useState('claude-haiku-4-5-20251001');
  const [apiKey, setApiKey]           = useState('');
  const [showKey, setShowKey]         = useState(false);
  const [hasKey, setHasKey]           = useState(false);
  const [allowTenantKeys, setAllowTenantKeys] = useState(true);
  const [availableProviders, setAvailableProviders] = useState({});

  useEffect(() => {
    api.get('/api/super-admin/ai-config')
      .then(r => {
        setProvider(r.data.provider);
        setModel(r.data.model);
        setHasKey(r.data.has_api_key);
        setAllowTenantKeys(r.data.allow_tenant_keys);
        setAvailableProviders(r.data.available_providers || {});
      })
      .catch(() => setError('Failed to load AI config'))
      .finally(() => setLoading(false));
  }, []);

  const handleProviderChange = (p) => { setProvider(p); setModel(availableProviders[p]?.[0]?.id || ''); setTestResult(null); };

  const handleSave = async () => {
    setSaving(true); setError(''); setSuccess('');
    try {
      const body = { provider, model, allow_tenant_keys: allowTenantKeys };
      if (apiKey) body.api_key = apiKey;
      await api.put('/api/super-admin/ai-config', body);
      setSuccess('Platform AI configuration saved.');
      setHasKey(prev => prev || !!apiKey);
      setApiKey('');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) { setError(err.response?.data?.error || 'Save failed.'); }
    finally { setSaving(false); }
  };

  const handleClearKey = async () => {
    if (!window.confirm('Remove the platform API key? Tenants without their own keys will lose AI access.')) return;
    try { await api.put('/api/super-admin/ai-config', { clear_api_key: true }); setHasKey(false); setSuccess('API key removed.'); setTimeout(()=>setSuccess(''),3000); }
    catch (err) { setError(err.response?.data?.error || 'Failed.'); }
  };

  const models = availableProviders[provider] || [];

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-600"/></div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Platform AI Configuration</h1>
        <p className="text-sm text-gray-500 mt-1">
          Set the default AI provider and model for all tenants. Tenants can override with their own key if permitted.
        </p>
      </div>

      {error   && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex justify-between">{error}<button onClick={()=>setError('')} className="ml-2 opacity-60 hover:opacity-100">✕</button></div>}
      {success && <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-700">{success}</div>}

      {/* Provider */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-800 mb-1">Default AI Provider</h2>
        <p className="text-xs text-gray-500 mb-4">All tenants inherit this provider unless they configure their own.</p>
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(availableProviders).map(([key]) => (
            <button key={key} type="button" onClick={() => handleProviderChange(key)}
              className={`flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-all ${provider===key ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300'}`}>
              <span className="text-2xl">{PROVIDER_ICONS[key] || '🤖'}</span>
              <div>
                <p className="font-medium text-sm text-gray-900 capitalize">{key}</p>
                <p className="text-xs text-gray-400">{PROVIDER_HINTS[key]}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Model */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-800 mb-1">Default Model</h2>
        <p className="text-xs text-gray-500 mb-4">Tenants without their own model preference will use this.</p>
        <div className="space-y-2">
          {models.map(m => (
            <label key={m.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${model===m.id ? 'border-purple-400 bg-purple-50' : 'border-gray-200 hover:border-gray-300'}`}>
              <input type="radio" name="plat-model" value={m.id} checked={model===m.id} onChange={()=>setModel(m.id)} className="accent-purple-600"/>
              <div className="flex-1">
                <span className="font-medium text-sm font-mono text-gray-900">{m.id}</span>
                <span className="text-xs text-gray-500 ml-2">{m.label?.split(' — ')[1]}</span>
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${TIER_BADGE[m.tier]}`}>{m.tier}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Platform API Key */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-800 mb-1">Platform API Key</h2>
        <p className="text-xs text-gray-500 mb-4">
          This key is shared across all tenants that don't have their own. Keep it secure.
        </p>
        {hasKey && !apiKey && (
          <div className="flex items-center gap-3 mb-3 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-700">
            ✅ Platform API key saved
            <button onClick={handleClearKey} className="ml-auto text-xs text-red-500 hover:underline">Remove</button>
          </div>
        )}
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={hasKey ? 'Enter new key to replace…' : `${provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}`}
            className="input pr-20"
            autoComplete="new-password"
          />
          <button type="button" onClick={()=>setShowKey(s=>!s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600">
            {showKey ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {/* Allow tenant overrides */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-800 mb-3">Tenant Override Policy</h2>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={allowTenantKeys} onChange={e => setAllowTenantKeys(e.target.checked)}
            className="mt-0.5 accent-purple-600 w-4 h-4"/>
          <div>
            <p className="text-sm font-medium text-gray-800">Allow tenants to use their own API key</p>
            <p className="text-xs text-gray-500 mt-0.5">When enabled, tenant admins can configure their own provider/model/key in their Settings. When disabled, all tenants use the platform key and model above.</p>
          </div>
        </label>
      </div>

      {testResult && (
        <div className={`rounded-xl border p-4 text-sm ${testResult.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
          {testResult.ok
            ? <><strong>✅ Platform key works</strong> — model: {testResult.model}</>
            : <><strong>❌ Test failed</strong> — {testResult.text}</>}
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={handleSave} disabled={saving} className="bg-purple-600 hover:bg-purple-700 text-white font-medium px-6 py-2.5 rounded-lg transition-colors disabled:opacity-50">
          {saving ? 'Saving…' : '💾 Save Platform Config'}
        </button>
      </div>
    </div>
  );
}
