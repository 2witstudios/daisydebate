import type { ComponentPropsWithRef } from 'react';
import { cn } from '../../cn';
import { buttonClass, type ButtonVariant } from './button-class';

export type ButtonProps = {
  readonly variant?: ButtonVariant | 'unstyled';
} & Omit<ComponentPropsWithRef<'button'>, 'formMethod'>;

export function Button({ variant = 'primary', ...attributes }: ButtonProps) {
  if (variant === 'unstyled')
    return <button {...attributes} formMethod={undefined} />;

  const { className, type = 'button', ...rest } = attributes;
  return (
    <button
      type={type}
      className={cn(buttonClass(variant), className)}
      {...rest}
      formMethod={undefined}
    />
  );
}
