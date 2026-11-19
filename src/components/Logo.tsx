/** The Raven GPS mark: a raven's head facing forward. The beak is the arrow, the eye the camera. */
export function Logo({ size = 28, title = 'Raven GPS' }: { size?: number; title?: string }) {
  return (
    <svg className="logo" width={size} height={size * (72 / 92)} viewBox="0 0 92 72" role="img" aria-label={title}>
      <path fill="currentColor" d="M22 62 C18 46 19 28 32 18 C40 12 50 11 58 15 L84 26 L60 30 C58 38 52 44 44 46 C38 48 34 52 32 62 Z" />
      <path fill="var(--ink)" d="M58 22 L76 26 L58 28 Z" />
      <circle cx="46" cy="25" r="5.5" fill="var(--ink)" />
      <circle cx="46" cy="25" r="2.2" fill="#ff5a36" />
    </svg>
  );
}
