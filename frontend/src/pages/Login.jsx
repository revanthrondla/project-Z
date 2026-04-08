import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import FlowLogo from '../components/FlowLogo';

const DEMO_ACCOUNTS = [
  { label: '👑 Admin',      email: 'admin@hireiq.com',  password: 'admin123',      company: 'hireiq', color: 'emerald' },
  { label: '👤 Alice',      email: 'alice@hireiq.com',  password: 'candidate123',  company: 'hireiq', color: 'teal' },
  { label: '👤 Bob',        email: 'bob@hireiq.com',    password: 'candidate123',  company: 'hireiq', color: 'teal' },
  { label: '👤 Carol',      email: 'carol@hireiq.com',  password: 'candidate123',  company: 'hireiq', color: 'teal' },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '', companyCode: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const set = field => e => setForm(f => ({ ...f, [field]: e.target.value }));

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

  const fillDemo = ({ email, password, company }) =>
    setForm({ email, password, companyCode: company });

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">

      {/* ── Left: Brand panel (hidden on small screens) ───────────────────── */}
      <div className="hidden lg:flex lg:w-[45%] xl:w-1/2 flex-col justify-between
                      bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-600
                      p-10 xl:p-14 relative overflow-hidden">

        {/* Background decoration */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-white/5" />
          <div className="absolute -bottom-48 -left-20 w-[500px] h-[500px] rounded-full bg-white/5" />
          <svg className="absolute bottom-0 left-0 right-0 opacity-10" viewBox="0 0 800 200" preserveAspectRatio="none">
            <path d="M0 120 C150 60 300 160 450 100 C600 40 700 130 800 80 L800 200 L0 200Z" fill="white"/>
          </svg>
        </div>

        {/* Logo */}
        <div className="relative">
          <FlowLogo size="lg" inverted />
        </div>

        {/* Hero copy */}
        <div className="relative space-y-6">
          <div className="space-y-3">
            <h1 className="text-4xl xl:text-5xl font-extrabold text-white leading-tight tracking-tight text-balance">
              The smarter way to manage your workforce
            </h1>
            <p className="text-emerald-100 text-lg leading-relaxed max-w-sm">
              Time tracking, absence management, and invoicing — all in one place.
            </p>
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2">
            {['⏱ Time Tracking', '🏖 Absence Mgmt', '📄 Invoicing', '🤖 AI Assistant'].map(f => (
              <span key={f} className="px-3 py-1.5 bg-white/15 rounded-full text-xs font-semibold text-white backdrop-blur-sm">
                {f}
              </span>
            ))}
          </div>
        </div>

        {/* Footer note */}
        <p className="relative text-emerald-200/60 text-xs">
          © {new Date().getFullYear()} Flow. Workforce Platform.
        </p>
      </div>

      {/* ── Right: Login form ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center
                      px-4 sm:px-8 py-10 bg-gray-50 min-h-screen lg:min-h-0">

        {/* Mobile logo */}
        <div className="lg:hidden mb-8">
          <FlowLogo size="lg" />
        </div>

        <div className="w-full max-w-[420px]">

          {/* Heading */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900">Welcome back</h2>
            <p className="text-gray-500 text-sm mt-1">Sign in to your Flow account</p>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-100 text-red-700 rounded-xl text-sm">
              <svg className="w-4 h-4 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>
              </svg>
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Organisation code */}
            <div>
              <label className="label" htmlFor="companyCode">
                Organisation code
                <span className="text-gray-400 font-normal ml-1">(optional)</span>
              </label>
              <input
                id="companyCode"
                type="text"
                className="input font-mono"
                placeholder="e.g. flow-demo"
                value={form.companyCode}
                onChange={set('companyCode')}
                autoComplete="organization"
                autoFocus
              />
            </div>

            {/* Email */}
            <div>
              <label className="label" htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                className="input"
                placeholder="you@company.com"
                value={form.email}
                onChange={set('email')}
                autoComplete="email"
                required
              />
            </div>

            {/* Password */}
            <div>
              <label className="label" htmlFor="password">Password</label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={set('password')}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3 text-base mt-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin -ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Signing in…
                </>
              ) : 'Sign in'}
            </button>
          </form>

          {/* Demo accounts */}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Quick Demo Access
            </p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map(acc => (
                <button
                  key={acc.email}
                  onClick={() => fillDemo(acc)}
                  className="text-left p-3 bg-white border border-gray-200 rounded-xl
                             hover:border-emerald-300 hover:bg-emerald-50 hover:shadow-sm
                             transition-all duration-150 group"
                >
                  <div className="text-xs font-semibold text-gray-700 group-hover:text-emerald-700">
                    {acc.label}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5 truncate">
                    {acc.email}
                  </div>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-3 text-center">
              Click a card to pre-fill credentials, then sign in
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
