import type { ReactNode } from 'react';

/** A Tab operation with no page or command yet: shown, and disabled. */
export function UnavailableControl({
  className,
  ariaLabel,
  children,
}: {
  readonly className?: string;
  readonly ariaLabel?: string;
  readonly children: ReactNode;
}) {
  return (
    <button type="button" disabled className={className} aria-label={ariaLabel}>
      {children}
    </button>
  );
}
