import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';

export default function ChangePassword() {
  const { user, logout } = useAuth();
  const navigate         = useNavigate();

  const [form, setForm]       = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  const handle = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const submit = async e => {
    e.preventDefault();
    setError('');

    if (form.newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
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
      // Redirect to dashboard after successful change
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
            You must change your password before accessing Flow. This is required for account security.
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
              New password <span className="text-gray-400">(min. 8 characters)</span>
            </label>
            <input
              type="password"
              name="newPassword"
              value={form.newPassword}
              onChange={handle}
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
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
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-blue-400 text-white font-medium py-2 px-4 rounded-lg transition-colors"
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
