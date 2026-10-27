import type { ReactNode } from 'react';
import { actionLabel, type InertAction } from '../../../features/watch/actions';
import type { ButtonVariant } from '../../components/button/button-class';
import { SampleButton } from '../../components/sample-button/sample-button';

export type InertButtonProps = {
  readonly action: InertAction;
  readonly variant?: ButtonVariant;
  readonly className?: string;
  readonly children: ReactNode;
};

/**
 * A control with no backend: it answers on the same page with the
 * sample-action banner, labelled by the action's own words.
 */
export function InertButton({
  action,
  variant = 'secondary',
  className,
  children,
}: InertButtonProps) {
  return (
    <SampleButton
      label={actionLabel(action)}
      variant={variant}
      {...(className ? { className } : {})}
    >
      {children}
    </SampleButton>
  );
}
