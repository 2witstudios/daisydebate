import type { ReactNode } from 'react';
import { inertReason, type InertAction } from '../../../features/watch/actions';
import { cn } from '../../cn';
import {
  buttonClass,
  type ButtonVariant,
} from '../../components/button/button-class';

export type InertButtonProps = {
  readonly action: InertAction;
  readonly variant?: ButtonVariant;
  readonly className?: string;
  readonly children: ReactNode;
};

/**
 * A control whose operation does not exist yet. It is disabled and says why,
 * to a screen reader and on hover, so it never fakes a mutation.
 */
export function InertButton({
  action,
  variant = 'secondary',
  className,
  children,
}: InertButtonProps) {
  const reason = inertReason(action);
  return (
    <button
      type="button"
      disabled
      title={reason}
      className={cn(buttonClass(variant), className)}
    >
      {children}
      <span className="sr-only">{`. ${reason}`}</span>
    </button>
  );
}
