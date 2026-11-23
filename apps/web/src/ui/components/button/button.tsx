import type { ComponentPropsWithRef } from 'react';
import { cn } from '../../cn';
import {
  buttonClass,
  type ButtonSize,
  type ButtonVariant,
} from './button-class';

export type ButtonProps = {
  readonly variant?: ButtonVariant;
  /** A standard action's compact size in a dense list. */
  readonly size?: ButtonSize;
} & Omit<ComponentPropsWithRef<'button'>, 'formMethod'>;

/**
 * A native button of a named variant. It is `type="button"` unless it says
 * it submits; `className` adds only what the variant leaves to its site.
 */
export function Button({
  variant = 'primary',
  size,
  className,
  type = 'button',
  ...attributes
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonClass(variant, size), className)}
      {...attributes}
      formMethod={undefined}
    />
  );
}
