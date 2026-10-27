import type { InertAction } from '../../../features/prep/actions';
import type { ButtonVariant } from '../../components/button/button-class';
import type { IconName } from '../../components/icon/icon';
import { SampleButton } from '../../components/sample-button/sample-button';

export type InertActionButtonProps = {
  readonly action: InertAction;
  readonly variant?: ButtonVariant;
  readonly symbol?: IconName;
  readonly className?: string;
  /** Overrides the action's label where the screen words it differently. */
  readonly label?: string;
};

/**
 * A mutation with no backend: it answers on the same page with the
 * sample-action banner and saves nothing.
 */
export function InertActionButton({
  action,
  variant = 'secondary',
  symbol,
  className,
  label,
}: InertActionButtonProps) {
  return (
    <SampleButton
      label={label ?? action.label}
      variant={variant}
      {...(symbol === undefined ? {} : { symbol })}
      {...(className === undefined ? {} : { className })}
    />
  );
}
