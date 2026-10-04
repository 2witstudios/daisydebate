import type { InertActionId } from '../../../features/tournaments/actions';
import { inertActions } from '../../../features/tournaments/actions';
import {
  buttonClass,
  type ButtonVariant,
} from '../../components/button/button-class';
import { SampleAction } from '../../components/sample-action/sample-action';
import { cn } from '../../cn';

export type DisabledActionProps = {
  readonly label: string;
  readonly reason: string;
  readonly variant?: ButtonVariant;
  readonly className?: string;
};

/**
 * A control that is unavailable right now for a reason the screen can state
 * (check-in has not opened, the viewer is not eligible). It is disabled and
 * says why. A control that only lacks a backend is a sample action instead.
 */
export function DisabledAction({
  label,
  reason,
  variant = 'secondary',
  className,
}: DisabledActionProps) {
  return (
    <button
      type="button"
      disabled
      title={reason}
      aria-label={`${label} (${reason})`}
      className={`${buttonClass(variant)} ${className ?? ''}`.trim()}
    >
      {label}
    </button>
  );
}

export type SampleButtonProps = {
  readonly label: string;
  readonly variant?: ButtonVariant;
  readonly className?: string;
};

/**
 * A control with no backend: it answers on the same page with the shell
 * banner and saves nothing. Use it where the operation is not built, never
 * for a control that is unavailable for a reason the screen can state.
 */
export function SampleButton({
  label,
  variant = 'secondary',
  className,
}: SampleButtonProps) {
  return (
    <SampleAction label={label} className={cn(buttonClass(variant), className)}>
      {label}
    </SampleAction>
  );
}

export type InertActionProps = {
  readonly id: InertActionId;
  readonly variant?: ButtonVariant;
  readonly className?: string;
};

/** A sample action from the registry in features/tournaments/actions.ts. */
export function InertAction({ id, variant, className }: InertActionProps) {
  return (
    <SampleButton
      label={inertActions[id].label}
      {...(variant ? { variant } : {})}
      {...(className ? { className } : {})}
    />
  );
}
