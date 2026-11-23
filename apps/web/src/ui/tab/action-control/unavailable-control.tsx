import { Button } from '../../components/button/button';
import type { ButtonLook } from '../../components/button/button-class';
import type { ReactNode } from 'react';

/** A Tab operation with no page or command yet: shown, and disabled. */
export function UnavailableControl({
  look,
  className,
  ariaLabel,
  children,
}: {
  /** The look of the link it stands in for. */
  readonly look: ButtonLook;
  /** Layout only. */
  readonly className?: string;
  readonly ariaLabel?: string;
  readonly children: ReactNode;
}) {
  return (
    <Button
      {...look}
      type="button"
      disabled
      className={className}
      aria-label={ariaLabel}
    >
      {children}
    </Button>
  );
}
