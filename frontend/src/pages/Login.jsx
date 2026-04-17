import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../api';
import FlowLogo from '../components/FlowLogo';

const REDIRECT = (role) => role === 'super_admin' ? '/super-admin/dashboard' : '/dashboard';


export default function Login() {
  const { login, verifyMfa, verifyEmailOtp } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [form, setForm] = useState({ email: '', password: '', companyCode: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // MFA state
  const [mfaState, setMfaState] = useState(null); // { mfaToken, mfaMethod, companySlug }
  const [mfaCode, setMfaCode] = useState('');
  const [mfaLoading, setMfaLoading] = useState(false);
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [mfaSetupRequired, setMfaSetupRequired] = useState(false);

  // SSO state
  const [ssoConfig, setSsoConfig] = useState(null);
  const ssoCheckTimeoutRef = useRef(null);

  const set = field => e => setForm(f => ({ ...f, [field]: e.target.value }));

  // Check for SSO error in URL
  useEffect(() => {
    const ssoError = searchParams.get('sso_error');
    if (ssoError) {
      setError(decodeURIComponent(ssoError));
    }
  }, [searchParams]);

  // Debounced SSO config check
  useEffect(() => {
    if (ssoCheckTimeoutRef.current) {
      clearTimeout(ssoCheckTimeoutRef.current);
    }

    const companySlug = form.companyCode.trim().toLowerCase();
    if (!companySlug) {
      setSsoConfig(null);
      return;
    }

    ssoCheckTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await api.get(`/api/auth/sso/config?tenant=${companySlug}`);
        setSsoConfig(res.data);
      } catch {
        setSsoConfig(null);
      }
    }, 400);

    return () => {
      if (ssoCheckTimeoutRef.current) clearTimeout(ssoCheckTimeoutRef.current);
    };
  }, [form.companyCode]);

  // Resend countdown timer
  useEffect(() => {
    if (resendCountdown <= 0) return;
    const t = setTimeout(() => setResendCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCountdown]);

  const sendEmailOtp = async (mfaToken) => {
    try {
      await api.post('/api/auth/mfa/email-otp/send', { mfaToken });
      setEmailOtpSent(true);
      setResendCountdown(60);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send verification code.');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const companySlug = form.companyCode.trim() || undefined;
      const result = await login(form.email, form.password, companySlug);

      // Org requires MFA but user hasn't set it up yet (TOTP-only policy)
      if (result.mfaSetupRequired) {
        setMfaSetupRequired(true);
        return;
      }

      // Check if MFA challenge is required
      if (result.mfaRequired) {
        const mfaMethod = result.mfaMethod || 'totp';
        setMfaState({ mfaToken: result.mfaToken, mfaMethod, companySlug: result.companySlug });
        setMfaCode('');
        setUseBackupCode(false);
        // Auto-send email OTP if that's the method
        if (mfaMethod === 'email_otp' || result.autoSend) {
          await sendEmailOtp(result.mfaToken);
        }
        return;
      }

      // Normal login path
      navigate(REDIRECT(result.user.role));
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please check your details.');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e) => {
    e.preventDefault();
    if (!mfaState) return;

    setError('');
    setMfaLoading(true);
    try {
      const user = mfaState.mfaMethod === 'email_otp'
        ? await verifyEmailOtp(mfaState.mfaToken, mfaCode)
        : await verifyMfa(mfaState.mfaToken, mfaCode);
      navigate(REDIRECT(user.role));
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid code. Please try again.');
      setMfaCode('');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleBackToLogin = () => {
    setMfaState(null);
    setMfaCode('');
    setUseBackupCode(false);
    setEmailOtpSent(false);
    setResendCountdown(0);
    setMfaSetupRequired(false);
    setError('');
  };

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

          {/* Back to home or back to login */}
          <div className="mb-6">
            {mfaState || mfaSetupRequired ? (
              <button
                type="button"
                onClick={handleBackToLogin}
                className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-emerald-600 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to login
              </button>
            ) : (
              <a
                href="/flow-homepage.html"
                className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-emerald-600 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to home
              </a>
            )}
          </div>

          {/* Heading */}
          <div className="mb-8">
            {mfaSetupRequired ? (
              <>
                <h2 className="text-2xl font-bold text-gray-900">MFA Setup Required</h2>
                <p className="text-gray-500 text-sm mt-1">Your organisation requires two-factor authentication</p>
              </>
            ) : mfaState?.mfaMethod === 'email_otp' ? (
              <>
                <h2 className="text-2xl font-bold text-gray-900">Check Your Email</h2>
                <p className="text-gray-500 text-sm mt-1">We sent a 6-digit verification code to your email</p>
              </>
            ) : mfaState ? (
              <>
                <h2 className="text-2xl font-bold text-gray-900">Two-Factor Authentication</h2>
                <p className="text-gray-500 text-sm mt-1">Enter the 6-digit code from your authenticator app</p>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-bold text-gray-900">Welcome back</h2>
                <p className="text-gray-500 text-sm mt-1">Sign in to your Flow account</p>
              </>
            )}
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

          {/* MFA Setup Required Screen */}
          {mfaSetupRequired ? (
            <div className="space-y-5">
              <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <span className="text-amber-500 text-lg shrink-0">🔐</span>
                <div>
                  <p className="text-sm font-semibold text-amber-900">MFA enrollment required</p>
                  <p className="text-xs text-amber-700 mt-1">
                    Your organisation requires you to set up an authenticator app before you can sign in.
                    Sign in and go to <strong>Settings → Security</strong> to complete MFA setup.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleBackToLogin}
                className="btn-primary w-full py-3 text-base"
              >
                Back to sign in
              </button>
            </div>
          ) : mfaState?.mfaMethod === 'email_otp' ? (
            /* Email OTP Form */
            <form onSubmit={handleMfaSubmit} className="space-y-5" noValidate>
              <div className="flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center text-3xl">
                  📧
                </div>
                {emailOtpSent && (
                  <p className="text-xs text-gray-500 text-center">
                    A 6-digit code was sent to your email. It expires in 10 minutes.
                  </p>
                )}
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength="6"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="text-center text-4xl font-mono tracking-widest border-2 border-gray-300 rounded-xl w-44 py-4 focus:border-emerald-500 focus:outline-none"
                  autoFocus
                />
                <button
                  type="button"
                  disabled={resendCountdown > 0}
                  onClick={() => sendEmailOtp(mfaState.mfaToken)}
                  className="text-sm text-emerald-600 hover:text-emerald-700 disabled:text-gray-400 disabled:cursor-not-allowed"
                >
                  {resendCountdown > 0 ? `Resend code in ${resendCountdown}s` : "Didn't get it? Resend"}
                </button>
              </div>
              <button
                type="submit"
                disabled={mfaLoading || mfaCode.length !== 6}
                className="btn-primary w-full py-3 text-base"
              >
                {mfaLoading ? (
                  <><svg className="animate-spin -ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>Verifying…</>
                ) : 'Verify Code'}
              </button>
            </form>
          ) : mfaState ? (
            /* TOTP / Backup Code Form */
            <form onSubmit={handleMfaSubmit} className="space-y-6" noValidate>
              <div className="flex flex-col items-center gap-4">
                <div className="flex gap-1.5 justify-center">
                  {!useBackupCode ? (
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="\d{6}"
                      maxLength="6"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="000000"
                      className="text-center text-4xl font-mono tracking-widest border-2 border-gray-300 rounded-xl w-40 py-4 focus:border-emerald-500 focus:outline-none"
                      autoFocus
                    />
                  ) : (
                    <input
                      type="text"
                      placeholder="XXXXXXXX"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.toUpperCase())}
                      maxLength="8"
                      className="input font-mono text-center tracking-widest"
                      autoFocus
                    />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => { setUseBackupCode(!useBackupCode); setMfaCode(''); }}
                  className="text-sm text-emerald-600 hover:text-emerald-700 underline"
                >
                  {useBackupCode ? 'Use authenticator code' : 'Use backup code'}
                </button>
              </div>
              <button
                type="submit"
                disabled={mfaLoading || (useBackupCode ? mfaCode.length !== 8 : mfaCode.length !== 6)}
                className="btn-primary w-full py-3 text-base"
              >
                {mfaLoading ? (
                  <><svg className="animate-spin -ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>Verifying…</>
                ) : 'Verify'}
              </button>
            </form>
          ) : (
            /* Login Form */
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

              {/* SSO Button */}
              {ssoConfig?.ssoEnabled && ssoConfig?.googleConfigured && form.companyCode && (
                <button
                  type="button"
                  onClick={() => {
                    const companySlug = form.companyCode.trim().toLowerCase();
                    window.location.href = `/api/auth/sso/google?tenant=${companySlug}`;
                  }}
                  className="w-full flex items-center justify-center gap-2.5 py-3 px-4 border border-gray-300 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <text x="12" y="16" fontSize="20" textAnchor="middle" fill="currentColor" fontWeight="bold">G</text>
                  </svg>
                  Sign in with Google
                </button>
              )}

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
          )}

        </div>
      </div>
    </div>
  );
}
