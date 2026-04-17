import React, { useState, useEffect } from 'react';
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

// ── Super Admin Security Page ──────────────────────────────────────────────────

export default function SuperAdminSecurity() {
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

  // Load personal MFA status
  useEffect(() => {
    api.get('/api/auth/mfa/status')
      .then(r => {
        setMfaEnabled(r.data.enabled);
      })
      .catch(() => setError('Failed to load MFA status.'))
      .finally(() => setLoading(false));
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

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setSuccess('Copied to clipboard!');
    setTimeout(() => setSuccess(''), 2000);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"/></div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Security</h1>
        <p className="text-gray-500 mt-1">Manage your personal security settings</p>
      </div>

      <div className="space-y-6 max-w-2xl">
        <Banner type="error" message={error} onClose={() => setError('')} />
        <Banner type="success" message={success} />

        {/* Personal MFA Section */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Two-Factor Authentication</h2>

          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm text-gray-600">MFA Status</p>
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
      </div>
    </div>
  );
}
