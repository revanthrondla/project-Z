import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';

// SOC 2 CC6.1: mirrors backend validatePasswordComplexity()
const RULES = [
  { key: 'length',    label: 'At least 10 characters',      test: p => p.length >= 10 },
  { key: 'upper',     label: 'One uppercase letter (A-Z)',   test: p => /[A-Z]/.test(p) },
  { key: 'lower',     label: 'One lowercase letter (a-z)',   test: p => /[a-z]/.test(p) },
  { key: 'number',    label: 'One number (0-9)',             test: p => /[0-9]/.test(p) },
  { key: 'special',   label: 'One special character (!@#…)', test: p => /[^A-Za-z0-9]/.test(p) },
];

function PasswordStrengthMeter({ password }) {
  const passed = RULES.filter(r => r.test(password)).length;
  const pct    = (passed / RULES.length) * 100;
  const color  = pct < 40 ? 'bg-red-400' : pct < 80 ? 'bg-amber-400' : 'bg-emerald-500';
  const label  = pct < 40 ? 'Weak' : pct < 80 ? 'Fair' : pct < 100 ? 'Good' : 'Strong';

  if (!password) return null;

  return (
    <div className="mt-2 space-y-2">
      {/* Strength bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${color}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className={`text-xs font-medium ${pct < 40 ? 'text-red-500' : pct < 80 ? 'text-amber-500' : 'text-emerald-600'}`}>
          {label}
        </span>
      </div>
      {/* Rule checklist */}
      <ul className="space-y-1">
        {RULES.map(rule => {
          const ok = rule.test(password);
          return (
            <li key={rule.key} className={`flex items-center gap-1.5 text-xs ${ok ? 'text-emerald-600' : 'text-gray-400'}`}>
              <span className="text-base leading-none">{ok ? '✓' : '○'}</span>
              {rule.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function ChangePassword() {
  const { user, logout, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [form, setForm]       = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  const handle = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const allRulesPassed = useMemo(() => RULES.every(r => r.test(form.newPassword)), [form.newPassword]);

  const submit = async e => {
    e.preventDefault();
    setError('');

    if (!allRulesPassed) {
      setError('Your new password does not meet the complexity requirements below.');
      return;
    }
    if (form.newPassword !== form.confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await api.put('/api/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      // Re-fetch /api/auth/me so in-memory AuthContext reflects new token
      await refreshUser();
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="text-4xl mb-3">🔐</div>
          <h1 className="text-2xl font-bold text-gray-900">Set Your Password</h1>
          <p className="mt-2 text-sm text-gray-600">
            Welcome, <strong>{user?.name}</strong>. Your account was created with a temporary
            password. Please set a new secure password to continue.
          </p>
        </div>

        {/* Alert banner */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
          <span className="text-amber-500 mt-0.5">⚠️</span>
          <p className="text-sm text-amber-800">
            You must change your password before accessing HireIQ. This is required for account security.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={submit} className="bg-white shadow rounded-xl p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Current (temporary) password
            </label>
            <input
              type="password"
              name="currentPassword"
              value={form.currentPassword}
              onChange={handle}
              required
              autoComplete="current-password"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              New password
            </label>
            <input
              type="password"
              name="newPassword"
              value={form.newPassword}
              onChange={handle}
              required
              autoComplete="new-password"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <PasswordStrengthMeter password={form.newPassword} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirm new password
            </label>
            <input
              type="password"
              name="confirm"
              value={form.confirm}
              onChange={handle}
              required
              autoComplete="new-password"
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                form.confirm && form.newPassword !== form.confirm
                  ? 'border-red-400 bg-red-50'
                  : 'border-gray-300'
              }`}
            />
            {form.confirm && form.newPassword !== form.confirm && (
              <p className="mt-1 text-xs text-red-500">Passwords do not match</p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !allRulesPassed || form.newPassword !== form.confirm}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-lg transition-colors"
          >
            {loading ? 'Updating…' : 'Set New Password'}
          </button>
        </form>

        <div className="text-center">
          <button
            onClick={logout}
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Sign out instead
          </button>
        </div>
      </div>
    </div>
  );
}
