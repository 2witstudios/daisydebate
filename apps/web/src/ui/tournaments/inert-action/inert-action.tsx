import type { InertActionId } from '../../../features/tournaments/actions';
import { inertActions } from '../../../features/tournaments/actions';
import {
  buttonClass,
  type ButtonVariant,
} from '../../components/button/button-class';

export type DisabledActionProps = {
  readonly label: string;
  readonly reason: string;
  readonly variant?: ButtonVariant;
  readonly className?: string;
};

/**
 * A control whose real operation does not exist yet. It is disabled and says
 * why, never a link or a submit that pretends to work.
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

export type InertActionProps = {
  readonly id: InertActionId;
  readonly variant?: ButtonVariant;
  readonly className?: string;
};

/** A disabled action from the registry in features/tournaments/actions.ts. */
export function InertAction({ id, variant, className }: InertActionProps) {
  return (
    <DisabledAction
      {...inertActions[id]}
      {...(variant ? { variant } : {})}
      {...(className ? { className } : {})}
    />
  );
}
