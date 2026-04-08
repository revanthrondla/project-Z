/**
 * Flow — Brand Logo Component
 *
 * Usage:
 *   <FlowLogo size="md" />          — icon + wordmark, medium
 *   <FlowLogo size="lg" iconOnly /> — icon only, large
 *   <FlowLogo inverted />           — white wordmark for dark backgrounds
 *
 * Color palette: fresh vibrant emerald → teal → cyan
 * Signals growth, clarity, and forward energy.
 */

export default function FlowLogo({
  size = 'md',
  iconOnly = false,
  inverted = false,
  className = '',
}) {
  const sizes = {
    xs:  { icon: 20, text: 13, gap: 5 },
    sm:  { icon: 26, text: 16, gap: 6 },
    md:  { icon: 32, text: 20, gap: 8 },
    lg:  { icon: 42, text: 26, gap: 10 },
    xl:  { icon: 56, text: 34, gap: 12 },
  };
  const s = sizes[size] || sizes.md;

  // Unique gradient IDs per instance (prevents SVG gradient conflicts when multiple logos render)
  const uid = size + (iconOnly ? '-ico' : '') + (inverted ? '-inv' : '');

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
        style={{ flexShrink: 0 }}
      >
        <defs>
          {/* Primary background gradient: emerald → teal */}
          <linearGradient id={`fg-a-${uid}`} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="#10b981" />  {/* emerald-500 */}
            <stop offset="55%"  stopColor="#14b8a6" />  {/* teal-500    */}
            <stop offset="100%" stopColor="#06b6d4" />  {/* cyan-500    */}
          </linearGradient>
          {/* Shine overlay */}
          <linearGradient id={`fg-b-${uid}`} x1="0" y1="0" x2="0" y2="40" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="white" stopOpacity="0.18" />
            <stop offset="100%" stopColor="white" stopOpacity="0"    />
          </linearGradient>
        </defs>

        {/* Background rounded square */}
        <rect width="40" height="40" rx="11" fill={`url(#fg-a-${uid})`} />
        {/* Shine layer */}
        <rect width="40" height="20" rx="11" fill={`url(#fg-b-${uid})`} />

        {/* Three flow / wave lines */}
        {/* Primary wave — full opacity */}
        <path
          d="M6 20 C11 13, 16 13, 20 20 C24 27, 29 27, 34 20"
          stroke="white"
          strokeWidth="2.8"
          strokeLinecap="round"
          fill="none"
          opacity="1"
        />
        {/* Upper wave — medium opacity */}
        <path
          d="M6 13 C11 6,  16 6,  20 13 C24 20, 29 20, 34 13"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          opacity="0.5"
        />
        {/* Lower wave — subtle */}
        <path
          d="M6 27 C11 20, 16 20, 20 27 C24 34, 29 34, 34 27"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
          opacity="0.28"
        />
      </svg>

      {/* ── Wordmark ── */}
      {!iconOnly && (
        <span
          style={{
            fontSize: s.text,
            fontWeight: 800,
            letterSpacing: '-0.03em',
            lineHeight: 1,
            ...(inverted
              ? { color: 'white' }
              : {
                  background: 'linear-gradient(135deg, #059669 0%, #10b981 45%, #14b8a6 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }),
          }}
        >
          Flow
        </span>
      )}
    </div>
  );
}
