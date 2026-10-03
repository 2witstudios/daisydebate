import type { InertAction } from '../../../features/prep/actions';
import {
  buttonClass,
  type ButtonVariant,
} from '../../components/button/button-class';
import { SampleAction } from '../../components/sample-action/sample-action';
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
  const text = label ?? action.label;
  return (
    <SampleAction label={text} className={cn(buttonClass(variant), className)}>
      {symbol === undefined ? null : <PrepIcon name={symbol} size={18} />}
      {text}
    </SampleAction>
  );
}
