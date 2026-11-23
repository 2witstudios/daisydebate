import { Button } from '../../components/button/button';
import type {
  ButtonSize,
  ButtonVariant,
} from '../../components/button/button-class';
import type { ReactNode } from 'react';

/** A Tab operation with no page or command yet: shown, and disabled. */
export function UnavailableControl({
  variant,
  size,
  className,
  ariaLabel,
  children,
}: {
  /** The look of the link it stands in for. */
  readonly variant: ButtonVariant;
  readonly size?: ButtonSize;
  /** What the variant leaves to the site. */
  readonly className?: string;
  readonly ariaLabel?: string;
  readonly children: ReactNode;
}) {
  return (
    <Button
      variant={variant}
      {...(size === undefined ? {} : { size })}
      type="button"
      disabled
      className={className}
      aria-label={ariaLabel}
    >
      {children}
    </Button>
  );
}
