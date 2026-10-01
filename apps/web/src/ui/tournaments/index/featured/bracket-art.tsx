/** Decorative bracket lines for the featured card. */
export function BracketArt() {
  return (
    <svg
      viewBox="0 0 300 180"
      width="300"
      height="180"
      aria-hidden="true"
      className="text-stage-accent"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path
        d="M24 22H58V34M24 46H58M58 34H92M24 68H58V80M24 92H58M58 80H92M24 114H58V126M24 138H58M58 126H92M24 160H58V172M24 184H58M58 172H92"
        opacity="0.55"
      />
      <path
        d="M108 34H140V58M108 80H140M140 58H172M108 126H140V150M108 172H140M140 150H172M188 58H215V104M188 150H215M215 104H242M258 104H282"
        opacity="0.7"
      />
      <circle cx="294" cy="104" r="5" fill="currentColor" />
    </svg>
  );
}
