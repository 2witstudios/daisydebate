import type { ReactNode } from 'react';
import { cn } from '../../cn';
import { buttonClass, type ButtonVariant } from '../button/button-class';
import { Icon, type IconName } from '../icon/icon';
import { SampleAction } from '../sample-action/sample-action';

export type SampleButtonProps = {
  readonly label: string;
  readonly variant?: ButtonVariant;
  /** A glyph before the label. */
  readonly symbol?: IconName;
  readonly className?: string;
  /** The face when it differs from the glyph and label. */
  readonly children?: ReactNode;
};

/**
 * A button-styled control with no backend (ISSUE-314: the one inert action
 * button every vertical uses). It answers on the same page with the shell
 * banner and saves nothing. Use it where the operation is not built, never
 * for a control that is unavailable for a reason the screen can state.
 */
export function SampleButton({
  label,
  variant = 'secondary',
  symbol,
  className,
  children,
}: SampleButtonProps) {
  return (
    <SampleAction label={label} className={cn(buttonClass(variant), className)}>
      {children ?? (
        <>
          {symbol === undefined ? null : <Icon name={symbol} size={18} />}
          {label}
        </>
      )}
    </SampleAction>
  );
}
