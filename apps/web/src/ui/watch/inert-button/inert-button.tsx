import type { ReactNode } from 'react';
import type { InertAction } from '../../../features/watch/actions';
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
 * A control whose operation does not exist yet. It is disabled, so it never
 * fakes a mutation.
 */
export function InertButton({
  action,
  variant = 'secondary',
  className,
  children,
}: InertButtonProps) {
  return (
    <button
      type="button"
      disabled
      data-action={action}
      className={cn(buttonClass(variant), className)}
    >
      {children}
    </button>
  );
}
