import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '', companyCode: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const companySlug = form.companyCode.trim() || undefined;
      const user = await login(form.email, form.password, companySlug);
      navigate(user.role === 'super_admin' ? '/super-admin/dashboard' : '/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please check your details.');
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (email, password, companyCode = '') =>
    setForm({ email, password, companyCode });

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-green-500 rounded-2xl mb-4 shadow-lg">
            <span className="text-white text-2xl font-bold">🌱</span>
          </div>
          <h1 className="text-3xl font-bold text-white">aGrow</h1>
          <p className="text-blue-200 mt-1">Agricultural Scanning Platform</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">Sign in to your account</h2>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Organisation code <span className="text-gray-400 font-normal">(optional)</span></label>
              <input
                type="text"
                className="input font-mono"
                placeholder="e.g. hireiq"
                value={form.companyCode}
                onChange={e => setForm({ ...form, companyCode: e.target.value })}
                autoFocus
              />
            </div>
            <div>
              <label className="label">Email address</label>
              <input
                type="email"
                className="input"
                placeholder="you@company.com"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                type="password"
                className="input"
                placeholder="••••••••"
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                required
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* Demo accounts */}
          <div className="mt-6 pt-6 border-t border-gray-100">
            <p className="text-xs text-gray-500 mb-3 font-medium uppercase tracking-wide">Quick Demo Access</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => fillDemo('admin@hireiq.com', 'admin123', 'hireiq')}
                className="text-left p-2.5 border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors">
                <div className="text-xs font-medium text-gray-700">👑 Admin</div>
                <div className="text-xs text-gray-400 mt-0.5">admin@hireiq.com</div>
              </button>
              <button onClick={() => fillDemo('alice@hireiq.com', 'candidate123', 'hireiq')}
                className="text-left p-2.5 border border-gray-200 rounded-lg hover:bg-green-50 hover:border-green-300 transition-colors">
                <div className="text-xs font-medium text-gray-700">👤 Alice (Dev)</div>
                <div className="text-xs text-gray-400 mt-0.5">alice@hireiq.com</div>
              </button>
              <button onClick={() => fillDemo('bob@hireiq.com', 'candidate123', 'hireiq')}
                className="text-left p-2.5 border border-gray-200 rounded-lg hover:bg-green-50 hover:border-green-300 transition-colors">
                <div className="text-xs font-medium text-gray-700">👤 Bob (Design)</div>
                <div className="text-xs text-gray-400 mt-0.5">bob@hireiq.com</div>
              </button>
              <button onClick={() => fillDemo('carol@hireiq.com', 'candidate123', 'hireiq')}
                className="text-left p-2.5 border border-gray-200 rounded-lg hover:bg-green-50 hover:border-green-300 transition-colors">
                <div className="text-xs font-medium text-gray-700">👤 Carol (PM)</div>
                <div className="text-xs text-gray-400 mt-0.5">carol@hireiq.com</div>
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2 text-center">Click a card to pre-fill, then Sign in</p>
          </div>
        </div>
      </div>
    </div>
  );
}
