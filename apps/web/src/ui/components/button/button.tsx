import type { ComponentPropsWithRef } from 'react';
import { cn } from '../../cn';
import { lookClass, type ButtonLook, type ButtonSize } from './button-class';

export type ButtonProps = (
  | ButtonLook
  | { readonly variant?: undefined; readonly size?: ButtonSize<'primary'> }
) &
  Omit<ComponentPropsWithRef<'button'>, 'formMethod'>;

/**
 * A native button of a named variant, which owns its whole look (`primary`
 * when unnamed). It is `type="button"` unless it says it submits;
 * `className` adds only layout.
 */
export function Button({
  variant,
  size,
  className,
  type = 'button',
  ...attributes
}: ButtonProps) {
  const look: ButtonLook =
    variant === undefined
      ? { variant: 'primary', ...(size === undefined ? {} : { size }) }
      : ({ variant, size } as ButtonLook);
  return (
    <button
      type={type}
      className={cn(lookClass(look), className)}
      {...attributes}
      formMethod={undefined}
    />
  );
}
