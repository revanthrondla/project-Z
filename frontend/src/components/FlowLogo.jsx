/**
 * Flow — Brand Logo Component
 *
 * Usage:
 *   <FlowLogo size="md" />          — icon + wordmark, medium
 *   <FlowLogo size="lg" iconOnly /> — icon only, large
 *   <FlowLogo inverted />           — white version for dark backgrounds
 */

export default function FlowLogo({
  size = 'md',
  iconOnly = false,
  inverted = false,
  className = '',
}) {
  const sizes = {
    xs:  { icon: 20, text: 14, gap: 6 },
    sm:  { icon: 26, text: 16, gap: 7 },
    md:  { icon: 32, text: 20, gap: 8 },
    lg:  { icon: 42, text: 26, gap: 10 },
    xl:  { icon: 56, text: 34, gap: 12 },
  };
  const s = sizes[size] || sizes.md;

  return (
    <div
      className={`inline-flex items-center select-none ${className}`}
      style={{ gap: s.gap }}
      aria-label="Flow"
    >
      {/* ── Icon mark ── */}
      <svg
        width={s.icon}
        height={s.icon}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="flow-grad-a" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="50%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
          <linearGradient id="flow-grad-b" x1="0" y1="40" x2="40" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.2" />
          </linearGradient>
        </defs>

        {/* Background pill */}
        <rect width="40" height="40" rx="10" fill="url(#flow-grad-a)" />

        {/* Wave / flow lines */}
        {/* Primary wave */}
        <path
          d="M6 20 C10 14, 14 14, 20 20 C26 26, 30 26, 34 20"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
          opacity="1"
        />
        {/* Secondary wave (offset above) */}
        <path
          d="M6 13 C10 7, 14 7, 20 13 C26 19, 30 19, 34 13"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          opacity="0.5"
        />
        {/* Tertiary wave (offset below) */}
        <path
          d="M6 27 C10 21, 14 21, 20 27 C26 33, 30 33, 34 27"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
          opacity="0.3"
        />
      </svg>

      {/* ── Wordmark ── */}
      {!iconOnly && (
        <span
          style={{
            fontSize: s.text,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            lineHeight: 1,
            background: inverted
              ? 'white'
              : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #06b6d4 100%)',
            WebkitBackgroundClip: inverted ? undefined : 'text',
            WebkitTextFillColor: inverted ? 'white' : 'transparent',
            backgroundClip: inverted ? undefined : 'text',
            color: inverted ? 'white' : undefined,
          }}
        >
          Flow
        </span>
      )}
    </div>
  );
}
