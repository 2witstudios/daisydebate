import type { InertAction } from '../../../features/prep/actions';
import {
  buttonClass,
  type ButtonVariant,
} from '../../components/button/button-class';
import { cn } from '../../cn';
import { PrepIcon, type PrepIconName } from '../prep-icon/prep-icon';

export type InertActionButtonProps = {
  readonly action: InertAction;
  readonly variant?: ButtonVariant;
  readonly symbol?: PrepIconName;
  readonly className?: string;
  /** Overrides the action's label where the screen words it differently. */
  readonly label?: string;
};

/** A mutation with no backend: a disabled button. It posts nothing. */
export function InertActionButton({
  action,
  variant = 'secondary',
  symbol,
  className,
  label,
}: InertActionButtonProps) {
  return (
    <button
      type="button"
      disabled
      className={cn(buttonClass(variant), className)}
    >
      {symbol === undefined ? null : <PrepIcon name={symbol} size={18} />}
      {label ?? action.label}
    </button>
  );
}
