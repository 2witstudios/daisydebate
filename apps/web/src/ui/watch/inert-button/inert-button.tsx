import type { ReactNode } from 'react';
import { actionLabel, type InertAction } from '../../../features/watch/actions';
import { cn } from '../../cn';
import {
  buttonClass,
  type ButtonVariant,
} from '../../components/button/button-class';
import { SampleAction } from '../../components/sample-action/sample-action';

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
    <SampleAction
      label={actionLabel(action)}
      className={cn(buttonClass(variant), className)}
    >
      {children}
    </SampleAction>
  );
}
