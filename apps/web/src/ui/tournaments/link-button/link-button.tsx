import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  buttonClass,
  type ButtonVariant,
} from '../../components/button/button-class';
import { cn } from '../../cn';

export type LinkButtonProps = {
  readonly href: string;
  readonly variant?: ButtonVariant;
  readonly className?: string;
  readonly children: ReactNode;
};

/** A link that looks like a button: a choice that navigates is a link. */
export function LinkButton({
  href,
  variant = 'secondary',
  className,
  children,
}: LinkButtonProps) {
  return (
    <Link
      href={href}
      className={cn(
        buttonClass(variant),
        'no-underline hover:no-underline',
        className,
      )}
    >
      {children}
    </Link>
  );
}
